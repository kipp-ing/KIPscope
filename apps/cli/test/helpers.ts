import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { EventRow, StateRow } from "@kipscope/shared";
import { buildApp } from "../../server/src/app.ts";
import { Catalog } from "../../server/src/catalog.ts";
import type {
  DataSource,
  RawPoint,
  Scope,
  SignalRef,
  SourceSignal,
} from "../../server/src/datasource.ts";
import { loadDbcFiles } from "../../server/src/dbc.ts";
import { CatalogStore } from "../../server/src/scope.ts";
import { ViewStore } from "../../server/src/views.ts";
import { WorkspaceStore } from "../../server/src/workspace.ts";
import type { Io } from "../src/run.ts";
import { run } from "../src/run.ts";

/** Seconds of 2026-10-01T02:00:00Z, the stub signals' time base, in ns. */
export const T0 = 1790820000000000000n;

/**
 * Stub catalog: ids testcar/Sna_800h.RPM, testcar/Sna_800h.SPEED, testcar/Fast_100h.SIG_A,
 * othercar/Fast_100h.SIG_A, and the state signals of add-events: testcar/Ign_A20h.MODE (`VAL_` labels
 * from the server's test DBC) and testcar/DIAG.door (rows with text).
 */
const SIGNALS: SourceSignal[] = [
  { dataRef: "testcar", name: "Sna_800h.RPM" },
  { dataRef: "testcar", name: "Sna_800h.SPEED" },
  { dataRef: "testcar", name: "Fast_100h.SIG_A" },
  { dataRef: "othercar", name: "Fast_100h.SIG_A" },
  { dataRef: "testcar", name: "Ign_A20h.MODE" },
  // The text flag replaces the old textSignals call (data-source "Source data model").
  { dataRef: "testcar", name: "DIAG.door", text: true },
];

/** 2026-10-01T00:00:00Z, base B of design T of add-events, in ns. */
const B = 1790812800000000000n;
const at = (h: number, m: number, s: number, ms = 0) =>
  String(B + BigInt(((h * 60 + m) * 60 + s) * 1000 + ms) * 1_000_000n);

/** The 18 testcar rows of design T (the row without a time is never returned), time order. */
const EVENT_ROWS: EventRow[] = [
  ["VCU", "state", "VCU.door", 0, "closed", "initial", at(1, 0, 0)],
  ["VCU", "state", "VCU.door", 0, "closed", "initial", at(1, 1, 30)],
  ["VCU", "state", "VCU.door", 0, "open", "from closed", at(1, 3, 0)],
  ["VCU", "state", "VCU.door", 0, "open", "initial", at(1, 4, 30)],
  ["VCU", "state", "DIAG.lock", 0, "locked", "initial", at(2, 0, 0)],
  ["VCU", "state", "VCU.door", 0, "closed", "initial", at(2, 0, 0)],
  ["BMS", "nrc", "SID 22", 49, "requestOutOfRange", "", at(3, 0, 0)],
  ["BMS", "isotp", "incomplete", 132, "", "132 of 403 bytes, then a new message", at(3, 0, 1)],
  ["VCU", "note", "boot", 0, "logger restarted", "", at(4, 0, 0)],
  ["BMS", "dtc", "P0AA100", 64, "Positive contactor jammed closed", "initial", at(5, 0, 0)],
  ["BMS", "dtc", "P0C4600", 80, "Coolant temperature sensor sporadic", "initial", at(5, 0, 0)],
  ["BMS", "dtc", "P0C7800", 36, "Precharge too long", "initial", at(5, 0, 0)],
  ["BMS", "dtc", "P0CA700", 41, "Discharge current too high", "initial", at(5, 0, 0)],
  ["BMS", "dtc", "P0E1A00", 0, "Coolant pump B open circuit", "initial", at(5, 0, 0)],
  ["BMS", "dtc", "P0FFF00", 3.5, "Odd status", "initial", at(5, 0, 0)],
  ["BMS", "dtc", "P180D13", 105, "System shutoff. Circuit Open", "initial", at(5, 0, 0)],
  ["BMS", "dtc", "P1CA100", 40, "Insulation fault, open contactors", "initial", at(5, 0, 0)],
  ["BMS", "dtc", "U019B00", 128, "Communication with on-board charger", "initial", at(5, 0, 0)],
].map(([source, kind, name, value, text, detail, t]) => ({
  t: t as string,
  source: source as string,
  kind: kind as string,
  name: name as string,
  value: value as number,
  text: text as string,
  detail: detail as string,
}));

/** Ign_A20h.MODE: NONE from 01:00:00, KEYON from 01:10:00 (changed rows only, as the source returns them). */
const MODE_CHANGES: StateRow[] = [
  { t: at(1, 0, 0), value: 0, text: "" },
  {
    t: at(1, 10, 0),
    value: 3,
    text: "",
    prev: { t: at(1, 9, 59, 900), value: 0, text: "" },
  },
];

/** Only the labels of the state signals of the server's test DBC (units and SNA of the others stay out). */
const loadStubDbc = async () => {
  const all = await loadDbcFiles([
    resolve(import.meta.dirname, "../../server/test/fixtures/test-a.dbc"),
  ]);
  return new Map([...all].filter(([name]) => name.startsWith("Ign_A20h.")));
};

const id = (r: SignalRef) => `${r.dataRef}/${r.name}`;

/**
 * SPEED: extent T0 ... T0 + 99.9 s; points 10 at T0 + 1 s, 11 at T0 + 1.1 s and 12 at T0 + 5 s (and nothing else
 * that the tests read). Other signals have no points.
 */
const POINTS = new Map<string, RawPoint[]>([
  // MODE is KEYON (3) at 01:20:00 and 01:20:00.1.
  [
    "testcar/Ign_A20h.MODE",
    [
      { t: B + 4_800_000_000_000n, v: 3 },
      { t: B + 4_800_100_000_000n, v: 3 },
    ],
  ],
  [
    "testcar/Sna_800h.SPEED",
    [
      { t: T0 + 1_000_000_000n, v: 10 },
      { t: T0 + 1_100_000_000n, v: 11 },
      // Point 12 after the logger gap of the stub (add-gap-display G8).
      { t: T0 + 5_000_000_000n, v: 12 },
    ],
  ],
]);
const EXTENTS = new Map<string, { first: bigint; last: bigint }>([
  ["testcar/Sna_800h.SPEED", { first: T0, last: T0 + 99_900_000_000n }],
]);

/** In-memory data source; only info, ping, listSignals, extent, before and after are meaningful. */
export function stubSource(): DataSource {
  const unused = async () => {
    throw new Error("not used by the CLI tests");
  };
  return {
    info: { kind: "clickhouse", database: "sdlog", table: "signals", eventsTable: "sdlog.events" },
    ping: async () => {},
    // A scope's list is the signals of its data ref (the stub keeps no per-row times for the rest).
    listSignals: async (scope?: Scope) =>
      scope ? SIGNALS.filter((s) => s.dataRef === scope.dataRef) : SIGNALS,
    extent: async (ref) => EXTENTS.get(id(ref)),
    before: async (ref, t) => [...(POINTS.get(id(ref)) ?? [])].reverse().find((p) => p.t < t),
    after: async (ref, t) => (POINTS.get(id(ref)) ?? []).find((p) => p.t >= t),
    count: unused,
    raw: unused,
    buckets: unused,
    refExtent: unused,
    refBuckets: unused,
    // testcar's logger paused from T0 + 2 s to T0 + 4 s; the others never (add-gap-display G8).
    loggerGaps: async (dataRef) => ({
      gaps: dataRef === "testcar" ? [{ from: T0 + 2_000_000_000n, to: T0 + 4_000_000_000n }] : [],
      last: T0 + 99_900_000_000n,
    }),
    // No signal has a measurable period in the stub.
    firstTimes: async () => new Map(),
    // Constant row count: the gap info never refreshes in the stub (add-gap-display G9).
    refCount: async () => 1,
    events: async (dataRef) => (dataRef === "testcar" ? EVENT_ROWS : []),
    stateChanges: async (ref) => (ref.name === "Ign_A20h.MODE" ? MODE_CHANGES : []),
  };
}

export interface FakeBrowser {
  readonly clientId: string;
  /** Newest `state` revision the server pushed. */
  readonly revision: () => number;
  /** Sends `rendered` and resolves once the server's render status shows it. */
  ack(
    revision: number,
    status?: "complete" | "error",
    errors?: { windowId?: string; signalId?: string; message: string }[],
  ): Promise<void>;
  close(): Promise<void>;
}

export interface Harness {
  /** Base URL, e.g. http://127.0.0.1:41234 */
  url: string;
  store: WorkspaceStore;
  catalog: Catalog;
  /** The server's view store, on a temp dir that `close()` removes (add-saved-views). */
  views: ViewStore;
  /** Directory of the view files. */
  viewsDir: string;
  /** "METHOD path" of every request the server received. */
  requests: string[];
  /** POSTs a command straight to the server (not through the CLI). */
  command(body: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** GET /api/workspace. */
  workspace(): Promise<{ revision: number; workspace: Workspace }>;
  /**
   * A browser stand-in on WS /api/live. `autoAckMs`: acknowledge every new state revision as
   * "complete" that long after it arrives (omit for manual `ack`).
   */
  browser(options?: { autoAckMs?: number }): Promise<FakeBrowser>;
  close(): Promise<void>;
}

// Loose view of the workspace: tests only read a few fields, and the type lives in @kipscope/shared.
export interface Workspace {
  windows: {
    id: string;
    kind: string;
    title?: string;
    range?: { from: string; to: string };
    display?: { mode: string; envelope: boolean };
    height?: number;
    signals: { id: string; signalId: string }[];
  }[];
  linkTime: boolean;
  cursors: { a?: string; b?: string; diff: boolean };
  options: { digits: number };
  view?: { name?: string; title: string; note?: string; modified: boolean };
  scope?: { dataRef: string; from: string; to: string };
}

/**
 * Starts the real server app in-process on a free port with the stub source and catalog.
 * `loadCatalog: false` leaves the catalog unloaded (503 `catalog_unavailable`).
 */
export async function startServer(options: { loadCatalog?: boolean } = {}): Promise<Harness> {
  const source = stubSource();
  const catalog = new Catalog(source, loadStubDbc);
  if (options.loadCatalog !== false) await catalog.refresh();
  const viewsDir = join(mkdtempSync(join(tmpdir(), "kipscope-cli-views-")), "views");
  const views = new ViewStore(viewsDir);
  const store = new WorkspaceStore(
    {
      signalExists: (signalId) => catalog.get(signalId) !== undefined,
      unitOf: (signalId) => catalog.get(signalId)?.unit,
      hasStates: (signalId) => catalog.get(signalId)?.states !== undefined,
      catalogReady: () => catalog.loadedAt !== undefined,
    },
    { beforeOpen: (previous) => views.beforeOpen(previous) },
  );
  // The signal lists of scopes carry the same DBC metadata as the full catalog (add-scope Z10).
  const catalogs = new CatalogStore({
    mode: "full",
    full: catalog,
    create: (scope: Scope) =>
      new Catalog(source, loadStubDbc, undefined, undefined, undefined, scope),
  });
  // `scope show` reads /api/meta, so the harness serves it (the source answers every ping).
  const meta = {
    build: { commit: null, dirty: false, startedAt: new Date("2026-10-19T08:00:00Z") },
    source: source.info,
    ping: async () => {},
  };
  const app = buildApp({ catalog, catalogs, source, workspace: store, views, meta } as Parameters<
    typeof buildApp
  >[0]);
  const requests: string[] = [];
  app.addHook("onRequest", async (request) => {
    requests.push(`${request.method} ${request.url.split("?")[0]}`);
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (typeof address !== "object" || address === null) throw new Error("no address");
  const url = `http://127.0.0.1:${address.port}`;
  const sockets = new Set<FakeBrowser>();

  const harness: Harness = {
    url,
    store,
    catalog,
    views,
    viewsDir,
    requests,
    async command(body) {
      const res = await fetch(`${url}/api/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return (await res.json()) as Record<string, unknown>;
    },
    async workspace() {
      return (await (await fetch(`${url}/api/workspace`)).json()) as {
        revision: number;
        workspace: Workspace;
      };
    },
    async browser(browserOptions = {}) {
      const ws = new WebSocket(`${url.replace("http", "ws")}/api/live`);
      let clientId = "";
      let revision = 0;
      const timers = new Set<ReturnType<typeof setTimeout>>();
      const send = (rendered: number, status: string, errors?: unknown[]) =>
        ws.send(JSON.stringify({ type: "rendered", revision: rendered, status, errors }));
      const hello = new Promise<void>((resolve, reject) => {
        ws.addEventListener("error", () => reject(new Error("fake browser: websocket error")));
        ws.addEventListener("message", (event) => {
          const message = JSON.parse(String(event.data)) as {
            type: string;
            clientId?: string;
            revision?: number;
          };
          if (message.type === "hello") {
            clientId = message.clientId ?? "";
            resolve();
          } else if (message.type === "state") {
            revision = message.revision ?? 0;
            if (browserOptions.autoAckMs !== undefined) {
              const rev = revision;
              const timer = setTimeout(() => {
                timers.delete(timer);
                if (ws.readyState === WebSocket.OPEN) send(rev, "complete", []);
              }, browserOptions.autoAckMs);
              timers.add(timer);
            }
          }
        });
      });
      await hello;
      const browser: FakeBrowser = {
        get clientId() {
          return clientId;
        },
        revision: () => revision,
        async ack(rev, status = "complete", errors = []) {
          send(rev, status, errors);
          for (let i = 0; i < 100; i++) {
            const res = await fetch(`${url}/api/render-status`);
            const body = (await res.json()) as {
              clients: { clientId: string; rendered?: { revision: number } }[];
            };
            const mine = body.clients.find((c) => c.clientId === clientId);
            if ((mine?.rendered?.revision ?? -1) >= rev) return;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          throw new Error(`fake browser: server never showed revision ${rev} as rendered`);
        },
        async close() {
          for (const timer of timers) clearTimeout(timer);
          sockets.delete(browser);
          if (ws.readyState === WebSocket.CLOSED) return;
          const closed = new Promise<void>((resolve) =>
            ws.addEventListener("close", () => resolve()),
          );
          ws.close();
          await closed;
        },
      };
      sockets.add(browser);
      return browser;
    },
    async close() {
      for (const browser of [...sockets]) await browser.close();
      await app.close();
      rmSync(join(viewsDir, ".."), { recursive: true, force: true });
    },
  };
  return harness;
}

export interface CliResult {
  code: number;
  stdout: string[];
  stderr: string[];
  /** The one JSON object on stdout (undefined for `--help` and when stdout is not JSON). */
  // biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary fields of the output
  out: any;
  /** Wall time of the call. */
  ms: number;
}

/** Runs `run(argv, io)` in-process with captured output. `env` replaces the process env. */
export async function runCli(
  argv: string[],
  env: Record<string, string | undefined> = {},
): Promise<CliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: Io = { env, stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) };
  const started = performance.now();
  const code = await run(argv, io);
  const ms = performance.now() - started;
  let out: unknown;
  try {
    out = stdout.length === 1 ? JSON.parse(stdout[0] as string) : undefined;
  } catch {
    out = undefined;
  }
  return { code, stdout, stderr, out, ms };
}

/** Runs the CLI against a harness server: `kipscope --server <url> <args…>`. */
export function cli(h: Harness, ...argv: string[]): Promise<CliResult> {
  return runCli(["--server", h.url, ...argv]);
}

/** A TCP listener that accepts connections and never answers. */
export async function startHangingServer(): Promise<{ url: string; close(): Promise<void> }> {
  const sockets = new Set<import("node:net").Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("no address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** A URL on which nothing listens (a port that was free a moment ago). */
export async function closedUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("no address");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${address.port}`;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
