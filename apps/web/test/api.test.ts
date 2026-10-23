import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  fetchCursorValue,
  fetchExtent,
  fetchSeries,
  sendCommand,
  setComputedDefs,
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

describe("computed requests (add-computed-signals)", () => {
  const C7 = { id: "c7", name: "Diff", formula: "a - b", a: "A.X", b: "B.Y" };
  const ONE = { id: "c8", name: "Abs", formula: "abs(a)", a: "A.X" };

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
    setComputedDefs([C7, ONE]);
    const urls = recording();
    const abort = new AbortController().signal;

    await fetchSeries({ signalId: "car/=c7", from: "0", to: "1000", target: 257 }, abort);
    await fetchCursorValue("other/=c7", "500", "step", abort);
    await fetchExtent("car/=c7", { abort });
    const [series, value, extent] = urls as [URL, URL, URL];
    // The definition's formula and inputs, URL-encoded; the signal ID stays as asked.
    expect(series.pathname).toBe("/api/series");
    expect(series.search).toContain("formula=a+-+b");
    expect(series.searchParams.get("signal")).toBe("car/=c7");
    expect(series.searchParams.get("formula")).toBe("a - b");
    expect(series.searchParams.get("a")).toBe("A.X");
    expect(series.searchParams.get("b")).toBe("B.Y");
    // By the `=<id>` part: another session's data ref gets the same parameters.
    expect(value.pathname).toBe("/api/value");
    expect(value.search).toContain("formula=a+-+b");
    expect(value.searchParams.get("signal")).toBe("other/=c7");
    expect(value.searchParams.get("a")).toBe("A.X");
    expect(value.searchParams.get("b")).toBe("B.Y");
    expect(value.searchParams.get("mode")).toBe("step");
    expect(extent.pathname).toBe("/api/extent");
    expect(extent.searchParams.get("formula")).toBe("a - b");
    expect(extent.searchParams.get("b")).toBe("B.Y");

    // A one-input definition sends no b.
    await fetchSeries({ signalId: "car/=c8", from: "0", to: "1000", target: 257 }, abort);
    const one = urls[3] as URL;
    expect(one.searchParams.get("formula")).toBe("abs(a)");
    expect(one.searchParams.get("a")).toBe("A.X");
    expect(one.searchParams.has("b")).toBe(false);

    // A plain signal carries none of them.
    await fetchSeries({ signalId: "car/A.X", from: "0", to: "1000", target: 257 }, abort);
    const plain = urls[4] as URL;
    for (const name of ["formula", "a", "b"]) expect(plain.searchParams.has(name)).toBe(false);
    expect(urls).toHaveLength(5);
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
});
