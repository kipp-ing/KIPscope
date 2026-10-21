import { vi } from "vitest";
import { fetchSeries } from "../src/api.ts";

/**
 * The real `ApiRequestError` of an API answer `{error: {code, message}}` with `status`, built by
 * `fetchSeries` over a stubbed `fetch`, so a test sees the status and code exactly as the app does.
 */
export async function apiError(status: number, code: string, message: string): Promise<Error> {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(new Response(JSON.stringify({ error: { code, message } }), { status })),
  );
  try {
    await fetchSeries(
      { signalId: "x/y", from: "0", to: "1", target: 1 },
      new AbortController().signal,
    );
  } catch (error) {
    return error as Error;
  } finally {
    vi.unstubAllGlobals();
  }
  throw new Error("expected a rejection");
}
