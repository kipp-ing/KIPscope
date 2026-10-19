import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import { WorkspaceStore } from "../src/workspace.ts";

/** Source whose count takes `delayMs` and records whether it was aborted. */
function slowSource(delayMs: number) {
  const seen: { aborted: boolean }[] = [];
  /** The `limit` each raw call got: the series route reads without one. */
  const limits: (number | undefined)[] = [];
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
    raw: async (_ref: unknown, _from: bigint, _to: bigint, limit?: number) => {
      limits.push(limit);
      return [];
    },
    before: async () => undefined,
    after: async () => undefined,
  } as unknown as DataSource;
  return { source, seen, limits };
}

describe("GET /api/series over a real connection", () => {
  const slow = slowSource(300);
  const catalog = new Catalog(slow.source, async () => new Map());
  const app = buildApp({
    catalog,
    source: slow.source,
    workspace: new WorkspaceStore({ signalExists: () => true, hasStates: () => false }),
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
    // The route passes no limit to `raw` (data-source C1).
    expect(slow.limits.length).toBeGreaterThan(0);
    expect(slow.limits.every((limit) => limit === undefined)).toBe(true);
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

describe("GET /api/extent over a real connection", () => {
  const seen: { aborted: boolean }[] = [];
  const source = {
    info: { kind: "clickhouse", database: "sdlog", table: "signals" },
    listSignals: async () => [{ dataRef: "car", name: "S" }],
    extent: (_ref: unknown, _scope?: unknown, abort?: AbortSignal) =>
      new Promise((_resolve, reject) => {
        const entry = { aborted: false };
        seen.push(entry);
        abort?.addEventListener("abort", () => {
          entry.aborted = true;
          reject(abort.reason);
        });
      }),
  } as unknown as DataSource;
  const catalog = new Catalog(source, async () => new Map());
  const app = buildApp({
    catalog,
    source,
    workspace: new WorkspaceStore({ signalExists: () => true, hasStates: () => false }),
  });
  let base = "";
  beforeAll(async () => {
    await catalog.refresh();
    base = await app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterAll(() => app.close());

  it("aborts the extent query when the client disconnects", async () => {
    const controller = new AbortController();
    const pending = fetch(`${base}/api/extent?signal=car/S`, { signal: controller.signal }).catch(
      () => "aborted",
    );
    await expect.poll(() => seen.length).toBe(1);
    controller.abort();
    expect(await pending).toBe("aborted");
    await expect.poll(() => seen[0]?.aborted).toBe(true);
  });
});
