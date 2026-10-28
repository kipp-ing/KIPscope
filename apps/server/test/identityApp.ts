/**
 * The app of the multi-user tests (add-multiuser): wired like `main.ts` does it, with a workspace
 * registry on a temp state dir, per-user views, a test identity adapter (user and roles from the
 * headers `x-test-user` and `x-test-roles`), no rules object (rights live in each workspace's
 * grant, D-085), over an adapter that records every call it receives. This is the one place that mirrors main.ts's wiring for these tests; if
 * main.ts changes, change it here.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EMPTY_WORKSPACE,
  type LiveServerMessage,
  type Workspace,
  type WorkspaceScope,
} from "@kipscope/shared";
import { vi } from "vitest";
import WebSocket from "ws";
import { buildApp } from "../src/app.ts";
import { CalendarDays } from "../src/calendarDays.ts";
import type { FinderConfig } from "../src/case.ts";
import { Catalog } from "../src/catalog.ts";
import { type CatalogMode, DEFAULT_SCAN_ROWS, DEFAULT_SCAN_SPAN } from "../src/config.ts";
import type { DataSource, Scope, SourceAdapter } from "../src/datasource.ts";
import { loadDbcFiles } from "../src/dbc.ts";
import { completeSource } from "../src/fallbacks.ts";
import { type FavouritesOf, userFavourites } from "../src/favourites.ts";
import type { IdentityAdapter } from "../src/identity.ts";
import { createScanBound, type ScanBound } from "../src/scanBound.ts";
import { CatalogStore, guardScoped, openScopes } from "../src/scope.ts";
import { userViews } from "../src/views.ts";
import { seedFor, WorkspaceRegistry } from "../src/workspaces.ts";
import { finderConfig } from "./caseKit.ts";
import { type Call, memoryAdapter, recording } from "./scopeApp.ts";
import { testDbcFiles } from "./testdb.ts";

export type { Call };

// The real timers, so a test that fakes `setTimeout` can still wait and time out.
const realSetTimeout = globalThis.setTimeout;
const realSleep = (ms: number) => new Promise<void>((resolve) => realSetTimeout(resolve, ms));

export { realSleep };

/** 2026-10-01T01:00:00Z and 02:00:00Z in ns, by hand (1790816400 s and 1790820000 s). */
export const T1 = 1790816400000000000n;
export const T2 = 1790820000000000000n;
export const SCOPE: WorkspaceScope = { dataRef: "testcar", from: T1.toString(), to: T2.toString() };
export const OTHER_SCOPE: WorkspaceScope = { ...SCOPE, dataRef: "othercar" };

const MIN = 60n * 1_000_000_000n;
/** Rows [t, value] every minute for an hour from T1. */
const rows = (offset: number): [bigint, number][] =>
  Array.from({ length: 60 }, (_, i) => [T1 + BigInt(i) * MIN, offset + i]);

/** Two data refs holding a signal of the same name, and one that only `othercar` has. */
export const SIGNALS = [
  { dataRef: "testcar", name: "Fast_100h.SIG_A", rows: rows(0) },
  { dataRef: "testcar", name: "Cyc_B10h.CYC", rows: rows(100) },
  { dataRef: "othercar", name: "Fast_100h.SIG_A", rows: rows(1000) },
  { dataRef: "othercar", name: "Secret_900h.ONLY", rows: rows(2000) },
];

/** An identity adapter that reads the user and the roles (comma list) from test headers. */
export function testIdentity(): IdentityAdapter {
  return {
    kind: "test",
    async identify(request) {
      const user = request.headers["x-test-user"];
      if (!user) return { refused: "unauthenticated" };
      const roles = (request.headers["x-test-roles"] ?? "")
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean);
      return { user, roles };
    },
  };
}

// biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary fields of the JSON answers
export type Answer = { status: number; body: any; text: string; headers: Record<string, any> };

const parse = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** A live channel connection and what it received. */
export class Live {
  readonly messages: LiveServerMessage[] = [];
  closeCode: number | undefined;
  /** HTTP status when the upgrade was refused. */
  status: number | undefined;
  opened = false;
  readonly ended: Promise<void>;
  private readonly ws: WebSocket;
  private readonly ready: Promise<void>;

  constructor(url: string, headers: Record<string, string>) {
    this.ws = new WebSocket(url, { headers });
    let settle: () => void = () => {};
    this.ended = new Promise<void>((resolve) => {
      settle = resolve;
    });
    let isOpen: () => void = () => {};
    this.ready = new Promise<void>((resolve) => {
      isOpen = resolve;
    });
    this.ws.on("open", () => {
      this.opened = true;
      isOpen();
    });
    this.ws.on("message", (data) => this.messages.push(JSON.parse(data.toString())));
    this.ws.on("unexpected-response", (_req, res) => {
      this.status = res.statusCode;
      res.resume();
      this.ws.terminate();
    });
    this.ws.on("error", () => {});
    this.ws.on("close", (code) => {
      this.closeCode = code;
      isOpen();
      settle();
    });
    // A server that accepts the connection never closes it; give up so a test fails, not hangs.
    realSetTimeout(() => this.ws.terminate(), 5000).unref();
  }

  /** Resolves when the connection opened or ended (a refused upgrade ends it). */
  async connected(): Promise<this> {
    await this.ready;
    return this;
  }

  /** The first message (from now on or already received) that `matches`. */
  async next(matches: (m: LiveServerMessage) => boolean, ms = 3000): Promise<LiveServerMessage> {
    let found: LiveServerMessage | undefined;
    await vi.waitFor(
      () => {
        found = this.messages.find(matches);
        if (!found)
          throw new Error(
            `no matching live message in ${JSON.stringify(this.messages).slice(0, 400)}`,
          );
      },
      { timeout: ms, interval: 10 },
    );
    return found as LiveServerMessage;
  }

  /** The latest message of a type. */
  last<T extends LiveServerMessage["type"]>(
    type: T,
  ): Extract<LiveServerMessage, { type: T }> | undefined {
    return [...this.messages].reverse().find((m) => m.type === type) as
      | Extract<LiveServerMessage, { type: T }>
      | undefined;
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  close(): void {
    this.ws.close();
  }

  /** Waits for the server to end the connection; its close code. */
  async closedBy(ms = 3000): Promise<number | undefined> {
    await Promise.race([this.ended, realSleep(ms)]);
    return this.closeCode;
  }
}

/** The requests of one user (or of nobody), through the app. */
export interface Client {
  readonly headers: Readonly<Record<string, string>>;
  get(url: string, headers?: Record<string, string>): Promise<Answer>;
  post(url: string, body?: unknown, headers?: Record<string, string>): Promise<Answer>;
  del(url: string, headers?: Record<string, string>): Promise<Answer>;
  request(
    method: "GET" | "POST" | "DELETE",
    url: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Answer>;
  command(body: unknown, workspace?: string): Promise<Answer>;
  /** Opens the live channel (`/api/live` or `/api/w/<id>/live`) as this client. */
  live(workspace?: string, headers?: Record<string, string>): Promise<Live>;
}

export interface MultiAppOptions {
  /** The adapter under test; default: an in-memory one holding `SIGNALS`. */
  adapter?: SourceAdapter;
  /** `full` (default) or `scoped`. */
  mode?: CatalogMode;
  /** The identity adapter: default `testIdentity()`; `"none"` runs without one (every grant is all). */
  identity?: IdentityAdapter | "none";
  /** `KIPSCOPE_SHARE` (default on); only read with an identity adapter. */
  share?: boolean;
  /** Read the test DBC files into the catalogs. */
  dbc?: boolean;
  /**
   * Per-user favourites in `<stateDir>/users/<user>/favourites.yaml` (add-favourites), wired like
   * `main.ts`. Off by default: without a store the live channel sends `hello`, `summary`, `state`
   * only, which the older tests expect.
   */
  favourites?: boolean;
  /** Load the full catalog before the app starts (full mode; default true). */
  loadFullCatalog?: boolean;
  /** An existing state dir (a restart); else a fresh temp dir removed on close. */
  stateDir?: string;
  /** A new workspace's content (the app filters events-line signals by the grant). */
  seed?: () => Workspace;
  /** Registry clock (default the real one). */
  now?: () => number;
  workspaceLimit?: number;
  idleDays?: number;
  webDir?: string;
  origins?: readonly string[];
  extraHost?: string;
  /** `KIPSCOPE_SCOPE_PAD` in ns. */
  scopePad?: bigint;
  /** `KIPSCOPE_SCAN_ROWS` (default: the config's 150 M). */
  scanRows?: number;
  /** `KIPSCOPE_SCAN_SPAN` in ns (default: the config's 7 d). */
  scanSpan?: bigint;
  /** Content of `LICENSE` for `GET /api/license`. */
  licenseText?: string;
  /**
   * The finder handoff of add-case-open (K4), over the defaults of `finderConfig()` in
   * `caseKit.ts` (no keys, issuer and audience of the test finder): passed to `buildApp` as `finder`,
   * the way `main.ts` passes `config.finder`.
   */
  finder?: Partial<FinderConfig>;
  /** Registers more on the app before it is ready (a route a test adds). */
  extend?: (app: ReturnType<typeof buildApp>) => void;
}

export interface MultiApp {
  app: ReturnType<typeof buildApp>;
  workspaces: WorkspaceRegistry;
  catalogs: CatalogStore;
  /** The scan bound and the calendar's vehicle-days the app was wired with. */
  bound: ScanBound;
  days: CalendarDays;
  /** The favourites store of the app (undefined unless `favourites` was set). */
  favouritesOf: FavouritesOf | undefined;
  /** The full catalog (never loaded in scoped mode). */
  catalog: Catalog;
  /** Everything the source adapter received, in order. */
  calls: Call[];
  stateDir: string;
  /** Warnings the registry logged. */
  warnings: string[];
  /** Requests as `user` with `roles`. */
  as(user: string, roles?: string[]): Client;
  /** Requests without any identity header. */
  anon: Client;
  /** Starts listening on a free loopback port; the base URL (`http://127.0.0.1:<port>`). */
  listen(): Promise<string>;
  close(): Promise<void>;
}

/** The real app on a temp state dir. */
export async function multiApp(options: MultiAppOptions = {}): Promise<MultiApp> {
  const mode = options.mode ?? "full";
  const { adapter, calls } = recording(
    options.adapter ?? (memoryAdapter(SIGNALS) as SourceAdapter),
  );
  const scanRows = options.scanRows ?? DEFAULT_SCAN_ROWS;
  const scanSpan = options.scanSpan ?? DEFAULT_SCAN_SPAN;
  const completed = completeSource(adapter, { scanRows });
  let catalogs: CatalogStore;
  const source: DataSource =
    mode === "scoped"
      ? guardScoped(completed, () => catalogs.scopes(), { error: () => {} })
      : completed;
  const metadata = () => (options.dbc ? loadDbcFiles(testDbcFiles) : Promise.resolve(new Map()));
  const newCatalog = (scope?: Scope) =>
    new Catalog(source, metadata, undefined, undefined, undefined, scope);
  const catalog = newCatalog();
  const own = options.stateDir === undefined;
  const stateDir = options.stateDir ?? mkdtempSync(join(tmpdir(), "kipscope-multi-"));

  const warnings: string[] = [];
  const identity = options.identity === "none" ? undefined : (options.identity ?? testIdentity());
  const seedOf = options.seed ?? (() => EMPTY_WORKSPACE);
  const workspaces = new WorkspaceRegistry({
    dir: stateDir,
    seed: (grant) => seedFor(seedOf(), grant),
    // A test adapter is a module adapter to the server: its workspaces start with an empty grant.
    identity: identity ? "module" : "none",
    idleDays: options.idleDays ?? 30,
    ...(options.now ? { now: options.now } : {}),
    ...(options.workspaceLimit === undefined ? {} : { limit: options.workspaceLimit }),
    log: { info: () => {}, warn: (m) => warnings.push(m) },
  });
  workspaces.start();
  const bound = createScanBound(source, { rows: scanRows, spanNs: scanSpan }, options.now);
  catalogs = new CatalogStore({
    mode,
    full: catalog,
    create: newCatalog,
    keep: () => openScopes(workspaces),
    bound,
  });
  const days = new CalendarDays(source, {
    dir: join(stateDir, "calendar"),
    sourceInfo: source.info,
    scanRows,
    ...(options.now ? { now: options.now } : {}),
    warn: (m) => warnings.push(m),
  });
  if (mode === "full" && options.loadFullCatalog !== false) await catalog.refresh();

  const favouritesOf = options.favourites ? userFavourites(stateDir) : undefined;
  const app = buildApp(
    {
      catalog,
      catalogs,
      source,
      bound,
      calendarDays: days,
      workspaces,
      viewsOf: userViews(stateDir),
      ...(favouritesOf ? { favouritesOf } : {}),
      finder: { ...finderConfig(), ...options.finder },
      ...(identity ? { identity, share: options.share ?? true } : {}),
      ...(options.webDir === undefined ? {} : { webDir: options.webDir }),
      ...(options.scopePad === undefined ? {} : { scopePad: options.scopePad }),
      ...(options.licenseText === undefined ? {} : { licenseText: options.licenseText }),
      meta: {
        build: { commit: null, dirty: false, startedAt: new Date("2026-10-19T08:00:00Z") },
        source: source.info,
        ping: (signal: AbortSignal) => source.ping(signal),
      },
    },
    {
      ...(options.extraHost === undefined ? {} : { extraHost: options.extraHost }),
      ...(options.origins === undefined ? {} : { origins: options.origins }),
    } as Parameters<typeof buildApp>[1],
  );
  options.extend?.(app);
  await app.ready();

  let base: string | undefined;
  const listen = async () => {
    base ??= await app.listen({ port: 0, host: "127.0.0.1" });
    return base;
  };
  const prefixed = (workspace: string | undefined, path: string) =>
    workspace === undefined ? `/api${path}` : `/api/w/${workspace}${path}`;

  const clientWith = (base_: Record<string, string>): Client => {
    const send = async (
      method: "GET" | "POST" | "DELETE",
      url: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ): Promise<Answer> => {
      const res = await app.inject({
        method,
        url,
        headers: { ...base_, ...headers },
        ...(body === undefined ? {} : { body: body as object }),
      });
      return {
        status: res.statusCode,
        body: parse(res.body),
        text: res.body,
        headers: res.headers,
      };
    };
    return {
      headers: base_,
      get: (url, headers) => send("GET", url, undefined, headers),
      post: (url, body, headers) => send("POST", url, body, headers),
      del: (url, headers) => send("DELETE", url, undefined, headers),
      request: send,
      command: (body, workspace) => send("POST", prefixed(workspace, "/commands"), body),
      async live(workspace, headers = {}) {
        const url = `${(await listen()).replace("http", "ws")}${prefixed(workspace, "/live")}`;
        return new Live(url, { ...base_, ...headers }).connected();
      },
    };
  };

  return {
    app,
    workspaces,
    catalogs,
    bound,
    days,
    favouritesOf,
    catalog,
    calls,
    stateDir,
    warnings,
    as: (user, roles = []) =>
      clientWith({
        "x-test-user": user,
        ...(roles.length ? { "x-test-roles": roles.join(",") } : {}),
      }),
    anon: clientWith({}),
    listen,
    async close() {
      // A caller may leave a request in flight (the CLI drops a parallel request after a failed
      // one); waiting for it would hold the close, so open connections are cut.
      const closing = app.close();
      app.server.closeAllConnections();
      await closing;
      days.stop();
      workspaces.stop();
      if (own) rmSync(stateDir, { recursive: true, force: true });
    },
  };
}

/**
 * Widens a workspace's grant the way `add-case-open` will: through the registry's `grantObjects`,
 * the one widening path (data-access "Only the server widens a grant"). Returns the entry.
 */
export function grant(app: Pick<MultiApp, "workspaces">, workspaceId: string, dataRefs: string[]) {
  const entry = app.workspaces.grantObjects(workspaceId, dataRefs);
  if (!entry) throw new Error(`grant: no workspace ${workspaceId}`);
  return entry;
}

/** Error code of an answer, whether `{error:{code}}` (apiError) or a CommandResult `{code}`. */
// biome-ignore lint/suspicious/noExplicitAny: loose JSON
export const codeOf = (body: any): string | undefined => body?.error?.code ?? body?.code;

/** A valid view document: one timeseries window per entry of `windows` (lists of signal IDs). */
export function viewDoc(
  windows: string[][],
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  const refs = [...new Set(windows.flat().map((id) => id.split("/")[0] as string))].sort();
  return {
    kipscope: "view",
    version: 1,
    title: "Fixture",
    saved: "2026-10-17T08:14:03Z",
    data: refs,
    linkTime: true,
    cursors: { diff: false },
    digits: 3,
    windows: windows.map((signals) => ({
      kind: "timeseries",
      from: "2026-10-01T01:00:00Z",
      to: "2026-10-01T01:30:00Z",
      mode: "line",
      envelope: false,
      signals,
    })),
    ...over,
  };
}

/** A recorded source call that names a data ref in any of its arguments (a scope, a ref or a name). */
export function callsNaming(calls: readonly Call[], dataRef: string): Call[] {
  const names = (value: unknown): boolean => {
    if (typeof value === "string") return value === dataRef || value.startsWith(`${dataRef}/`);
    if (Array.isArray(value)) return value.some(names);
    if (typeof value === "object" && value !== null) return Object.values(value).some(names);
    return false;
  };
  return calls.filter((c) => c.args.some(names));
}
