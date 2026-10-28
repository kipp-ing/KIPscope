import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CALENDAR_GRID_NS,
  DAY_NS,
  GAP_REFRESH_MS,
  type GridBucket,
  isTimeseries,
  parseSignalId,
  type Workspace,
} from "@kipscope/shared";
import type { DataSource, Scope, SourceInfo } from "./datasource.ts";
import { writeAtomic } from "./persist.ts";
import { withPriority } from "./priority.ts";
import type { Workspaces } from "./workspaces.ts";

const MS_NS = 1_000_000n;
const HOUR_NS = 3_600_000_000_000n;
/** A day counted later than its end + this is final (design B6). */
const FINAL_LAG_NS = HOUR_NS;
/** A counted day that is not final is counted again at most this often while in use (B6). */
const RECHECK_MS = 300_000;
/** A failed day waits this long before its next try (range-picker "Calendar days counted …"). */
const RETRY_MS = 300_000;
/** At most one write of a data ref's day file per this time (B6). */
const WRITE_EVERY_MS = 10_000;
/** How often fillAhead looks for a changed set of open workspaces; in memory, no query. */
const OPEN_CHECK_MS = 5_000;

interface Day {
  countedAt: bigint;
  final: boolean;
  buckets: GridBucket[];
}

interface DataRefDays {
  days: Map<bigint, Day>;
  /** When the file was last written (ms), and a pending write's timer. */
  writtenAt: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

type Key = { dataRef: string; day: bigint };

const floorDay = (t: bigint) => {
  const r = t % DAY_NS;
  return r < 0n ? t - r - DAY_NS : t - r;
};

/**
 * The calendar's vehicle-days (spec range-picker "Calendar days counted at the lowest priority",
 * design B6): rows of one data ref per UTC day on the 60 s grid, counted one day at a time in the
 * `idle` class and kept in `<stateDir>/calendar`, one file per data ref. A day counted more than
 * 1 h after its end is final; any other counted day is counted again at most every 5 min while
 * its data ref is in use (wanted ahead, or asked within the last 5 min).
 */
export class CalendarDays {
  private readonly source: Pick<DataSource, "refCount" | "refBuckets">;
  private readonly dir: string;
  private readonly sourceInfo: SourceInfo;
  private readonly scanRows: number;
  private readonly now: () => number;
  private readonly warn: (message: string) => void;
  private readonly refs = new Map<string, DataRefDays>();
  /** Days `window()` asked for, newest ask first, each newest day first. */
  private front: Key[] = [];
  /** Days to count ahead per data ref, newest first (B6). */
  private readonly ahead = new Map<string, bigint[]>();
  /** When `window()` last asked for a data ref (ms). */
  private readonly askedAt = new Map<string, number>();
  /** Failed days by `dataRef\nday`, with the time of the failure (ms). */
  private readonly failedAt = new Map<string, number>();
  private running = false;
  private kicked = false;
  private stopped = false;
  private wake: ReturnType<typeof setTimeout> | undefined;
  private readonly abort = new AbortController();

  constructor(
    source: Pick<DataSource, "refCount" | "refBuckets">,
    opts: {
      dir: string;
      sourceInfo: SourceInfo;
      scanRows: number;
      now?: () => number;
      warn(message: string): void;
    },
  ) {
    this.source = source;
    this.dir = opts.dir;
    this.sourceInfo = opts.sourceInfo;
    this.scanRows = opts.scanRows;
    this.now = opts.now ?? Date.now;
    this.warn = opts.warn;
    this.readAll();
  }

  /** 60 s buckets of the counted days in [from, to) and the UTC days not counted yet; queues those, front first. */
  window(
    dataRef: string,
    from: bigint,
    to: bigint,
  ): { buckets: GridBucket[]; pending: { from: bigint; to: bigint }[] } {
    const now = this.now();
    this.askedAt.set(dataRef, now);
    const counted = this.refs.get(dataRef)?.days;
    const buckets: GridBucket[] = [];
    const pending: { from: bigint; to: bigint }[] = [];
    const ask: bigint[] = [];
    for (let day = floorDay(from); day < to; day += DAY_NS) {
      const entry = counted?.get(day);
      if (!entry) {
        pending.push({ from: day, to: day + DAY_NS });
        ask.push(day);
        continue;
      }
      for (const b of entry.buckets) if (b.start >= from && b.start < to) buckets.push(b);
      if (this.due(dataRef, day, now)) ask.push(day);
    }
    if (ask.length > 0) {
      const asked = new Set(ask);
      this.front = [
        ...ask.reverse().map((day) => ({ dataRef, day })),
        ...this.front.filter((k) => k.dataRef !== dataRef || !asked.has(k.day)),
      ];
      this.kick();
    }
    return { buckets, pending };
  }

  /** Days to count ahead (B6), behind any window() asks; replaces the data ref's earlier wish. */
  want(dataRef: string, days: readonly bigint[]): void {
    if (days.length === 0) this.ahead.delete(dataRef);
    else
      this.ahead.set(
        dataRef,
        [...new Set(days)].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0)),
      );
    this.kick();
  }

  /** Ends the counting; a day in flight is aborted and pending file writes are done now. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.wake !== undefined) clearTimeout(this.wake);
    this.wake = undefined;
    this.abort.abort();
    for (const [dataRef, entry] of this.refs) {
      if (entry.timer === undefined) continue;
      clearTimeout(entry.timer);
      entry.timer = undefined;
      this.write(dataRef);
    }
  }

  /** Starts the next day after the current I/O turn, so a request answers before any day query. */
  private kick(): void {
    if (this.stopped || this.running || this.kicked) return;
    this.kicked = true;
    setImmediate(() => {
      this.kicked = false;
      this.pump();
    });
  }

  private pump(): void {
    if (this.stopped || this.running) return;
    if (this.wake !== undefined) clearTimeout(this.wake);
    this.wake = undefined;
    const next = this.pick();
    if (!next) {
      this.scheduleWake();
      return;
    }
    this.running = true;
    const key = `${next.dataRef}\n${next.day}`;
    // A handle of its own, so no request ever raises the day counting (D-118).
    withPriority("idle", () => this.count(next.dataRef, next.day))
      .then(
        () => this.failedAt.delete(key),
        (error: unknown) => {
          if (this.stopped) return;
          this.failedAt.set(key, this.now());
          this.warn(
            `calendar day ${new Date(Number(next.day / MS_NS)).toISOString().slice(0, 10)} of ${next.dataRef} not counted: ${(error as Error)?.message ?? String(error)}`,
          );
        },
      )
      .finally(() => {
        this.running = false;
        this.pump();
      });
  }

  /** The next due day: asked days first, then the days wanted ahead. */
  private pick(): Key | undefined {
    const now = this.now();
    while (this.front.length > 0) {
      const key = this.front.shift() as Key;
      if (this.due(key.dataRef, key.day, now)) return key;
    }
    for (const [dataRef, days] of this.ahead)
      for (const day of days) if (this.due(dataRef, day, now)) return { dataRef, day };
    return undefined;
  }

  /** Not counted yet, or counted, not final, in use and at least RECHECK_MS old; never while a failure is fresh. */
  private due(dataRef: string, day: bigint, now: number): boolean {
    const failed = this.failedAt.get(`${dataRef}\n${day}`);
    if (failed !== undefined && now - failed < RETRY_MS) return false;
    const entry = this.refs.get(dataRef)?.days.get(day);
    if (!entry) return true;
    if (entry.final || !this.inUse(dataRef, now)) return false;
    return now - Number(entry.countedAt / MS_NS) >= RECHECK_MS;
  }

  private inUse(dataRef: string, now: number): boolean {
    if (this.ahead.has(dataRef)) return true;
    const asked = this.askedAt.get(dataRef);
    return asked !== undefined && now - asked < RECHECK_MS;
  }

  /** With nothing due: wakes when the first recheck or retry falls due. */
  private scheduleWake(): void {
    const now = this.now();
    let at = Number.POSITIVE_INFINITY;
    const consider = (dataRef: string, day: bigint) => {
      const failed = this.failedAt.get(`${dataRef}\n${day}`);
      if (failed !== undefined && now - failed < RETRY_MS) {
        at = Math.min(at, failed + RETRY_MS);
        return;
      }
      const entry = this.refs.get(dataRef)?.days.get(day);
      if (entry && !entry.final && this.inUse(dataRef, now))
        at = Math.min(at, Number(entry.countedAt / MS_NS) + RECHECK_MS);
    };
    for (const k of this.front) consider(k.dataRef, k.day);
    for (const [dataRef, days] of this.ahead) for (const day of days) consider(dataRef, day);
    for (const [dataRef, asked] of this.askedAt) {
      if (now - asked >= RECHECK_MS) continue;
      for (const day of this.refs.get(dataRef)?.days.keys() ?? []) consider(dataRef, day);
    }
    if (at === Number.POSITIVE_INFINITY) return;
    this.wake = setTimeout(
      () => {
        this.wake = undefined;
        this.pump();
      },
      Math.max(0, at - now),
    );
  }

  /** One vehicle-day: its refCount, then one 60 s refBuckets, or four 6 h parts above the bound. */
  private async count(dataRef: string, day: bigint): Promise<void> {
    const abort = this.abort.signal;
    const range: Scope = { dataRef, from: day, to: day + DAY_NS };
    const rows = await this.source.refCount(dataRef, range, abort);
    const part = DAY_NS / 4n;
    const parts: Scope[] =
      rows > this.scanRows
        ? [0n, 1n, 2n, 3n].map((i) => ({
            dataRef,
            from: day + i * part,
            to: day + (i + 1n) * part,
          }))
        : [range];
    const buckets: GridBucket[] = [];
    for (const p of parts) {
      const got = await this.source.refBuckets(dataRef, CALENDAR_GRID_NS, false, p, abort);
      for (const b of got)
        if (b.count > 0 && b.start >= range.from && b.start < range.to)
          buckets.push({ start: b.start, count: b.count });
    }
    if (this.stopped) return;
    buckets.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    const countedAt = BigInt(this.now()) * MS_NS;
    const entry = this.refEntry(dataRef);
    entry.days.set(day, { countedAt, final: countedAt > range.to + FINAL_LAG_NS, buckets });
    this.scheduleWrite(dataRef);
  }

  private refEntry(dataRef: string): DataRefDays {
    let entry = this.refs.get(dataRef);
    if (!entry) {
      entry = { days: new Map(), writtenAt: Number.NEGATIVE_INFINITY, timer: undefined };
      this.refs.set(dataRef, entry);
    }
    return entry;
  }

  private path(dataRef: string): string {
    return join(this.dir, `${encodeURIComponent(dataRef)}.json`);
  }

  /** At once when the last write is WRITE_EVERY_MS old, else when it will be. */
  private scheduleWrite(dataRef: string): void {
    const entry = this.refEntry(dataRef);
    if (entry.timer !== undefined) return;
    const wait = entry.writtenAt + WRITE_EVERY_MS - this.now();
    if (wait <= 0) {
      this.write(dataRef);
      return;
    }
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      this.write(dataRef);
    }, wait);
  }

  private write(dataRef: string): void {
    const entry = this.refEntry(dataRef);
    entry.writtenAt = this.now();
    const days: Record<string, unknown> = {};
    for (const [day, d] of [...entry.days].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      days[day.toString()] = {
        countedAt: d.countedAt.toString(),
        final: d.final,
        buckets: d.buckets.map((b) => [b.start.toString(), b.count]),
      };
    const { kind, database, table } = this.sourceInfo;
    const file = {
      version: 1,
      source: { kind, database, table },
      grid: CALENDAR_GRID_NS.toString(),
      days,
    };
    try {
      writeAtomic(this.path(dataRef), JSON.stringify(file));
    } catch (error) {
      this.warn(`calendar days of ${dataRef} not written: ${String(error)}`);
    }
  }

  /** Reads every day file at start; a file of another source, or one that does not parse, is ignored with one line. */
  private readAll(): void {
    let names: string[];
    try {
      names = readdirSync(this.dir).filter((n) => n.endsWith(".json"));
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(this.dir, name);
      let dataRef: string;
      try {
        dataRef = decodeURIComponent(name.slice(0, -".json".length));
      } catch {
        this.warn(`calendar day file ${path} ignored: not a data ref file name`);
        continue;
      }
      let days: Map<bigint, Day>;
      try {
        days = this.parse(JSON.parse(readFileSync(path, "utf8")));
      } catch (error) {
        this.warn(`calendar day file ${path} ignored: ${(error as Error).message}`);
        continue;
      }
      this.refs.set(dataRef, { days, writtenAt: Number.NEGATIVE_INFINITY, timer: undefined });
    }
  }

  private parse(json: unknown): Map<bigint, Day> {
    const file = json as {
      version?: unknown;
      source?: { kind?: unknown; database?: unknown; table?: unknown };
      grid?: unknown;
      days?: unknown;
    };
    if (typeof file !== "object" || file === null) throw new Error("not an object");
    if (file.version !== 1)
      throw new Error(`version ${String(file.version)}; this KIPscope reads 1`);
    const { kind, database, table } = this.sourceInfo;
    const s = file.source;
    if (s?.kind !== kind || s?.database !== database || s?.table !== table)
      throw new Error(
        `written for source ${String(s?.kind)} ${String(s?.database)}.${String(s?.table)}, not ${kind} ${database}.${table}`,
      );
    if (file.grid !== CALENDAR_GRID_NS.toString()) throw new Error(`grid ${String(file.grid)}`);
    if (typeof file.days !== "object" || file.days === null) throw new Error("days: not an object");
    const days = new Map<bigint, Day>();
    for (const [day, value] of Object.entries(file.days as Record<string, unknown>)) {
      const d = value as { countedAt?: unknown; final?: unknown; buckets?: unknown };
      if (typeof d?.countedAt !== "string" || typeof d.final !== "boolean")
        throw new Error(`day ${day}: countedAt or final missing`);
      if (!Array.isArray(d.buckets)) throw new Error(`day ${day}: buckets not an array`);
      const buckets = d.buckets.map((pair: unknown) => {
        if (!Array.isArray(pair) || typeof pair[0] !== "string" || typeof pair[1] !== "number")
          throw new Error(`day ${day}: a bucket is not [start, count]`);
        return { start: BigInt(pair[0]), count: pair[1] };
      });
      days.set(BigInt(day), { countedAt: BigInt(d.countedAt), final: d.final, buckets });
    }
    return days;
  }
}

/**
 * The days the picker would show for a workspace (B6): of its data ref (the scope's, else the
 * first timeseries window's first signal's), the UTC days of the UTC month holding that window's
 * range start and of the month before, plus one day on each side. None in a plain scope, whose
 * calendar shows its session only from one exact query (B6 "Paths", Q-7).
 */
export function aheadDays(workspace: Workspace): { dataRef: string; days: bigint[] } | undefined {
  if (workspace.scope && !workspace.scope.object) return undefined;
  const series = workspace.windows.filter(isTimeseries);
  const window = series.find((w) => w.signals.length > 0) ?? series[0];
  const first = window?.signals[0];
  const dataRef = workspace.scope?.dataRef ?? (first && parseSignalId(first.signalId)?.dataRef);
  const start = window?.range.from ?? workspace.scope?.from;
  if (dataRef === undefined || start === undefined) return undefined;
  const at = new Date(Number(BigInt(start) / MS_NS));
  const month = (offset: number) =>
    BigInt(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + offset, 1)) * MS_NS;
  const days: bigint[] = [];
  for (let day = month(-1) - DAY_NS; day <= month(1); day += DAY_NS) days.push(day);
  return { dataRef, days };
}

/**
 * Wants the days ahead of every open workspace (B6), every GAP_REFRESH_MS, on every workspace
 * change and when the set of open workspaces changes; returns the stop. Data refs no open
 * workspace uses any more are unwanted.
 */
export function fillAhead(
  days: Pick<CalendarDays, "want">,
  workspaces: Pick<Workspaces, "open" | "onChange">,
): () => void {
  let wanted = new Set<string>();
  let openIds = "";
  const pass = () => {
    const open = workspaces.open();
    openIds = open.map((e) => e.record.id).join(" ");
    const byRef = new Map<string, Set<bigint>>();
    for (const entry of open) {
      const ahead = aheadDays(entry.store.workspace);
      if (!ahead) continue;
      const set = byRef.get(ahead.dataRef) ?? new Set<bigint>();
      for (const day of ahead.days) set.add(day);
      byRef.set(ahead.dataRef, set);
    }
    for (const dataRef of wanted) if (!byRef.has(dataRef)) days.want(dataRef, []);
    for (const [dataRef, set] of byRef) days.want(dataRef, [...set]);
    wanted = new Set(byRef.keys());
  };
  pass();
  const every = setInterval(pass, GAP_REFRESH_MS);
  const check = setInterval(() => {
    const ids = workspaces
      .open()
      .map((e) => e.record.id)
      .join(" ");
    if (ids !== openIds) pass();
  }, OPEN_CHECK_MS);
  const unsubscribe = workspaces.onChange(pass);
  return () => {
    clearInterval(every);
    clearInterval(check);
    unsubscribe();
  };
}
