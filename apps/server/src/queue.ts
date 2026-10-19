import { AsyncLocalStorage } from "node:async_hooks";
import type { SourceAdapter } from "./datasource.ts";
import {
  currentPriority,
  type Priority,
  QUERY_CLASSES,
  type QueryClass,
  rank,
} from "./priority.ts";

interface Waiting {
  /** Arrival order, renewed on each raise; the oldest of the best class starts first. */
  seq: number;
  /** The class `seq` was given in; differs from `priority.cls` after a raise until renumbered. */
  seqCls: QueryClass;
  priority: Priority;
  start: () => void;
  abort: AbortSignal | undefined;
}

const abortReason = (abort: AbortSignal) =>
  abort.reason ?? new DOMException("The operation was aborted", "AbortError");

const perClass = <T>(value: () => T) =>
  Object.fromEntries(QUERY_CLASSES.map((cls) => [cls, value()])) as Record<QueryClass, T>;

/**
 * Runs at most `limit` source queries at once and queues the rest (design D7). The waiting query
 * of the highest class starts first, the oldest within a class, and a query below `interactive`
 * never takes one of the `kept` slots (improve-query-priority P1). A queued query whose request
 * was aborted is dropped before it reaches the source; a running one gets the abort signal, which
 * closes its HTTP request and makes ClickHouse cancel it.
 */
export class QueryQueue {
  readonly limit: number;
  /** Slots only `interactive` queries may take: 1 when limit > 1, else 0 (design P2). */
  readonly kept: number;
  private running = 0;
  private readonly runningByClass = perClass(() => 0);
  private readonly waiting: Waiting[] = [];
  private seq = 0;
  /** Highest number of concurrently running queries seen; for tests and diagnostics. */
  peak = 0;

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`invalid limit: ${limit}`);
    this.limit = limit;
    this.kept = limit > 1 ? 1 : 0;
  }

  get stats() {
    const byClass = perClass(() => ({ running: 0, waiting: 0 }));
    for (const cls of QUERY_CLASSES) byClass[cls].running = this.runningByClass[cls];
    for (const entry of this.waiting) byClass[entry.priority.cls].waiting++;
    return { running: this.running, waiting: this.waiting.length, peak: this.peak, byClass };
  }

  /** Queues `task` in the class of `currentPriority()` at call time, inside the caller's async context. */
  run<T>(task: (abort?: AbortSignal) => Promise<T>, abort?: AbortSignal): Promise<T> {
    if (abort?.aborted) return Promise.reject(abortReason(abort));
    const priority = currentPriority();
    // Without it the task would run in the context of whichever query freed its slot (design P3).
    const context = AsyncLocalStorage.snapshot();
    return new Promise<T>((resolve, reject) => {
      const leave = () => {
        abort?.removeEventListener("abort", onAbort);
        unsubscribe();
      };
      const entry: Waiting = {
        seq: this.seq++,
        seqCls: priority.cls,
        priority,
        abort,
        start: () => {
          leave();
          if (abort?.aborted) {
            reject(abortReason(abort));
            this.next();
            return;
          }
          // A raise after this point leaves the running query alone (design P4).
          const cls = priority.cls;
          this.running++;
          this.runningByClass[cls]++;
          this.peak = Math.max(this.peak, this.running);
          context(() => task(abort))
            .then(resolve, reject)
            .finally(() => {
              this.running--;
              this.runningByClass[cls]--;
              this.next();
            });
        },
      };
      const onAbort = () => {
        const index = this.waiting.indexOf(entry);
        if (index >= 0) {
          this.waiting.splice(index, 1);
          leave();
          reject(abortReason(abort as AbortSignal));
        }
      };
      // A raised query may now go first or take the kept slot.
      const unsubscribe = priority.onRaise(() => this.raised(priority));
      abort?.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(entry);
      this.next();
    });
  }

  /**
   * Gives every waiting query of `priority` a new sequence number, in their old order, then
   * re-picks: a raised query ranks behind the queries of its new class already waiting (design
   * P4). Each waiting query of the handle has its own listener; the first renumbers them all.
   */
  private raised(priority: Priority) {
    for (const entry of this.waiting) {
      if (entry.priority !== priority || entry.seqCls === priority.cls) continue;
      entry.seq = this.seq++;
      entry.seqCls = priority.cls;
    }
    this.next();
  }

  private next() {
    while (this.waiting.length > 0) {
      let best = 0;
      for (let i = 1; i < this.waiting.length; i++) {
        const a = this.waiting[i] as Waiting;
        const b = this.waiting[best] as Waiting;
        const order = rank(a.priority.cls) - rank(b.priority.cls) || a.seq - b.seq;
        if (order < 0) best = i;
      }
      const entry = this.waiting[best] as Waiting;
      // A lower class has the same or a stricter bound, so nothing else may start either.
      const bound = entry.priority.cls === "interactive" ? this.limit : this.limit - this.kept;
      if (this.running >= bound) return;
      this.waiting.splice(best, 1);
      entry.start();
    }
  }
}

/** Wraps every method the adapter has in the queue; `ping` and `info` pass through unqueued (design C3). */
export function queuedAdapter(adapter: SourceAdapter, queue: QueryQueue): SourceAdapter {
  const queued: SourceAdapter = {
    info: adapter.info,
    ping: (abort) => adapter.ping(abort),
    listSignals: (abort) => queue.run((a) => adapter.listSignals(a), abort),
    raw: (ref, from, to, limit, abort) =>
      queue.run((a) => adapter.raw(ref, from, to, limit, a), abort),
    before: (ref, t, abort) => queue.run((a) => adapter.before(ref, t, a), abort),
    after: (ref, t, abort) => queue.run((a) => adapter.after(ref, t, a), abort),
    buckets: (ref, from, to, width, abort) =>
      queue.run((a) => adapter.buckets(ref, from, to, width, a), abort),
    refBuckets: (dataRef, width, times, abort) =>
      queue.run((a) => adapter.refBuckets(dataRef, width, times, a), abort),
  };
  // Optional methods only where the adapter has them, so the fallbacks see what is native.
  const count = adapter.count?.bind(adapter);
  if (count)
    queued.count = (ref, from, to, abort) => queue.run((a) => count(ref, from, to, a), abort);
  const extent = adapter.extent?.bind(adapter);
  if (extent) queued.extent = (ref, abort) => queue.run((a) => extent(ref, a), abort);
  const refExtent = adapter.refExtent?.bind(adapter);
  if (refExtent)
    queued.refExtent = (dataRef, abort) => queue.run((a) => refExtent(dataRef, a), abort);
  const refCount = adapter.refCount?.bind(adapter);
  if (refCount) queued.refCount = (dataRef, abort) => queue.run((a) => refCount(dataRef, a), abort);
  const loggerGaps = adapter.loggerGaps?.bind(adapter);
  if (loggerGaps)
    queued.loggerGaps = (dataRef, grid, minGap, abort) =>
      queue.run((a) => loggerGaps(dataRef, grid, minGap, a), abort);
  const firstTimes = adapter.firstTimes?.bind(adapter);
  if (firstTimes)
    queued.firstTimes = (dataRef, names, rows, abort) =>
      queue.run((a) => firstTimes(dataRef, names, rows, a), abort);
  const stateChanges = adapter.stateChanges?.bind(adapter);
  if (stateChanges)
    queued.stateChanges = (ref, by, limit, abort) =>
      queue.run((a) => stateChanges(ref, by, limit, a), abort);
  const events = adapter.events?.bind(adapter);
  if (events)
    queued.events = (dataRef, limit, abort) => queue.run((a) => events(dataRef, limit, a), abort);
  return queued;
}
