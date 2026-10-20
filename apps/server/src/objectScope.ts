import { TIME_MAX, TIME_MIN, WORK_SPAN_MAX_NS, type WorkspaceScope } from "@kipscope/shared";
import type { DataSource } from "./datasource.ts";

/** How long a vehicle's extent is kept (add-case-open K11): the D-068 recount period. */
const EXTENT_TTL_MS = 5 * 60_000;
/** Data refs whose extent is kept, least recently used dropped. */
const EXTENT_MAX = 64;

interface ExtentEntry {
  at: number;
  promise: Promise<{ from: bigint; to: bigint }>;
}

/**
 * The full extent of a data ref for Unlink (add-case-open K11): one `refExtent` bounded by the data
 * ref alone (`{dataRef, TIME_MIN, TIME_MAX}`), the only such call. Cached per data ref for 5 min,
 * at most 64, single flight; a failed call is not cached. The call ignores a caller's abort, since
 * it is shared; `abort` ends only that caller's wait.
 */
export class ObjectExtents {
  private readonly source: Pick<DataSource, "refExtent">;
  private readonly ttlMs: number;
  private readonly max: number;
  private readonly now: () => number;
  /** Least recently used first. */
  private readonly entries = new Map<string, ExtentEntry>();

  constructor(
    source: Pick<DataSource, "refExtent">,
    options: { ttlMs?: number; max?: number; now?: () => number } = {},
  ) {
    this.source = source;
    this.ttlMs = options.ttlMs ?? EXTENT_TTL_MS;
    this.max = options.max ?? EXTENT_MAX;
    this.now = options.now ?? Date.now;
  }

  /** [first row, last row + 1 ns) of the data ref; one refExtent with {dataRef, TIME_MIN, TIME_MAX}; single-flight. */
  get(dataRef: string, abort?: AbortSignal): Promise<{ from: bigint; to: bigint }> {
    const now = this.now();
    let entry = this.entries.get(dataRef);
    if (entry && now - entry.at >= this.ttlMs) entry = undefined;
    if (entry) {
      this.entries.delete(dataRef);
      this.entries.set(dataRef, entry);
    } else {
      const created: ExtentEntry = { at: now, promise: this.load(dataRef) };
      entry = created;
      this.entries.delete(dataRef);
      this.entries.set(dataRef, created);
      created.promise.catch(() => {
        if (this.entries.get(dataRef) === created) this.entries.delete(dataRef);
      });
      for (const key of this.entries.keys()) {
        if (this.entries.size <= this.max) break;
        this.entries.delete(key);
      }
    }
    return waitFor(entry.promise, abort);
  }

  private async load(dataRef: string): Promise<{ from: bigint; to: bigint }> {
    if (!this.source.refExtent) throw new Error("the source cannot tell a data ref's extent");
    const extent = await this.source.refExtent(dataRef, { dataRef, from: TIME_MIN, to: TIME_MAX });
    if (!extent) throw new Error(`no rows for data ref ${dataRef}`);
    return { from: extent.first, to: extent.last + 1n };
  }
}

/** Waits for `promise`, or rejects with the abort reason once `abort` fires; the work goes on. */
function waitFor<T>(promise: Promise<T>, abort: AbortSignal | undefined): Promise<T> {
  if (!abort) return promise;
  abort.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abort.reason);
    abort.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        abort.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        abort.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** A work window the routes refuse (400 `invalid_request`, add-case-open K10, K11). */
export class WorkWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkWindowError";
  }
}

/**
 * Parses and checks a work window for an object scope (400 invalid_request texts of K10/K11);
 * undefined outside one. In an object scope `from` and `to` are required, `to` after `from`, at
 * most WORK_SPAN_MAX_NS apart; the window is cut to the scope and must overlap it. Throws
 * `WorkWindowError`.
 */
export function workWindowOf(
  query: { from?: bigint | undefined; to?: bigint | undefined },
  scope: WorkspaceScope | undefined,
): { from: bigint; to: bigint } | undefined {
  if (!scope?.object) return undefined;
  const { from, to } = query;
  if (from === undefined || to === undefined) {
    throw new WorkWindowError("from and to are required in an object scope (the work window)");
  }
  if (to <= from) throw new WorkWindowError("to must be after from");
  if (to - from > WORK_SPAN_MAX_NS) {
    throw new WorkWindowError("the work window may span at most 32 d");
  }
  const lo = from > BigInt(scope.from) ? from : BigInt(scope.from);
  const hi = to < BigInt(scope.to) ? to : BigInt(scope.to);
  if (hi <= lo) throw new WorkWindowError("the work window lies outside the scope");
  return { from: lo, to: hi };
}
