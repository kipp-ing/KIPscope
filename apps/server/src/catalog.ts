import { type SignalInfo, type SignalPage, signalId } from "@letsview/shared";
import type { DataSource } from "./datasource.ts";
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
  private haystacks: string[] = [];
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
    const entries = refs.map(({ dataRef, name }) => {
      const info: SignalInfo = { id: signalId(dataRef, name), dataRef, name };
      const meta = metadata.get(name);
      if (meta?.description) info.description = meta.description;
      if (meta?.unit) info.unit = meta.unit;
      return info;
    });
    entries.sort((a, b) => a.name.localeCompare(b.name) || a.dataRef.localeCompare(b.dataRef));
    this.entries = entries;
    this.byId = new Map(entries.map((e) => [e.id, e]));
    this.haystacks = entries.map((e) =>
      [e.name, e.description, e.alias, e.unit].filter(Boolean).join("\n").toLowerCase(),
    );
    this.loadedAt = new Date();
    this.lastError = undefined;
  }

  get size(): number {
    return this.entries.length;
  }

  get(id: string): SignalInfo | undefined {
    return this.byId.get(id);
  }

  /**
   * Case-insensitive search across name, description, alias and unit. Every whitespace-separated
   * term must match one of them. An empty query matches everything.
   */
  search(query: string, offset = 0, limit = DEFAULT_PAGE_SIZE): SignalPage {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = this.entries.filter((_, i) =>
      terms.every((term) => this.haystacks[i]?.includes(term)),
    );
    const size = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
    const items = matches.slice(offset, offset + size);
    return { items, total: matches.length, more: offset + items.length < matches.length };
  }
}
