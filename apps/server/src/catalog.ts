import {
  buildSearchIndex,
  type DbcInfo,
  type SearchIndex,
  type SignalInfo,
  type SignalPage,
  searchSignals,
  signalId,
} from "@kipscope/shared";
import type { DataSource, SnaRange } from "./datasource.ts";
import type { DbcSignal } from "./dbc.ts";
import { assignGroup } from "./groups.ts";
import { assignDisplayNames, type DisplayRules, NO_RULES } from "./names.ts";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** Logs the collision warning of design N5 when a load left fallbacks; call after every load. */
export function warnDisplayFallbacks(log: { warn(message: string): void }, catalog: Catalog) {
  const fellBack = catalog.displayFallbacks;
  if (fellBack.length)
    log.warn(
      `display names: ${fellBack.length} signals show their full name because their shown names collide: ${fellBack.slice(0, 10).join(", ")}`,
    );
}

/** Where the catalog reports what it skipped while loading (design H5). */
export interface CatalogLog {
  warn(message: string): void;
}

/** Loads the DBC metadata; reports each skipped file through `warn`. */
type LoadMetadata = (warn: (message: string) => void) => Promise<Map<string, DbcSignal>>;

/**
 * In-memory signal catalog (design D5): the signals that have data in the source, merged with
 * DBC metadata by signal name. This is metadata only, not a data cache.
 */
export class Catalog {
  private entries: SignalInfo[] = [];
  private byId = new Map<string, SignalInfo>();
  private ranges = new Map<string, SnaRange[]>();
  private index: SearchIndex = buildSearchIndex([]);
  /** Set after the first successful refresh. */
  loadedAt: Date | undefined;
  /** Message of the last failed refresh, cleared on success. */
  lastError: string | undefined;
  /** Error of the last failed refresh, cleared on success; source of `unavailableReason`. */
  private lastFailure: unknown;
  /** Source names that show their full name because their shown names collide (design N5), sorted. */
  displayFallbacks: readonly string[] = [];

  private readonly source: DataSource;
  private readonly loadMetadata: LoadMetadata;
  private readonly rules: DisplayRules;
  private readonly log: CatalogLog | undefined;
  /** The load in progress; further refreshes share it (single flight). */
  private running: Promise<void> | undefined;

  constructor(
    source: DataSource,
    loadMetadata: LoadMetadata,
    rules: DisplayRules = NO_RULES,
    log?: CatalogLog,
  ) {
    this.source = source;
    this.loadMetadata = loadMetadata;
    this.rules = rules;
    this.log = log;
  }

  /**
   * Reloads signals and metadata. On failure the previous catalog stays in place. While a load
   * runs, further calls return the same promise instead of starting another load.
   */
  refresh(): Promise<void> {
    this.running ??= this.load().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async load(): Promise<void> {
    let refs: Awaited<ReturnType<DataSource["listSignals"]>>;
    let metadata: Map<string, DbcSignal>;
    const warn = (message: string) => this.log?.warn(`DBC file skipped: ${message}`);
    try {
      [refs, metadata] = await Promise.all([this.source.listSignals(), this.loadMetadata(warn)]);
    } catch (error) {
      this.lastFailure = error;
      this.lastError = errorMessage(error);
      throw error;
    }
    const ranges = new Map<string, SnaRange[]>();
    const entries = refs.map(({ dataRef, name }) => {
      const info: SignalInfo = { id: signalId(dataRef, name), dataRef, name };
      const meta = metadata.get(name);
      if (meta?.description) info.description = meta.description;
      if (meta?.unit) info.unit = meta.unit;
      if (meta) info.dbc = dbcInfo(meta);
      if (meta?.sna) {
        const { values, tolerance } = meta.sna;
        info.sna = values;
        ranges.set(
          info.id,
          values.map(({ value }) => ({ lo: value - tolerance, hi: value + tolerance })),
        );
      }
      return info;
    });
    // Display names (design N7): over distinct source names, across all data references.
    const { shown, fellBack } = assignDisplayNames(
      [...new Set(refs.map((r) => r.name))],
      this.rules,
    );
    for (const info of entries) {
      const name = shown.get(info.name);
      if (name !== undefined && name !== info.name) info.displayName = name;
      // Group (design G5): per entry; metadata is keyed by name, so every data reference agrees.
      const sender = metadata.get(info.name)?.sender;
      const group = assignGroup(
        info.name,
        sender === undefined ? {} : { sender },
        this.rules.groups,
      );
      if (group !== undefined) info.group = group;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name) || a.dataRef.localeCompare(b.dataRef));
    this.entries = entries;
    this.byId = new Map(entries.map((e) => [e.id, e]));
    this.ranges = ranges;
    this.displayFallbacks = fellBack;
    this.index = buildSearchIndex(entries);
    this.loadedAt = new Date();
    this.lastError = undefined;
    this.lastFailure = undefined;
  }

  /**
   * Why the catalog has not loaded yet, for the 503 `catalog_unavailable` body: still loading
   * while no refresh has failed, else source unreachable (network error codes, also inside an
   * AggregateError) or the failure message.
   */
  get unavailableReason(): string {
    if (this.lastFailure === undefined)
      return "still loading: the first catalog refresh has not finished";
    const codes = networkCodes(this.lastFailure);
    if (codes.length > 0) return `source unreachable: ${errorMessage(this.lastFailure)}`;
    return `catalog load failed: ${errorMessage(this.lastFailure)}`;
  }

  get size(): number {
    return this.entries.length;
  }

  get(id: string): SignalInfo | undefined {
    return this.byId.get(id);
  }

  /** Closed intervals of stored values that mean SNA (design S2); `[]` if unknown or none. */
  snaRanges(id: string): SnaRange[] {
    return this.ranges.get(id) ?? [];
  }

  /** Every signal in catalog order (name, then dataRef). */
  all(): readonly SignalInfo[] {
    return this.entries;
  }

  /**
   * Case-insensitive search across name, description, alias and unit, ranked like the explorer
   * (shared `searchSignals`, design E2). Every whitespace-separated term must match one of them.
   * An empty query matches everything in catalog order.
   */
  search(query: string, offset = 0, limit = DEFAULT_PAGE_SIZE): SignalPage {
    const matches = searchSignals(this.index, query).map((m) => m.signal);
    const size = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
    const items = matches.slice(offset, offset + size);
    return { items, total: matches.length, more: offset + items.length < matches.length };
  }
}

/** Delays between background catalog loads after failures in a row; the last one repeats. */
export const CATALOG_RETRY_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;

/**
 * Refreshes now and after each failure (delays CATALOG_RETRY_MS) until the catalog has loaded
 * once (design H5); returns stop(). A load that succeeded elsewhere meanwhile ends it too.
 */
export function keepCatalogLoaded(
  catalog: Catalog,
  events: { loaded(): void; failed(error: unknown, retryInMs: number): void },
): () => void {
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = () => {
    timer = undefined;
    if (stopped || catalog.loadedAt) return;
    catalog.refresh().then(
      () => {
        if (!stopped) events.loaded();
      },
      (error: unknown) => {
        if (stopped) return;
        const delay = CATALOG_RETRY_MS[Math.min(failures++, CATALOG_RETRY_MS.length - 1)] as number;
        events.failed(error, delay);
        timer = setTimeout(attempt, delay);
      },
    );
  };
  attempt();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}

const NETWORK_CODES =
  /\b(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH)\b/;

/** Network error codes of an error, its `cause` chain and AggregateError members. */
function networkCodes(error: unknown, depth = 0): string[] {
  if (!(error instanceof Error) || depth > 3) return [];
  const own = (error as { code?: unknown }).code;
  const match =
    typeof own === "string" ? NETWORK_CODES.exec(own) : NETWORK_CODES.exec(error.message);
  const nested = [
    ...(error instanceof AggregateError ? error.errors : []),
    ...(error.cause !== undefined ? [error.cause] : []),
  ].flatMap((e) => networkCodes(e, depth + 1));
  return match ? [match[1] as string, ...nested] : nested;
}

/** Non-empty message; an AggregateError (e.g. refused on ::1 and 127.0.0.1) lists its members. */
function errorMessage(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    const parts = [...new Set(error.errors.map(errorMessage))];
    return error.message ? `${error.message}: ${parts.join("; ")}` : parts.join("; ");
  }
  const message = error instanceof Error ? error.message : String(error);
  return message || (error instanceof Error ? error.name : "unknown error");
}

/** DBC details of a catalog entry (design E4): `values` sorted by raw, absent fields stay absent. */
function dbcInfo(meta: DbcSignal): DbcInfo {
  const dbc: DbcInfo = { message: meta.message, messageId: meta.messageId };
  if (meta.sender !== undefined) dbc.sender = meta.sender;
  if (meta.file !== undefined) dbc.file = meta.file;
  if (meta.factor !== undefined) dbc.factor = meta.factor;
  if (meta.offset !== undefined) dbc.offset = meta.offset;
  if (meta.min !== undefined) dbc.min = meta.min;
  if (meta.max !== undefined) dbc.max = meta.max;
  if (meta.values && meta.values.size > 0) {
    dbc.values = [...meta.values].sort(([a], [b]) => a - b).map(([raw, label]) => ({ raw, label }));
  }
  return dbc;
}
