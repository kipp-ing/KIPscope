import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@kipscope/shared";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource, SignalRef } from "../src/datasource.ts";
import { ViewStore } from "../src/views.ts";
import { WorkspaceStore } from "../src/workspace.ts";

export const SIGNALS: SignalRef[] = [
  { dataRef: "testcar", name: "Sna_800h.RPM" },
  { dataRef: "testcar", name: "Sna_800h.SPEED" },
  { dataRef: "testcar", name: "Fast_100h.SIG_A" },
];

/** Source with the signal list only; the catalog refresh needs nothing else here. */
const source = {
  listSignals: async () => SIGNALS,
  extent: async () => undefined,
  textSignals: async () => [],
} as unknown as DataSource;

// biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary fields of the JSON answers
export type Answer = { status: number; body: any };

export interface ViewsApp {
  app: ReturnType<typeof buildApp>;
  store: WorkspaceStore;
  views: ViewStore;
  catalog: Catalog;
  /** Temp state dir; views live in `<stateDir>/views`. */
  stateDir: string;
  viewsDir: string;
  /** Every (revision, command type) the store pushed, like a live client would see. */
  pushes: { revision: number; command: string }[];
  get(url: string): Promise<Answer & { headers: Record<string, unknown>; text: string }>;
  post(url: string, body: unknown): Promise<Answer>;
  del(url: string): Promise<Answer>;
  close(): Promise<void>;
}

/**
 * The real app on a temp state dir. `initial`: workspace and revision the store starts with.
 * `loadCatalog: false` leaves the catalog never loaded (503 `catalog_unavailable` on open).
 *
 * The `beforeOpen` hook is wired like `main.ts` does it (design V5): `views.beforeOpen`.
 */
export async function viewsApp(
  options: { loadCatalog?: boolean; initial?: { revision: number; workspace: Workspace } } = {},
): Promise<ViewsApp> {
  const stateDir = mkdtempSync(join(tmpdir(), "kipscope-views-"));
  const viewsDir = join(stateDir, "views");
  mkdirSync(viewsDir, { recursive: true });
  const views = new ViewStore(viewsDir);
  const catalog = new Catalog(source, async () => new Map());
  if (options.loadCatalog !== false) await catalog.refresh();
  const store = new WorkspaceStore(
    {
      signalExists: (id) => catalog.get(id) !== undefined,
      hasStates: () => false,
      catalogReady: () => catalog.loadedAt !== undefined,
    },
    {
      ...(options.initial ? { initial: options.initial } : {}),
      beforeOpen: (previous: Workspace) => views.beforeOpen(previous),
    },
  );
  const pushes: { revision: number; command: string }[] = [];
  store.subscribe((revision, _ws, command) => pushes.push({ revision, command }));
  const app = buildApp({ catalog, source, workspace: store, views });
  await app.ready();
  const parse = (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };
  return {
    app,
    store,
    views,
    catalog,
    stateDir,
    viewsDir,
    pushes,
    async get(url) {
      const res = await app.inject({ method: "GET", url });
      return {
        status: res.statusCode,
        body: parse(res.body),
        headers: res.headers,
        text: res.body,
      };
    },
    async post(url, body) {
      const res = await app.inject({ method: "POST", url, body: body as object });
      return { status: res.statusCode, body: parse(res.body) };
    },
    async del(url) {
      const res = await app.inject({ method: "DELETE", url });
      return { status: res.statusCode, body: parse(res.body) };
    },
    async close() {
      await app.close();
      rmSync(stateDir, { recursive: true, force: true });
    },
  };
}

/** Error code of an answer, whether it is `{error:{code}}` (apiError) or a CommandResult `{code}`. */
// biome-ignore lint/suspicious/noExplicitAny: loose JSON
export const codeOf = (body: any): string | undefined => body?.error?.code ?? body?.code;
