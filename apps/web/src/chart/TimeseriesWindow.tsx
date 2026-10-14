import type {
  CommandInput,
  CommandResult,
  DisplayMode,
  RenderError,
  SignalInfo,
  TimeseriesWindow as WindowState,
} from "@letsview/shared";
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { fetchSeries } from "../api.ts";
import { formatFull, tickLabels, tickStepForWidth, ticks } from "../time/axis.ts";
import {
  buildModel,
  type ChartModel,
  resolutionLabel,
  type SeriesSpec,
  type SignalInput,
  yRange,
} from "./build.ts";
import { type LoadRequest, SeriesLoader } from "./loader.ts";

const COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#be185d",
  "#4d7c0f",
];
const PLOT_HEIGHT = 280;
const COMMIT_DELAY_MS = 300;
const MIN_SPAN_NS = 100;
/** Re-anchor the origin before offsets lose float precision (2^53 ns ≈ 104 days). */
const MAX_ORIGIN_DISTANCE = 2n ** 50n;

interface Props {
  window: WindowState;
  revision: number;
  info: (signalId: string) => SignalInfo | undefined;
  onCommand: (command: CommandInput) => Promise<CommandResult>;
  onReady: (windowId: string, revision: number, errors: RenderError[]) => void;
}

interface Range {
  from: bigint;
  to: bigint;
}

const colorOf = (index: number) => COLORS[index % COLORS.length] as string;

function seriesOptions(spec: SeriesSpec): uPlot.Series {
  const paths =
    spec.path === "step"
      ? uPlot.paths.stepped?.({ align: 1 })
      : spec.path === "markers"
        ? () => null
        : uPlot.paths.linear?.();
  return {
    label: spec.label,
    scale: spec.scale,
    // Envelope edges stay visible as thin lines so a single-bucket spike still shows.
    stroke: spec.envelopeEdge ? `${spec.color}88` : spec.color,
    width: spec.envelopeEdge ? 1 : 1.5,
    spanGaps: true,
    ...(paths ? { paths } : {}),
    points: { show: spec.path === "markers", size: 5, fill: spec.color, stroke: spec.color },
  };
}

export function TimeseriesWindow({ window: w, revision, info, onCommand, onReady }: Props) {
  const plotRef = useRef<HTMLDivElement>(null);
  const uplot = useRef<uPlot | undefined>(undefined);
  const [width, setWidth] = useState(0);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const loader = useMemo(() => new SeriesLoader(fetchSeries, rerender), []);
  useEffect(() => () => loader.dispose(), [loader]);

  const serverRange: Range = useMemo(
    () => ({ from: BigInt(w.range.from), to: BigInt(w.range.to) }),
    [w.range.from, w.range.to],
  );
  const origin = useRef(serverRange.from);
  const distance = serverRange.from - origin.current;
  if (distance > MAX_ORIGIN_DISTANCE || -distance > MAX_ORIGIN_DISTANCE) {
    origin.current = serverRange.from;
  }

  // Local preview during zoom/pan; the server range changes only after the command is accepted.
  const preview = useRef<Range | undefined>(undefined);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlight = useRef(false);

  const target = Math.min(4000, Math.max(100, Math.round(width)));
  const requests: LoadRequest[] = useMemo(
    () =>
      width === 0
        ? []
        : w.signals.map((s) => ({
            key: s.id,
            signalId: s.signalId,
            from: w.range.from,
            to: w.range.to,
            target,
          })),
    [w.signals, w.range.from, w.range.to, target, width],
  );
  useEffect(() => loader.update(requests), [loader, requests]);

  const inputs = w.signals.map((s, i) => {
    const meta = info(s.signalId);
    const input: SignalInput = { key: s.id, label: meta?.name ?? s.signalId, color: colorOf(i) };
    const result = loader.get(s.id)?.result;
    if (meta?.unit) input.unit = meta.unit;
    if (result) input.result = result;
    return input;
  });
  const model: ChartModel = buildModel(inputs, origin.current, w.display);
  const modelRef = useRef(model);
  modelRef.current = model;
  const structure = JSON.stringify([model.series, model.bands, [...model.scales]]);

  // --- uPlot instance -------------------------------------------------------------------------

  const viewRange = () => preview.current ?? serverRange;
  // The x range we last set; y ranges read it because u.scales.x is stale while new data is set.
  const xView = useRef<[number, number]>([0, 1]);
  const setView = (u: uPlot, r: Range) => {
    xView.current = [Number(r.from - origin.current), Number(r.to - origin.current)];
    u.setScale("x", { min: xView.current[0], max: xView.current[1] });
  };

  const commit = (r: Range) => {
    clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(async () => {
      commitTimer.current = undefined;
      inFlight.current = true;
      await onCommand({
        type: "window.setRange",
        windowId: w.id,
        from: r.from.toString(),
        to: r.to.toString(),
      });
      inFlight.current = false;
      // The accepted range arrives with the next revision; drop the preview if nothing newer.
      if (preview.current === r) preview.current = undefined;
      rerender();
    }, COMMIT_DELAY_MS);
  };

  const applyRange = (u: uPlot, min: number, max: number) => {
    if (max - min < MIN_SPAN_NS) return;
    const r = {
      from: origin.current + BigInt(Math.round(min)),
      to: origin.current + BigInt(Math.round(max)),
    };
    preview.current = r;
    setView(u, r);
    commit(r);
  };
  const applyRangeRef = useRef(applyRange);
  applyRangeRef.current = applyRange;

  // biome-ignore lint/correctness/useExhaustiveDependencies: recreated only when the series structure changes
  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el || width === 0) return;
    let step = 1n;
    const scales: uPlot.Scales = { x: { time: false } };
    const axes: uPlot.Axis[] = [
      {
        space: 100,
        size: 48,
        splits: (u) => {
          const min = u.scales.x?.min ?? 0;
          const max = u.scales.x?.max ?? 1;
          const from = origin.current + BigInt(Math.floor(min));
          const to = origin.current + BigInt(Math.ceil(max));
          step = tickStepForWidth(from, to, u.bbox.width / devicePixelRatio);
          return ticks(from, to, step).map((t) => Number(t - origin.current));
        },
        values: (_u, splits) =>
          tickLabels(
            splits.map((s) => origin.current + BigInt(Math.round(s))),
            step,
          ),
      },
    ];
    [...model.scales.entries()].forEach(([key, label], i) => {
      // Own y range: uPlot's auto range ignores points outside the view, so a segment drawn
      // only from edge neighbors would get no scale and disappear.
      scales[key] = {
        auto: true,
        range: (_u, dataMin, dataMax) =>
          yRange(modelRef.current, key, xView.current[0], xView.current[1]) ?? [
            dataMin ?? 0,
            dataMax ?? 1,
          ],
      };
      axes.push({ scale: key, label, side: i % 2 ? 1 : 3, show: i < 4, size: 60 });
    });

    const u = new uPlot(
      {
        width,
        height: PLOT_HEIGHT,
        scales,
        axes,
        series: [{}, ...model.series.map(seriesOptions)],
        bands: model.bands.map(([a, b]) => ({
          series: [a, b] as [number, number],
          fill: `${model.series[a - 1]?.color ?? "#000"}33`,
        })),
        legend: { show: false },
        cursor: { drag: { x: true, y: false, setScale: false } },
        hooks: {
          setSelect: [
            (self) => {
              const { left, width: selected } = self.select;
              if (selected > 5) {
                applyRangeRef.current(
                  self,
                  self.posToVal(left, "x"),
                  self.posToVal(left + selected, "x"),
                );
              }
              self.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
            },
          ],
        },
      },
      [[]],
      el,
    );
    uplot.current = u;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const min = u.scales.x?.min ?? 0;
      const max = u.scales.x?.max ?? 1;
      const span = max - min;
      const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (horizontal) {
        const delta = ((e.shiftKey ? e.deltaY : e.deltaX) / u.over.clientWidth) * span;
        applyRangeRef.current(u, min + delta, max + delta);
      } else {
        const at = u.posToVal(e.offsetX, "x");
        const factor = e.deltaY > 0 ? 1.25 : 0.8;
        applyRangeRef.current(u, at - (at - min) * factor, at + (max - at) * factor);
      }
    };
    u.over.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      u.over.removeEventListener("wheel", onWheel);
      u.destroy();
      uplot.current = undefined;
    };
  }, [structure, width === 0]);

  useEffect(() => {
    uplot.current?.setSize({ width, height: PLOT_HEIGHT });
  }, [width]);

  // Data and view: runs after every render; cheap compared to drawing.
  useLayoutEffect(() => {
    const u = uplot.current;
    if (!u) return;
    if (!inFlight.current && !commitTimer.current && preview.current) {
      // A different range arrived from the server (e.g. another client); it wins.
      preview.current = undefined;
    }
    const data =
      model.tables.length > 0
        ? uPlot.join(
            model.tables as uPlot.AlignedData[],
            model.tables.map((t) => t.map(() => 0)),
          )
        : ([[]] as uPlot.AlignedData);
    const r = viewRange();
    xView.current = [Number(r.from - origin.current), Number(r.to - origin.current)];
    u.setData(data, true);
    setView(u, r);
  });

  useEffect(() => () => clearTimeout(commitTimer.current), []);

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // --- render acknowledgement -----------------------------------------------------------------

  const settled = loader.settled(requests) && width > 0;
  const errors: RenderError[] = w.signals.flatMap((s) => {
    const state = loader.get(s.id);
    return state?.status === "error"
      ? [{ windowId: w.id, signalId: s.signalId, message: state.error ?? "error" }]
      : [];
  });
  const errorKey = JSON.stringify(errors);
  // biome-ignore lint/correctness/useExhaustiveDependencies: errors are tracked via errorKey
  useEffect(() => {
    if (settled) onReady(w.id, revision, errors);
  }, [settled, revision, errorKey, w.id, onReady]);

  // --- view -----------------------------------------------------------------------------------

  const zoomOut = () => {
    const u = uplot.current;
    if (!u) return;
    const min = u.scales.x?.min ?? 0;
    const max = u.scales.x?.max ?? 1;
    const half = max - min;
    applyRange(u, min - half / 2, max + half / 2);
  };
  const shown = viewRange();
  const resolution = resolutionLabel(w.signals.map((s) => loader.get(s.id)?.result));

  return (
    <section className="window">
      <header className="window-header">
        <strong>{w.title ?? w.id}</strong>
        {resolution && (
          <span className={`badge ${resolution === "raw" ? "raw" : "agg"}`}>{resolution}</span>
        )}
        <span className="range">
          {formatFull(shown.from)} – {formatFull(shown.to)}
        </span>
        <span className="spacer" />
        <label>
          Mode{" "}
          <select
            value={w.display.mode}
            onChange={(e) =>
              onCommand({
                type: "window.setDisplay",
                windowId: w.id,
                mode: e.target.value as DisplayMode,
              })
            }
          >
            <option value="line">Line</option>
            <option value="step">Step</option>
            <option value="markers">Markers</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={w.display.envelope}
            onChange={(e) =>
              onCommand({ type: "window.setDisplay", windowId: w.id, envelope: e.target.checked })
            }
          />{" "}
          Min/max
        </label>
        <button type="button" onClick={zoomOut}>
          Zoom out
        </button>
        <button type="button" onClick={() => onCommand({ type: "window.remove", windowId: w.id })}>
          Remove
        </button>
      </header>
      <div className="plot" ref={plotRef} />
      <ul className="signals">
        {w.signals.map((s, i) => {
          const meta = info(s.signalId);
          const state = loader.get(s.id);
          return (
            <li key={s.id} title={meta?.description}>
              <span className="swatch" style={{ background: colorOf(i) }} />
              <span className="sig">{meta?.name ?? s.signalId}</span>
              {meta?.unit && <span className="unit">[{meta.unit}]</span>}
              <span className={`status ${state?.status ?? "loading"}`}>
                {state?.status === "error"
                  ? `failed: ${state.error}`
                  : (state?.status ?? "loading")}
              </span>
              <button
                type="button"
                className="link"
                onClick={() =>
                  onCommand({ type: "window.removeSignal", windowId: w.id, assignmentId: s.id })
                }
              >
                remove
              </button>
            </li>
          );
        })}
        {w.signals.length === 0 && <li className="empty">Add signals from the explorer.</li>}
      </ul>
    </section>
  );
}
