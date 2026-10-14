import {
  buildSearchIndex,
  type DbcInfo,
  type SearchIndex,
  type SignalInfo,
  type SignalPage,
  searchSignals,
  signalId,
} from "@letsview/shared";
import type { DataSource, SnaRange } from "./datasource.ts";
import type { DbcSignal } from "./dbc.ts";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

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

  private readonly source: DataSource;
  private readonly loadMetadata: () => Promise<Map<string, DbcSignal>>;

  constructor(source: DataSource, loadMetadata: () => Promise<Map<string, DbcSignal>>) {
    this.source = source;
    this.loadMetadata = loadMetadata;
  }

  /** Reloads signals and metadata. On failure the previous catalog stays in place. */
  async refresh(): Promise<void> {
    let refs: Awaited<ReturnType<DataSource["listSignals"]>>;
    let metadata: Map<string, DbcSignal>;
    try {
      [refs, metadata] = await Promise.all([this.source.listSignals(), this.loadMetadata()]);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
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
    entries.sort((a, b) => a.name.localeCompare(b.name) || a.dataRef.localeCompare(b.dataRef));
    this.entries = entries;
    this.byId = new Map(entries.map((e) => [e.id, e]));
    this.ranges = ranges;
    this.index = buildSearchIndex(entries);
    this.loadedAt = new Date();
    this.lastError = undefined;
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

/** DBC details of a catalog entry (design E4): `values` sorted by raw, absent fields stay absent. */
function dbcInfo(meta: DbcSignal): DbcInfo {
  const dbc: DbcInfo = { message: meta.message, messageId: meta.messageId };
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
