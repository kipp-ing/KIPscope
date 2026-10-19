import { type CatalogSnapshot, scopeKey, type WorkspaceScope } from "@kipscope/shared";
import { ApiRequestError } from "../api.ts";

/** Retry interval while the catalog is not loaded yet (design E3). */
export const CATALOG_RETRY_MS = 5000;

/** Text of the explorer in scoped mode without a scope (signal-catalog "Explorer follows the scope"). */
export const NO_SCOPE_TEXT =
  "No scope set. Open a view link or run kipscope scope set REF FROM TO.";

/** What the loader reports: a loaded list, a failed load (retried), or no scope (not retried). */
export type CatalogReport =
  | { kind: "loaded"; snapshot: CatalogSnapshot }
  | { kind: "failed"; message: string }
  | { kind: "no_scope" };

/**
 * Loads the catalog of the workspace's scope (add-scope Z12): one fetch per new `scopeKey`, none
 * for a repeated one. An answer for an older scope, or whose own `scope` is not the current one,
 * is dropped. A failure is retried every `retryMs` while the scope stays; 409 `scope_required`
 * reports `no_scope` and waits for the next scope.
 */
export class CatalogLoader {
  private readonly fetchCatalog: (abort: AbortSignal) => Promise<CatalogSnapshot>;
  private readonly report: (r: CatalogReport) => void;
  private readonly retryMs: number;
  private key: string | undefined;
  private abort: AbortController | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;

  constructor(
    fetchCatalog: (abort: AbortSignal) => Promise<CatalogSnapshot>,
    report: (r: CatalogReport) => void,
    retryMs: number = CATALOG_RETRY_MS,
  ) {
    this.fetchCatalog = fetchCatalog;
    this.report = report;
    this.retryMs = retryMs;
  }

  /** The workspace's scope; a new scope key aborts the running load and fetches again. */
  setScope(scope: WorkspaceScope | undefined): void {
    const key = scopeKey(scope);
    if (key === this.key) return;
    this.stop();
    this.key = key;
    this.load();
  }

  /** Stops loading for good (unmount). */
  dispose(): void {
    this.stop();
    this.key = undefined;
  }

  private stop(): void {
    this.abort?.abort();
    this.abort = undefined;
    clearTimeout(this.retry);
    this.retry = undefined;
  }

  private load(): void {
    const key = this.key;
    const abort = new AbortController();
    this.abort = abort;
    const current = () => !abort.signal.aborted && this.key === key;
    this.fetchCatalog(abort.signal).then(
      (snapshot) => {
        if (!current() || scopeKey(snapshot.scope) !== key) return;
        this.report({ kind: "loaded", snapshot });
      },
      (e: unknown) => {
        if (!current()) return;
        if (e instanceof ApiRequestError && e.code === "scope_required") {
          this.report({ kind: "no_scope" });
          return;
        }
        this.report({ kind: "failed", message: e instanceof Error ? e.message : String(e) });
        this.retry = setTimeout(() => {
          if (current()) this.load();
        }, this.retryMs);
      },
    );
  }
}
