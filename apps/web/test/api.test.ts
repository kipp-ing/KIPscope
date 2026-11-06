import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  fetchCursorValue,
  fetchExtent,
  fetchSeries,
  sendCommand,
  setComputedDefs,
  signalInfo,
} from "../src/api.ts";
import { retryable } from "../src/chart/loader.ts";

const REQUEST = { signalId: "c/s", from: "0", to: "1000", target: 257 };

async function failure(response: Response | Error): Promise<unknown> {
  vi.stubGlobal("fetch", () =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  try {
    await fetchSeries(REQUEST, new AbortController().signal);
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("api errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws errors with HTTP status and code", async () => {
    const apiBody = JSON.stringify({ error: { code: "source_error", message: "timeout" } });
    const e502 = await failure(new Response(apiBody, { status: 502 }));
    expect(e502).toBeInstanceOf(ApiRequestError);
    expect(e502).toMatchObject({
      status: 502,
      code: "source_error",
      message: "source_error: timeout",
    });
    expect(retryable(e502)).toBe(true);

    const html = await failure(
      new Response("<html>Bad Gateway</html>", { status: 502, statusText: "Bad Gateway" }),
    );
    expect(html).toBeInstanceOf(ApiRequestError);
    expect(html).toMatchObject({ status: 502, code: "http_502", message: "http_502: Bad Gateway" });
    expect(retryable(html)).toBe(true);

    const notFound = JSON.stringify({
      error: { code: "unknown_signal", message: "no such signal" },
    });
    const e404 = await failure(new Response(notFound, { status: 404 }));
    expect(e404).toMatchObject({
      status: 404,
      code: "unknown_signal",
      message: "unknown_signal: no such signal",
    });
    expect(retryable(e404)).toBe(false);

    // A network failure has no status and is retryable.
    expect(retryable(await failure(new TypeError("Failed to fetch")))).toBe(true);
  });
});

describe("sendCommand", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const command = { type: "window.rename", windowId: "w1", title: "x" } as const;

  it("sendCommand resolves every failure to a rejected result", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    const network = await sendCommand(command);
    expect(network).toMatchObject({ ok: false, code: "network" });
    expect(!network.ok && network.message).toContain("Failed to fetch");

    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response("<html>Bad Gateway</html>", { status: 502, statusText: "Bad Gateway" }),
      ),
    );
    const proxy = await sendCommand(command);
    expect(proxy).toMatchObject({ ok: false, code: "bad_response" });
    expect(!proxy.ok && proxy.message).toContain("502");

    vi.stubGlobal("fetch", () => Promise.resolve(new Response('{"foo":1}', { status: 200 })));
    const foreign = await sendCommand(command);
    expect(foreign).toMatchObject({ ok: false, code: "bad_response" });
    expect(!foreign.ok && foreign.message.length).toBeGreaterThan(0);
  });
});

describe("computed requests (improve-formula-editor)", () => {
  const C7 = { id: "c7", name: "Diff", formula: "A.X - B.Y" };
  const C8 = { id: "c8", name: "AbsDiff", formula: "abs(Diff)" };

  /** Stubs fetch with an empty answer and records the request URLs. */
  function recording() {
    const urls: URL[] = [];
    vi.stubGlobal("fetch", (input: string | URL | Request) => {
      urls.push(new URL(String(input), "http://kipscope.test"));
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    return urls;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    setComputedDefs([]);
  });

  // spec computed-signals "Parameters and gap signals"
  it("adds the formula to computed requests", async () => {
    setComputedDefs([C7, C8]);
    const urls = recording();
    const abort = new AbortController().signal;

    await fetchSeries({ signalId: "car/=c8", from: "0", to: "1000", target: 257 }, abort);
    await fetchCursorValue("other/=c7", "500", "step", abort);
    await fetchExtent("car/=c8", { abort });
    const [series, value, extent] = urls as [URL, URL, URL];
    // The flattened formula over source signals, URL-encoded; the signal ID stays as asked.
    expect(series.pathname).toBe("/api/series");
    expect(series.searchParams.get("signal")).toBe("car/=c8");
    expect(series.searchParams.get("formula")).toBe("abs(A.X - B.Y)");
    expect(series.search).toContain("formula=abs%28A.X+-+B.Y%29");
    // a and b are gone.
    for (const name of ["a", "b"]) expect(series.searchParams.has(name)).toBe(false);
    // By the `=<id>` part: another session's data ref gets the same parameters.
    expect(value.pathname).toBe("/api/value");
    expect(value.searchParams.get("signal")).toBe("other/=c7");
    expect(value.searchParams.get("formula")).toBe("A.X - B.Y");
    expect(value.searchParams.get("mode")).toBe("step");
    for (const name of ["a", "b"]) expect(value.searchParams.has(name)).toBe(false);
    expect(extent.pathname).toBe("/api/extent");
    expect(extent.searchParams.get("formula")).toBe("abs(A.X - B.Y)");
    for (const name of ["a", "b"]) expect(extent.searchParams.has(name)).toBe(false);

    // A plain signal carries none of them.
    await fetchSeries({ signalId: "car/A.X", from: "0", to: "1000", target: 257 }, abort);
    const plain = urls[3] as URL;
    for (const name of ["formula", "a", "b"]) expect(plain.searchParams.has(name)).toBe(false);
    expect(urls).toHaveLength(4);
  });

  it("flattens nested definitions with quoted names and constants", async () => {
    setComputedDefs([C7, C8, { id: "c9", name: "Plus", formula: 'abs(Diff) + "AbsDiff" * 2' }]);
    const urls = recording();
    await fetchSeries(
      { signalId: "car/=c9", from: "0", to: "1000", target: 257 },
      new AbortController().signal,
    );
    expect((urls[0] as URL).searchParams.get("formula")).toBe(
      "abs(A.X - B.Y) + abs(A.X - B.Y) * 2",
    );
  });

  it("rejects a computed ID without a definition and sends nothing", async () => {
    setComputedDefs([C7]);
    const urls = recording();
    const abort = new AbortController().signal;
    const calls = [
      () => fetchSeries({ signalId: "car/=c9", from: "0", to: "1000", target: 257 }, abort),
      () => fetchCursorValue("car/=c9", "500", "line", abort),
      () => fetchExtent("car/=c9"),
    ];
    for (const call of calls) {
      const error = await call().then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error).toMatchObject({ code: "unknown_computed" });
    }
    expect(urls).toEqual([]);
    // Definitions replace each other: c7 is gone after setComputedDefs([]).
    setComputedDefs([]);
    const gone = await fetchSeries(
      { signalId: "car/=c7", from: "0", to: "1000", target: 257 },
      abort,
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(gone).toMatchObject({ code: "unknown_computed" });
    expect(urls).toEqual([]);
  });

  it("rejects a definition that does not flatten and sends nothing", async () => {
    // A cycle (c1 uses c2 uses c1) cannot be sent.
    setComputedDefs([
      { id: "c1", name: "P", formula: "Q + 1" },
      { id: "c2", name: "Q", formula: "P + 1" },
    ]);
    const urls = recording();
    const error = await fetchSeries(
      { signalId: "car/=c1", from: "0", to: "1000", target: 257 },
      new AbortController().signal,
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ code: "unknown_computed" });
    expect(urls).toEqual([]);
  });
});

describe("qualified signal IDs (add-adx-databases 3.4)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Stubs fetch with `body`; returns the URLs it was asked for. */
  function stub(body: unknown): URL[] {
    const urls: URL[] = [];
    vi.stubGlobal("fetch", (input: string) => {
      urls.push(new URL(input, "http://localhost"));
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    return urls;
  }

  it("sends the whole ID, colon included, in a series request", async () => {
    const urls = stub({ kind: "raw", t: "", v: [] });
    await fetchSeries(
      { signalId: "prod:car1/A", from: "0", to: "1000", target: 257 },
      new AbortController().signal,
    );
    expect(urls[0]?.pathname).toBe("/api/series");
    expect(urls[0]?.searchParams.get("signal")).toBe("prod:car1/A");
  });

  it("looks a signal up by its name and picks the exact ID among the databases", async () => {
    const urls = stub({
      items: [
        { id: "prod:car1/A", dataRef: "prod:car1", name: "A" },
        { id: "test:car1/A", dataRef: "test:car1", name: "A" },
      ],
      total: 2,
      more: false,
    });
    // The search is for the name after the first slash, never cut at the colon.
    expect((await signalInfo("test:car1/A"))?.dataRef).toBe("test:car1");
    expect(urls[0]?.searchParams.get("q")).toBe("A");
    expect((await signalInfo("prod:car1/A"))?.dataRef).toBe("prod:car1");
    // The bare form is none of them.
    expect(await signalInfo("car1/A")).toBeUndefined();
  });
});
