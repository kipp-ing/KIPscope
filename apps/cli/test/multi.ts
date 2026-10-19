/**
 * A real server with sessions and an identity (add-multiuser) for the CLI tests: the server's own
 * multi-user test app over the CLI tests' stub source, listening on a free loopback port.
 */
import type { SourceAdapter } from "../../server/src/datasource.ts";
import type { IdentityAdapter } from "../../server/src/identity.ts";
import { type MultiApp, type MultiAppOptions, multiApp } from "../../server/test/identityApp.ts";
import { stubSource } from "./helpers.ts";

export interface MultiServer {
  /** Base URL, e.g. http://127.0.0.1:41234 */
  url: string;
  app: MultiApp;
  /** Requests the identity adapter was asked about: one per API request that reached the guard. */
  identified: () => number;
  /** A browser stand-in on `/api/s/<session>/live` that acknowledges every revision it is sent. */
  browser(session: string, options?: { autoAckMs?: number }): Promise<{ close(): Promise<void> }>;
  close(): Promise<void>;
}

/** Counts how often the adapter was asked, without changing its answers. */
function counting(adapter: IdentityAdapter): { adapter: IdentityAdapter; count: () => number } {
  let n = 0;
  return {
    adapter: {
      kind: adapter.kind,
      identify: (request) => {
        n++;
        return adapter.identify(request);
      },
      ...(adapter.close ? { close: () => adapter.close?.() as Promise<void> } : {}),
    },
    count: () => n,
  };
}

export async function startMulti(options: MultiAppOptions = {}): Promise<MultiServer> {
  const counted =
    options.identity === undefined || options.identity === "none"
      ? undefined
      : counting(options.identity);
  const identity = counted ? counted.adapter : options.identity;
  const app = await multiApp({
    adapter: stubSource() as unknown as SourceAdapter,
    ...options,
    ...(identity === undefined ? {} : { identity }),
  });
  const url = await app.listen();
  const open = new Set<WebSocket>();
  return {
    url,
    app,
    identified: () => counted?.count() ?? 0,
    async browser(session, browserOptions = {}) {
      const ws = new WebSocket(`${url.replace("http", "ws")}/api/s/${session}/live`);
      open.add(ws);
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener("error", () => reject(new Error("fake browser: websocket error")));
        ws.addEventListener("message", (event) => {
          const message = JSON.parse(String(event.data)) as { type: string; revision?: number };
          if (message.type === "state" && browserOptions.autoAckMs !== undefined) {
            const revision = message.revision ?? 0;
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN)
                ws.send(
                  JSON.stringify({ type: "rendered", revision, status: "complete", errors: [] }),
                );
            }, browserOptions.autoAckMs);
          }
          if (message.type === "state") resolve();
        });
      });
      return {
        async close() {
          open.delete(ws);
          if (ws.readyState === WebSocket.CLOSED) return;
          const closed = new Promise<void>((resolve) =>
            ws.addEventListener("close", () => resolve()),
          );
          ws.close();
          await closed;
        },
      };
    },
    async close() {
      for (const ws of open) ws.close();
      await app.close();
    },
  };
}
