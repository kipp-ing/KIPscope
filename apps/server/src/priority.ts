import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Class of a source query; decides which waiting query the queue starts first (design P1, P9).
 * `idle` is the calendar's day counting: it runs only while nothing interactive runs or waits,
 * one at a time (speed-up-whole-scans B6, D-118).
 */
export type QueryClass = "interactive" | "metadata" | "background" | "preload" | "idle";

/** Highest first; a class's rank is its index. */
export const QUERY_CLASSES: readonly QueryClass[] = [
  "interactive",
  "metadata",
  "background",
  "preload",
  "idle",
];

/** Index of `cls` in QUERY_CLASSES (0 = highest); the queue uses this, no copy. */
export function rank(cls: QueryClass): number {
  return QUERY_CLASSES.indexOf(cls);
}

/** The lower-ranked of two classes, e.g. a prefetch that never runs above the work that caused it. */
export function lowerClass(a: QueryClass, b: QueryClass): QueryClass {
  return rank(a) >= rank(b) ? a : b;
}

/**
 * The class of one piece of work, shared by every query it sends. Work that a request joins is
 * raised to the request's class, never lowered (design P4).
 */
export class Priority {
  private current: QueryClass;
  private readonly listeners = new Set<() => void>();

  constructor(cls: QueryClass) {
    this.current = cls;
  }

  get cls(): QueryClass {
    return this.current;
  }

  /** Raises to `cls` when that ranks higher; never lowers; notifies listeners on a change. */
  raise(cls: QueryClass): void {
    if (rank(cls) >= rank(this.current)) return;
    this.current = cls;
    for (const listener of [...this.listeners]) listener();
  }

  /** Called after each raise; returns the unsubscribe. */
  onRaise(listener: () => void): () => void {
    // A wrapper per call, so that two subscriptions of the same function stay apart.
    const entry = () => listener();
    this.listeners.add(entry);
    return () => this.listeners.delete(entry);
  }
}

const storage = new AsyncLocalStorage<Priority>();
/** Work outside any context: every route, the CLI's requests, the catalog load (design P9). */
const interactive = new Priority("interactive");

/** Runs `fn` (and every async continuation of it) under `priority`; a class name makes a new handle. */
export function withPriority<T>(priority: Priority | QueryClass, fn: () => T): T {
  return storage.run(typeof priority === "string" ? new Priority(priority) : priority, fn);
}

/** The handle of the current context; a shared `interactive` handle outside any context. */
export function currentPriority(): Priority {
  return storage.getStore() ?? interactive;
}
