import type { Display, SeriesResult, Timestamp } from "@letsview/shared";
import { decodeTimes } from "@letsview/shared";

/** x/y arrays of one signal; x is the ns offset from the window origin. */
export interface SignalPoints {
  xs: number[];
  ys: number[];
  /** Envelope edges, aggregated data only. */
  min?: number[];
  max?: number[];
}

const offset = (t: Timestamp, origin: Timestamp) => Number(t - origin);

/**
 * Turns a query result into drawable points. Raw: the edge neighbors outside the range are
 * included so lines and steps cross the window edges, but nothing is drawn beyond the first or
 * last measured point. Buckets: one point at each bucket's center.
 */
export function toPoints(result: SeriesResult, origin: Timestamp): SignalPoints {
  const times = decodeTimes(result.t);
  if (result.kind === "raw") {
    const xs = times.map((t) => offset(t, origin));
    const ys = [...result.v];
    if (result.before) {
      xs.unshift(offset(BigInt(result.before.t), origin));
      ys.unshift(result.before.v);
    }
    if (result.after) {
      xs.push(offset(BigInt(result.after.t), origin));
      ys.push(result.after.v);
    }
    return { xs, ys };
  }
  const half = BigInt(result.width) / 2n;
  return {
    xs: times.map((t) => offset(t + half, origin)),
    ys: [...result.mean],
    min: [...result.min],
    max: [...result.max],
  };
}

export type PathKind = "line" | "step" | "markers";

export interface SignalInput {
  key: string;
  label: string;
  unit?: string;
  color: string;
  result?: SeriesResult;
}

/** One uPlot series, without uPlot runtime objects (paths are resolved by the component). */
export interface SeriesSpec {
  label: string;
  scale: string;
  color: string;
  path: PathKind;
  /** Envelope edge: invisible line, only used as band bound. */
  envelopeEdge?: boolean;
}

export interface ChartModel {
  /** Columns before joining: one table [xs, ...ys] per signal. */
  tables: number[][][];
  series: SeriesSpec[];
  /** Band bounds as uPlot series indices (1-based; 0 is x). */
  bands: [number, number][];
  /** Scale key → axis label (unit or signal name). */
  scales: Map<string, string>;
}

/** y scale per unit, so signals with different units don't squash each other. */
export function scaleKey(input: SignalInput): string {
  return input.unit ? `u:${input.unit}` : `s:${input.key}`;
}

/** Assembles series, tables and envelope bands for all loaded signals of a window. */
export function buildModel(inputs: SignalInput[], origin: Timestamp, display: Display): ChartModel {
  const model: ChartModel = { tables: [], series: [], bands: [], scales: new Map() };
  for (const input of inputs) {
    if (!input.result) continue;
    const pts = toPoints(input.result, origin);
    const scale = scaleKey(input);
    if (!model.scales.has(scale)) model.scales.set(scale, input.unit ?? input.label);
    const raw = input.result.kind === "raw";
    const path: PathKind = raw ? display.mode : "line";
    model.series.push({ label: input.label, scale, color: input.color, path });
    const table = [pts.xs, pts.ys];
    if (!raw && display.envelope && pts.min && pts.max) {
      const maxIndex = model.series.length + 1;
      model.series.push(
        {
          label: `${input.label} max`,
          scale,
          color: input.color,
          path: "line",
          envelopeEdge: true,
        },
        {
          label: `${input.label} min`,
          scale,
          color: input.color,
          path: "line",
          envelopeEdge: true,
        },
      );
      model.bands.push([maxIndex, maxIndex + 1]);
      table.push(pts.max, pts.min);
    }
    model.tables.push(table);
  }
  return model;
}

/** Aggregation summary for the window header: undefined when nothing is loaded. */
export function resolutionLabel(results: (SeriesResult | undefined)[]): string | undefined {
  const loaded = results.filter((r): r is SeriesResult => r !== undefined);
  if (loaded.length === 0) return undefined;
  const widths = loaded.flatMap((r) => (r.kind === "buckets" ? [BigInt(r.width)] : []));
  if (widths.length === 0) return "raw";
  const widest = widths.reduce((a, b) => (a > b ? a : b));
  const prefix = widths.length === loaded.length ? "aggregated" : "partly aggregated";
  return `${prefix} · ${formatDuration(widest)} per point`;
}

export function formatDuration(ns: bigint): string {
  const units: [bigint, string][] = [
    [3_600_000_000_000n, "h"],
    [60_000_000_000n, "min"],
    [1_000_000_000n, "s"],
    [1_000_000n, "ms"],
    [1_000n, "µs"],
  ];
  for (const [size, name] of units) {
    if (ns >= size) {
      const value = Number((ns * 10n) / size) / 10;
      return `${value} ${name}`;
    }
  }
  return `${ns} ns`;
}
