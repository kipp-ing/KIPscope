import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import { WorkspaceStore } from "../src/workspace.ts";

/** Source whose count takes `delayMs` and records whether it was aborted. */
function slowSource(delayMs: number) {
  const seen: { aborted: boolean }[] = [];
  const source = {
    count: (_ref: unknown, _from: bigint, _to: bigint, abort?: AbortSignal) =>
      new Promise<number>((resolve, reject) => {
        const entry = { aborted: false };
        seen.push(entry);
        const timer = setTimeout(() => resolve(0), delayMs);
        abort?.addEventListener("abort", () => {
          entry.aborted = true;
          clearTimeout(timer);
          reject(abort.reason);
        });
      }),
    listSignals: async () => [{ dataRef: "car", name: "S" }],
    raw: async () => [],
    before: async () => undefined,
    after: async () => undefined,
  } as unknown as DataSource;
  return { source, seen };
}

describe("GET /api/series over a real connection", () => {
  const slow = slowSource(300);
  const catalog = new Catalog(slow.source, async () => new Map());
  const app = buildApp({
    catalog,
    source: slow.source,
    workspace: new WorkspaceStore({ signalExists: () => true }),
  });
  let base = "";
  beforeAll(async () => {
    // Series need a loaded catalog (SNA ranges), see series.http.test.ts.
    await catalog.refresh();
    base = await app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterAll(() => app.close());

  const url = () => `${base}/api/series?signal=car/S&from=0&to=1000`;

  it("does not abort a request that the client keeps open", async () => {
    const res = await fetch(url());
    expect(res.status).toBe(200);
    expect((await res.json()).kind).toBe("raw");
    expect(slow.seen.at(-1)?.aborted).toBe(false);
  });

  it("aborts the queries when the client disconnects", async () => {
    const controller = new AbortController();
    const pending = fetch(url(), { signal: controller.signal }).catch(() => "aborted");
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    expect(await pending).toBe("aborted");
    await new Promise((r) => setTimeout(r, 50));
    expect(slow.seen.at(-1)?.aborted).toBe(true);
  });
});
