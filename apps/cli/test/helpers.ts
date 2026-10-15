import { createServer, type Server } from "node:net";
import { buildApp } from "../../server/src/app.ts";
import { Catalog } from "../../server/src/catalog.ts";
import type { DataSource, RawPoint, SignalRef } from "../../server/src/datasource.ts";
import { WorkspaceStore } from "../../server/src/workspace.ts";
import type { Io } from "../src/run.ts";
import { run } from "../src/run.ts";

/** Seconds of 2026-10-01T02:00:00Z, the stub signals' time base, in ns. */
export const T0 = 1790820000000000000n;

/** Stub catalog: ids testcar/Sna_800h.RPM, testcar/Sna_800h.SPEED, testcar/Fast_100h.SIG_A, othercar/Fast_100h.SIG_A. */
const SIGNALS: SignalRef[] = [
  { dataRef: "testcar", name: "Sna_800h.RPM" },
  { dataRef: "testcar", name: "Sna_800h.SPEED" },
  { dataRef: "testcar", name: "Fast_100h.SIG_A" },
  { dataRef: "othercar", name: "Fast_100h.SIG_A" },
];

const id = (r: SignalRef) => `${r.dataRef}/${r.name}`;

/**
 * SPEED: extent T0 ... T0 + 99.9 s; points 10 at T0 + 1 s and 11 at T0 + 1.1 s (and nothing else
 * that the tests read). Other signals have no points.
 */
const POINTS = new Map<string, RawPoint[]>([
  [
    "testcar/Sna_800h.SPEED",
    [
      { t: T0 + 1_000_000_000n, v: 10 },
      { t: T0 + 1_100_000_000n, v: 11 },
    ],
  ],
]);
const EXTENTS = new Map<string, { first: bigint; last: bigint }>([
  ["testcar/Sna_800h.SPEED", { first: T0, last: T0 + 99_900_000_000n }],
]);

/** In-memory data source; only listSignals, extent, before and after are meaningful. */
export function stubSource(): DataSource {
  const unused = async () => {
    throw new Error("not used by the CLI tests");
  };
  return {
    listSignals: async () => SIGNALS,
    extent: async (ref) => EXTENTS.get(id(ref)),
    before: async (ref, t) => [...(POINTS.get(id(ref)) ?? [])].reverse().find((p) => p.t < t),
    after: async (ref, t) => (POINTS.get(id(ref)) ?? []).find((p) => p.t >= t),
    count: unused,
    raw: unused,
    buckets: unused,
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

// Loose view of the workspace: tests only read a few fields, and the type lives in @letsview/shared.
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
}

/**
 * Starts the real server app in-process on a free port with the stub source and catalog.
 * `loadCatalog: false` leaves the catalog unloaded (503 `catalog_unavailable`).
 */
export async function startServer(options: { loadCatalog?: boolean } = {}): Promise<Harness> {
  const source = stubSource();
  const catalog = new Catalog(source, async () => new Map());
  if (options.loadCatalog !== false) await catalog.refresh();
  const store = new WorkspaceStore({
    signalExists: (signalId) => catalog.get(signalId) !== undefined,
    unitOf: (signalId) => catalog.get(signalId)?.unit,
  });
  const app = buildApp({ catalog, source, workspace: store });
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

/** Runs the CLI against a harness server: `letsview --server <url> <args…>`. */
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
