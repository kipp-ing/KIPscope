import type { DataSource } from "./datasource.ts";

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

/** Wraps a source so that every query runs through the queue. */
export function queuedSource(source: DataSource, queue: QueryQueue): DataSource {
  return {
    listSignals: (abort) => queue.run((a) => source.listSignals(a), abort),
    count: (ref, from, to, abort) => queue.run((a) => source.count(ref, from, to, a), abort),
    raw: (ref, from, to, abort) => queue.run((a) => source.raw(ref, from, to, a), abort),
    before: (ref, t, abort) => queue.run((a) => source.before(ref, t, a), abort),
    after: (ref, t, abort) => queue.run((a) => source.after(ref, t, a), abort),
    buckets: (ref, from, to, width, abort) =>
      queue.run((a) => source.buckets(ref, from, to, width, a), abort),
  };
}
