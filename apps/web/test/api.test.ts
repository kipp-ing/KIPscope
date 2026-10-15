import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, fetchSeries } from "../src/api.ts";
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
