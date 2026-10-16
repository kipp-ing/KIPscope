import { ATTRIBUTION, type Measurement, type ServerMeta } from "@kipscope/shared";
import { type RefObject, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DROP_NEW } from "../chart/drag.ts";
import { fitFooter } from "./fit.ts";
import { browserZone, type FooterItem, footerItems, measurementItems } from "./items.ts";

export interface StatusBarProps {
  connected: boolean;
  revision: number;
  message?: string | undefined;
  onDismissMessage: () => void;
  measurement?: Measurement | undefined;
  meta?: ServerMeta | undefined;
  metaStale: boolean;
  dragging: boolean;
  /** The pointer is over the strip during a drag. */
  over: boolean;
  dropRef: RefObject<HTMLDivElement | null>;
}

/** Natural widths read from the DOM (design F5); all 0 until measured, so everything shows. */
interface Widths {
  available: number;
  status: number;
  attribution: number;
  gap: number;
  message: number;
  items: Record<string, number>;
}

/** Tooltip of the `kipp.ing` link: the full attribution, kept out of the visible text (design F1, Q1). */
const SITE_TITLE = `© ${ATTRIBUTION.year} ${ATTRIBUTION.author}, ${ATTRIBUTION.identification} · ${ATTRIBUTION.slogan}`;

const UNMEASURED: Widths = {
  available: 0,
  status: 0,
  attribution: 0,
  gap: 0,
  message: 0,
  items: {},
};

function sameWidths(a: Widths, b: Widths): boolean {
  if (
    a.available !== b.available ||
    a.status !== b.status ||
    a.attribution !== b.attribution ||
    a.gap !== b.gap ||
    a.message !== b.message
  )
    return false;
  const keys = Object.keys(a.items);
  return (
    keys.length === Object.keys(b.items).length && keys.every((k) => a.items[k] === b.items[k])
  );
}

function px(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

type BoxStyle = Pick<
  CSSStyleDeclaration,
  "borderLeftWidth" | "borderRightWidth" | "paddingLeft" | "paddingRight"
>;

/**
 * Content width of the bar from its fractional border-box width. Not `clientWidth`: it rounds to
 * whole px while the item widths are fractional, so a sub-pixel fit could clip the last item.
 */
export function contentWidth(borderBox: number, style: BoxStyle): number {
  return (
    borderBox -
    px(style.borderLeftWidth) -
    px(style.borderRightWidth) -
    px(style.paddingLeft) -
    px(style.paddingRight)
  );
}

function Item({ item, title }: { item: FooterItem; title: string }) {
  return (
    <span className={`footer-item tone-${item.tone}`} title={title}>
      {item.text}
    </span>
  );
}

/**
 * The status strip with the footer (add-footer design F1, F3, F5): status, message, measurement
 * info, automatic meta items and the attribution at the right end. Items that do not fit hide whole
 * by rank (`fitFooter`); a hidden measuring copy gives their natural widths. During a drag the strip
 * is the "+ New window" zone: the left part keeps its boxes invisible under the label, the
 * attribution stays, so nothing moves when a drag starts (workspace-layout "Top row and status strip").
 */
export function StatusBar(props: StatusBarProps) {
  const { connected, revision, message, measurement, meta, metaStale, dragging, over, dropRef } =
    props;
  const statusRef = useRef<HTMLSpanElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const attributionRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<Widths>(UNMEASURED);
  // The measuring copy exists only in the browser, so static markup holds each text once.
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => setMounted(true), []);

  const measured = useMemo(() => measurementItems(measurement), [measurement]);
  // The zone is read again with each meta answer, so a DST change shows within one poll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: meta is the refresh trigger
  const zone = useMemo(() => browserZone(), [meta]);
  const automatic = useMemo(() => footerItems(meta, metaStale, zone), [meta, metaStale, zone]);
  const all = useMemo(() => [...measured.items, ...automatic], [measured, automatic]);

  const fit = fitFooter({
    available: widths.available,
    status: widths.status,
    attribution: widths.attribution,
    gap: widths.gap,
    ...(message ? { message: widths.message } : {}),
    items: all.map((i) => ({ key: i.key, width: widths.items[i.key] ?? 0, rank: i.rank })),
  });
  const shown = new Set(fit.shown);
  const hidden = all.filter((i) => !shown.has(i.key));
  const shownMeasurement = measured.items.filter((i) => shown.has(i.key));
  const shownAutomatic = automatic.filter((i) => shown.has(i.key));

  const statusText = connected ? `connected · revision ${revision}` : "disconnected";
  // Widths are re-read when a text changes and on every resize of the bar (design F5 risks).
  const textKey = JSON.stringify([statusText, message ?? "", all.map((i) => [i.key, i.text])]);
  const measureRefLatest = useRef<() => void>(() => {});
  measureRefLatest.current = () => {
    const bar = dropRef.current;
    const copy = measureRef.current;
    if (!bar || !copy || !statusRef.current || !attributionRef.current || !leftRef.current) return;
    const style = getComputedStyle(bar);
    const items: Record<string, number> = {};
    for (const el of copy.querySelectorAll<HTMLElement>("[data-key]")) {
      items[el.dataset.key ?? ""] = el.getBoundingClientRect().width;
    }
    const next: Widths = {
      available: contentWidth(bar.getBoundingClientRect().width, style),
      status: statusRef.current.getBoundingClientRect().width,
      attribution: attributionRef.current.getBoundingClientRect().width,
      gap: px(getComputedStyle(leftRef.current).columnGap),
      message: copy.querySelector<HTMLElement>(".message")?.getBoundingClientRect().width ?? 0,
      items,
    };
    setWidths((prev) => (sameWidths(prev, next) ? prev : next));
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: textKey and mounted trigger a re-measure
  useLayoutEffect(() => measureRefLatest.current(), [textKey, mounted]);
  useLayoutEffect(() => {
    const bar = dropRef.current;
    if (!bar) return;
    const observer = new ResizeObserver(() => measureRefLatest.current());
    observer.observe(bar);
    return () => observer.disconnect();
  }, [dropRef]);

  return (
    <div
      ref={dropRef}
      className={`status-strip${dragging ? " drop" : ""}${over ? " over" : ""}${fit.wrap ? " wrap" : ""}`}
      {...(dragging ? { "data-drop": DROP_NEW } : {})}
    >
      <div ref={leftRef} className="status-left">
        <span ref={statusRef} className={`conn ${connected ? "ok" : "down"}`}>
          {statusText}
        </span>
        {message && (
          <button
            type="button"
            className="message"
            title={`${message} · Click to dismiss`}
            onClick={props.onDismissMessage}
          >
            {message} ✕
          </button>
        )}
        {shownMeasurement.length > 0 && (
          <span className="footer-group measurement">
            {shownMeasurement.map((i) => (
              <Item key={i.key} item={i} title={measured.title} />
            ))}
          </span>
        )}
        {shownAutomatic.length > 0 && (
          <span className="footer-group meta-items">
            {shownAutomatic.map((i) => (
              <Item key={i.key} item={i} title={i.title} />
            ))}
          </span>
        )}
        {dragging && <span className="drop-label">+ New window</span>}
        {mounted && (
          <div ref={measureRef} className="status-measure" aria-hidden="true">
            {message && <span className="message">{message} ✕</span>}
            {all.map((i) => (
              <span key={i.key} data-key={i.key} className={`footer-item tone-${i.tone}`}>
                {i.text}
              </span>
            ))}
          </div>
        )}
      </div>
      <span ref={attributionRef} className="attribution">
        <span title={hidden.length > 0 ? hidden.map((i) => i.text).join("\n") : undefined}>
          {ATTRIBUTION.product}
        </span>
        {" · "}
        <a href={ATTRIBUTION.url} target="_blank" rel="noopener noreferrer" title={SITE_TITLE}>
          {ATTRIBUTION.urlLabel}
        </a>
        {" · "}
        <a
          href={ATTRIBUTION.license.path}
          target="_blank"
          rel="noopener noreferrer"
          title={ATTRIBUTION.license.name}
        >
          {ATTRIBUTION.license.spdx}
        </a>
      </span>
    </div>
  );
}
