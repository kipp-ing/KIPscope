import { tooWideText } from "@kipscope/shared";
import type { DataSource, Scope } from "./datasource.ts";
import { currentPriority, Priority, withPriority } from "./priority.ts";

/** How long a range's count is kept (speed-up-whole-scans B2). */
export const SCAN_COUNT_TTL_MS = 5 * 60_000;
/** Ranges whose count is kept (B2), least recently used dropped. */
export const SCAN_COUNT_MAX = 256;

/**
 * A range the scan bound refuses (scope "Scan bound", B1): `rows` and `limit` when the row count
 * decided, `span` and `maxSpan` when the span did. The message is the "Too wide answers" text.
 */
export class TooWideError extends Error {
  readonly rows?: number;
  readonly limit?: number;
  readonly span?: bigint;
  readonly maxSpan?: bigint;

  constructor(fields: { rows: number; limit: number } | { span: bigint; maxSpan: bigint }) {
    super(
      tooWideText(
        "rows" in fields
          ? { rows: String(fields.rows), limit: String(fields.limit) }
          : { span: String(fields.span), maxSpan: String(fields.maxSpan) },
      ),
    );
    this.name = "TooWideError";
    if ("rows" in fields) {
      this.rows = fields.rows;
      this.limit = fields.limit;
    } else {
      this.span = fields.span;
      this.maxSpan = fields.maxSpan;
    }
  }
}

export interface ScanBound {
  readonly rows: number;
  readonly spanNs: bigint;
  /** Resolves when the range is within the bound, rejects with TooWideError; `range` undefined = whole data ref. */
  check(dataRef: string, range?: Scope): Promise<void>;
  /** The cached or fresh refCount of the range (shared with check). */
  count(dataRef: string, range?: Scope): Promise<number>;
}

interface CountEntry {
  at: number;
  /** Class of the count: the starting caller's, raised by each joining one (series-query P4). */
  priority: Priority;
  promise: Promise<number>;
  /** False once the count settled; a caller's later raise is then not forwarded. */
  pending: boolean;
}

/**
 * Raises the count to the caller's class and keeps it there while the count is pending: a
 * request that joins the caller's work (a density or gap flight) raises the caller's handle, and
 * the count it awaits must follow (series-query P4).
 */
function follow(entry: CountEntry, caller: Priority): void {
  entry.priority.raise(caller.cls);
  if (!entry.pending) return;
  const stop = caller.onRaise(() => entry.priority.raise(caller.cls));
  entry.promise.then(stop, stop);
}

/**
 * The scan bound (B1, B2): a range wider than `spanNs` is refused with no source call; otherwise
 * its `refCount` must be at most `rows`. One count per `(dataRef, from, to)`: single flight, kept
 * SCAN_COUNT_TTL_MS, a failure not kept, at most SCAN_COUNT_MAX, least recently used dropped. The
 * count ignores a caller's abort, since it is shared.
 */
export function createScanBound(
  source: Pick<DataSource, "refCount">,
  limits: { rows: number; spanNs: bigint },
  now: () => number = Date.now,
): ScanBound {
  /** Least recently used first. */
  const entries = new Map<string, CountEntry>();

  const count = (dataRef: string, range?: Scope): Promise<number> => {
    const key = range ? `${dataRef}\n${range.from} ${range.to}` : dataRef;
    const at = now();
    const cached = entries.get(key);
    if (cached && at - cached.at < SCAN_COUNT_TTL_MS) {
      follow(cached, currentPriority());
      entries.delete(key);
      entries.set(key, cached);
      return cached.promise;
    }
    const caller = currentPriority();
    const priority = new Priority(caller.cls);
    const scope = range && { dataRef, from: range.from, to: range.to };
    const entry: CountEntry = {
      at,
      priority,
      promise: withPriority(priority, () => source.refCount(dataRef, scope)),
      pending: true,
    };
    entries.delete(key);
    entries.set(key, entry);
    entry.promise.then(
      () => {
        entry.pending = false;
      },
      () => {
        entry.pending = false;
        if (entries.get(key) === entry) entries.delete(key);
      },
    );
    follow(entry, caller);
    for (const old of entries.keys()) {
      if (entries.size <= SCAN_COUNT_MAX) break;
      entries.delete(old);
    }
    return entry.promise;
  };

  return {
    rows: limits.rows,
    spanNs: limits.spanNs,
    count,
    async check(dataRef, range) {
      if (range && range.to - range.from > limits.spanNs)
        throw new TooWideError({ span: range.to - range.from, maxSpan: limits.spanNs });
      const rows = await count(dataRef, range);
      if (rows > limits.rows) throw new TooWideError({ rows, limit: limits.rows });
    },
  };
}
