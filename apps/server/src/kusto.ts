import { randomUUID } from "node:crypto";
import type { Timestamp } from "@kipscope/shared";

/** A query parameter; its name is declared in the `declare query_parameters` prologue (design C6). */
export type KustoParam =
  | { type: "string"; value: string }
  /** Sent as `adxDatetime(value)`, so a bound between ticks is rounded up. */
  | { type: "datetime"; value: Timestamp }
  | { type: "long"; value: bigint | number }
  /** Sent as `dynamic(<JSON>)`. */
  | { type: "dynamic"; value: readonly (string | number)[] }
  /** Sent as `realLiteral(value)`, so NaN and the infinities pass. */
  | { type: "real"; value: number };

/** A failed Kusto request: the message comes from Kusto (or the transport), never the token. */
export class KustoError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "KustoError";
    if (status !== undefined) this.status = status;
  }
}

export interface KustoOptions {
  /** Origin of the cluster, without a trailing `/`. */
  cluster: string;
  database: string;
  timeoutSeconds: number;
  /** Bearer token getter; absent: no Authorization header (emulator). */
  token?: () => Promise<string>;
  /** Replaces the global fetch (tests). */
  fetch?: typeof fetch;
}

const TICKS_PER_SECOND = 10_000_000n;

/** Bound rounded up to the next 100 ns: `YYYY-MM-DDTHH:MM:SS.fffffffZ` (design C6). */
export function adxDatetime(t: Timestamp): string {
  // Stored times are tick multiples, so t >= ceil(x) ⟺ t >= x and t < ceil(x) ⟺ t < x.
  let ticks = t / 100n;
  if (t % 100n > 0n) ticks += 1n; // bigint division truncates; only a positive rest needs a step up
  let seconds = ticks / TICKS_PER_SECOND;
  let frac = ticks % TICKS_PER_SECOND;
  if (frac < 0n) {
    seconds -= 1n;
    frac += TICKS_PER_SECOND;
  }
  const iso = new Date(Number(seconds) * 1000).toISOString().slice(0, 19);
  return `${iso}.${frac.toString().padStart(7, "0")}Z`;
}

/** A real cell: number, null, or the strings "NaN", "Infinity", "-Infinity". */
export function real(cell: unknown): number | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "number") return cell;
  if (cell === "NaN") return Number.NaN;
  if (cell === "Infinity") return Number.POSITIVE_INFINITY;
  if (cell === "-Infinity") return Number.NEGATIVE_INFINITY;
  throw new KustoError(`unexpected real cell: ${JSON.stringify(cell)}`);
}

/** A real in CSL literal form: `real(2.5)`, `real(nan)`, `real(+inf)`, `real(-inf)`. */
export function realLiteral(n: number): string {
  if (Number.isNaN(n)) return "real(nan)";
  if (n === Number.POSITIVE_INFINITY) return "real(+inf)";
  if (n === Number.NEGATIVE_INFINITY) return "real(-inf)";
  return `real(${n.toString()})`;
}

/** Text of a parameter value in `properties.Parameters` (CSL literal form). */
function paramText(param: KustoParam): string {
  switch (param.type) {
    case "string":
      return param.value;
    case "datetime":
      return adxDatetime(param.value);
    case "long":
      return BigInt(param.value).toString();
    case "dynamic":
      return `dynamic(${JSON.stringify(param.value)})`;
    case "real":
      return realLiteral(param.value);
  }
}

/** `hh:mm:ss` for `servertimeout`. */
function timespan(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

interface OneApiError {
  error?: { code?: string; message?: string; "@message"?: string };
}

/** `@message`, else `message`, of a Kusto error object; with its code when the text lacks it. */
function errorText(error: OneApiError["error"]): string | undefined {
  const text = error?.["@message"] ?? error?.message;
  if (!text) return error?.code;
  return error?.code && !text.includes(error.code) ? `${error.code}: ${text}` : text;
}

interface Frame {
  FrameType?: string;
  TableKind?: string;
  Rows?: unknown[];
  HasErrors?: boolean;
  OneApiErrors?: OneApiError[];
}

/**
 * Minimal client for the Kusto v2 REST query endpoint (design C6). Every value goes in as a
 * declared query parameter; every query carries `servertimeout`, the app name and a client
 * request ID. An answer that reports errors fails as a whole: no partial rows.
 */
export class KustoClient {
  private readonly options: KustoOptions;
  private readonly fetch: typeof fetch;

  constructor(options: KustoOptions) {
    this.options = options;
    this.fetch = options.fetch ?? fetch;
  }

  /** Rows of the first PrimaryResult table. */
  async query(
    csl: string,
    params: Record<string, KustoParam>,
    abort?: AbortSignal,
  ): Promise<unknown[][]> {
    const { cluster, database, timeoutSeconds, token } = this.options;
    abort?.throwIfAborted();
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8",
      // Without it the emulator answers errors as plain text without details.
      Accept: "application/json",
      "x-ms-app": "KIPscope",
      "x-ms-client-request-id": `KIPscope.query;${randomUUID()}`,
    };
    if (token) headers.Authorization = `Bearer ${await token()}`;
    abort?.throwIfAborted();
    const names = Object.entries(params);
    const prologue = names.length
      ? `declare query_parameters(${names.map(([n, p]) => `${n}:${p.type}`).join(", ")});\n`
      : "";
    const body = JSON.stringify({
      db: database,
      csl: prologue + csl,
      properties: {
        Options: { servertimeout: timespan(timeoutSeconds) },
        Parameters: Object.fromEntries(names.map(([n, p]) => [n, paramText(p)])),
      },
    });

    let status: number;
    let text: string;
    try {
      // Closing the request (abort) makes Kusto cancel the query (design C8).
      const response = await this.fetch(`${cluster}/v2/rest/query`, {
        method: "POST",
        headers,
        body,
        ...(abort ? { signal: abort } : {}),
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      if (abort?.aborted) throw abort.reason;
      const cause = error instanceof Error ? (error.cause ?? error) : error;
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new KustoError(`ADX ${cluster} not reachable: ${reason}`);
    }

    if (status >= 400) throw this.httpError(status, text);
    let frames: Frame[];
    try {
      frames = JSON.parse(text);
      if (!Array.isArray(frames)) throw new Error("not an array");
    } catch {
      throw new KustoError(`ADX: unexpected answer (HTTP ${status}): ${firstLine(text)}`, status);
    }
    const completion = frames.find((f) => f.FrameType === "DataSetCompletion");
    if (completion?.HasErrors) {
      const message = completion.OneApiErrors?.map((e) => errorText(e.error)).find(Boolean);
      throw new KustoError(`ADX: ${message ?? "the query reported errors"}`, status);
    }
    const primary = frames.find(
      (f) => f.FrameType === "DataTable" && f.TableKind === "PrimaryResult",
    );
    const rows = primary?.Rows ?? [];
    for (const row of rows) {
      // In-data errors (e.g. LowMemoryCondition) arrive as an object among the rows.
      if (!Array.isArray(row)) {
        const message = (row as OneApiError & { OneApiErrors?: OneApiError[] })?.OneApiErrors?.map(
          (e) => errorText(e.error),
        ).find(Boolean);
        throw new KustoError(`ADX: ${message ?? "the query reported an error row"}`, status);
      }
    }
    return rows as unknown[][];
  }

  /** Resolves when the cluster answers `print ok = 1`. */
  async ping(abort: AbortSignal): Promise<void> {
    await this.query("print ok = 1", {}, abort);
  }

  private httpError(status: number, text: string): KustoError {
    let message: string | undefined;
    try {
      message = errorText((JSON.parse(text) as OneApiError).error);
    } catch {
      // Not JSON: the first text line below.
    }
    message ??= firstLine(text) || `HTTP ${status}`;
    const hint =
      status === 401 || status === 403
        ? `: run az login, or check your access to database ${this.options.database}`
        : "";
    return new KustoError(`ADX: ${message}${hint}`, status);
  }
}

const firstLine = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean) ?? "";
