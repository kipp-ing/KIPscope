import { type Digits, type SignalMatch, shownName, type WorkspaceWindow } from "@kipscope/shared";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import {
  formatDbcRange,
  formatMessageId,
  formatRawStep,
  formatScaling,
  formatSnaPhysical,
  formatSource,
  windowsShowing,
} from "./format.ts";
import { Highlight } from "./Highlight.tsx";

interface SignalCardProps {
  match: SignalMatch;
  windows: WorkspaceWindow[];
  /** Significant digits of the DBC range and SNA values (workspace option, number-format). */
  digits: Digits;
  /** The row's rect; the card sits right of it, top aligned, clamped into the viewport. */
  anchor: DOMRect;
  /** DOM id for the row's aria-describedby. */
  id: string;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

/** Gap between row and card, and minimal distance to the viewport edges, in CSS px. */
const GAP = 8;

/** Hover card with all metadata of a signal (spec "Signal hover card", design E7). */
export function SignalCard({
  match,
  windows,
  digits,
  anchor,
  id,
  onPointerEnter,
  onPointerLeave,
}: SignalCardProps) {
  const { signal } = match;
  const { unit, dbc } = signal;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.right + GAP, top: anchor.top });

  // Before paint: right of the row, top aligned, then clamped so the card stays in the viewport.
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return;
    const { width, height } = card.getBoundingClientRect();
    const left = Math.max(GAP, Math.min(anchor.right + GAP, window.innerWidth - width - GAP));
    const top = Math.max(GAP, Math.min(anchor.top, window.innerHeight - height - GAP));
    setPos((p) => (p.left === left && p.top === top ? p : { left, top }));
  }, [anchor.right, anchor.top]);

  // A computed signal's card (add-computed-signals C12): name, the stored formula with full signal
  // names and nested signals by name (its description, design F10), unit, nothing else.
  if (signal.computed) {
    return (
      <div
        ref={ref}
        id={id}
        role="tooltip"
        className="signal-card"
        style={{ left: pos.left, top: pos.top }}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        <div className="signal-card-name">
          <Highlight text={shownName(signal)} ranges={match.shown} />
        </div>
        {signal.description && (
          <div className="signal-card-description signal-card-formula">
            <Highlight text={signal.description} ranges={match.description} />
          </div>
        )}
        {unit && <Fields fields={[["Unit", unit]]} />}
      </div>
    );
  }

  const fields: [string, ReactNode][] = [];
  if (dbc) fields.push(["Message", `${dbc.message} · ${formatMessageId(dbc.messageId)}`]);
  if (unit) fields.push(["Unit", unit]);
  if (dbc?.factor !== undefined && dbc.offset !== undefined)
    fields.push(["Scaling", formatScaling(dbc.factor, dbc.offset)]);
  if (dbc?.factor !== undefined) fields.push(["Raw step", formatRawStep(dbc.factor, unit)]);
  if (dbc?.min !== undefined && dbc.max !== undefined)
    fields.push(["Range", formatDbcRange(dbc.min, dbc.max, unit, digits)]);
  if (signal.sna)
    fields.push([
      "SNA",
      signal.sna
        .map(
          (c) =>
            `${formatSnaPhysical(c.value, unit, digits)} (raw ${c.raw.toString(16).toUpperCase()}h)`,
        )
        .join(", "),
    ]);
  const shownIn = windowsShowing(windows, signal.id);

  return (
    <div
      ref={ref}
      id={id}
      role="tooltip"
      className="signal-card"
      style={{ left: pos.left, top: pos.top }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="signal-card-name">
        <Highlight text={signal.name} ranges={match.name} />
      </div>
      {signal.description && (
        <div className="signal-card-description">
          <Highlight text={signal.description} ranges={match.description} />
        </div>
      )}
      {fields.length > 0 && <Fields fields={fields} />}
      {dbc?.values && (
        <div className="signal-card-values">
          <div className="signal-card-label">Values</div>
          <ul>
            {dbc.values.map((v) => (
              <li key={v.raw}>
                {v.raw} {v.label}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Fields
        fields={[
          ["Source", formatSource(signal)],
          ["Shown in", shownIn.length > 0 ? shownIn.join(", ") : "no window"],
        ]}
      />
    </div>
  );
}

function Fields({ fields }: { fields: [string, ReactNode][] }) {
  return (
    <dl className="signal-card-fields">
      {fields.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
