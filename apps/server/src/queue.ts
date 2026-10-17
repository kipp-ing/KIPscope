import type { SourceAdapter } from "./datasource.ts";

interface Waiting {
  start: () => void;
  fail: (reason: unknown) => void;
  abort: AbortSignal | undefined;
}

const abortReason = (abort: AbortSignal) =>
  abort.reason ?? new DOMException("The operation was aborted", "AbortError");

/**
 * Runs at most `limit` source queries at once and queues the rest (design D7). A queued query
 * whose request was aborted is dropped before it reaches the source; a running one gets the abort
 * signal, which closes its HTTP request and makes ClickHouse cancel it.
 */
export class QueryQueue {
  readonly limit: number;
  private running = 0;
  private readonly waiting: Waiting[] = [];
  /** Highest number of concurrently running queries seen; for tests and diagnostics. */
  peak = 0;

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`invalid limit: ${limit}`);
    this.limit = limit;
  }

  get stats() {
    return { running: this.running, waiting: this.waiting.length, peak: this.peak };
  }

  run<T>(task: (abort?: AbortSignal) => Promise<T>, abort?: AbortSignal): Promise<T> {
    if (abort?.aborted) return Promise.reject(abortReason(abort));
    return new Promise<T>((resolve, reject) => {
      const entry: Waiting = {
        abort,
        fail: reject,
        start: () => {
          abort?.removeEventListener("abort", onAbort);
          if (abort?.aborted) {
            reject(abortReason(abort));
            this.next();
            return;
          }
          this.running++;
          this.peak = Math.max(this.peak, this.running);
          task(abort)
            .then(resolve, reject)
            .finally(() => {
              this.running--;
              this.next();
            });
        },
      };
      const onAbort = () => {
        const index = this.waiting.indexOf(entry);
        if (index >= 0) {
          this.waiting.splice(index, 1);
          reject(abortReason(abort as AbortSignal));
        }
      };
      abort?.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(entry);
      this.next();
    });
  }

  private next() {
    while (this.running < this.limit && this.waiting.length > 0) {
      this.waiting.shift()?.start();
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
