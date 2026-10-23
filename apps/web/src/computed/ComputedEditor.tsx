import {
  buildSearchIndex,
  type CommandInput,
  type CommandResult,
  type ComputedDef,
  MAX_COMPUTED_NAME,
  MAX_COMPUTED_UNIT,
  MAX_FORMULA_LENGTH,
  PRESETS,
  type PresetId,
  presetOf,
  type SignalInfo,
  searchSignals,
  shortSignalName,
  shownName,
} from "@kipscope/shared";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { HINTS } from "../help/hints.ts";
import {
  commandBody,
  type EditorState,
  editorError,
  usesB,
  withAuto,
  withPreset,
} from "./editor.ts";
import "./computed.css";

/** Rows a picker lists at most (design C12). */
export const PICKER_ROWS = 8;
/** The second click on Delete must follow the first within this long (C12). */
export const DELETE_CONFIRM_MS = 3000;
/** Room kept between the panel and the viewport's edges. */
const EDGE_PX = 8;

export interface ComputedEditorProps {
  /** The definition being edited; absent for a new one. */
  def?: ComputedDef | undefined;
  /** Prefilled (`prefill`) or the definition's state (`fromDef`), auto name and unit applied. */
  initial: EditorState;
  /** Every definition of the workspace (the edited one included). */
  defs: readonly ComputedDef[];
  /** The signal list in use; the pickers offer its signals, computed ones left out. */
  catalog: readonly SignalInfo[];
  /** Where the panel wants its top-left corner (beside the sidebar, at the Computed header). */
  position: { left: number; top: number };
  sendCommand: (input: CommandInput) => Promise<CommandResult>;
  /** Closed: by Cancel or Esc (nothing), Delete or a saved edit (nothing), a new Save (its ID). */
  onClose: (created?: string) => void;
}

/** The signal names the pickers offer: the list's catalog signals, once per name, list order. */
function pickerSignals(catalog: readonly SignalInfo[]): SignalInfo[] {
  const seen = new Set<string>();
  const out: SignalInfo[] = [];
  for (const s of catalog) {
    if (s.computed !== undefined || seen.has(s.name)) continue;
    seen.add(s.name);
    out.push(s);
  }
  return out;
}

const shortOf = (s: Pick<SignalInfo, "name" | "displayName">) => shortSignalName(shownName(s));

/** The option text of a preset: its label and formula with the shown minus sign. */
const presetText = (p: (typeof PRESETS)[number]) =>
  p.formula === undefined ? p.label : `${p.label}   ${p.formula.replace(/ - /g, " − ")}`;

/**
 * The computed signal editor (add-computed-signals C12): a non-modal dialog panel with pickers for
 * a and b, a preset select, the formula field with a one-line live error, name and unit, and
 * Delete / Cancel / Save (the one primary). It sends computed.add|update|remove through
 * `sendCommand` and shows a refusal in its error line.
 */
export function ComputedEditor({
  def,
  initial,
  defs,
  catalog,
  position,
  sendCommand,
  onClose,
}: ComputedEditorProps) {
  const [state, setState] = useState(initial);
  /** The server's message of a refused command; cleared by the next change. */
  const [refusal, setRefusal] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [place, setPlace] = useState(position);
  const panelRef = useRef<HTMLDivElement>(null);
  const formulaRef = useRef<HTMLInputElement>(null);
  const pickerARef = useRef<HTMLInputElement>(null);
  const ids = useId();

  const signals = useMemo(() => pickerSignals(catalog), [catalog]);
  const byName = useMemo(() => new Map(signals.map((s) => [s.name, s])), [signals]);
  const infoOf = (name: string) => byName.get(name);
  const others = useMemo(() => defs.filter((d) => d.id !== def?.id), [defs, def]);

  const error = refusal ?? editorError(state, others, infoOf);
  const bUsed = usesB(state.formula);
  const preset = presetOf(state.formula);

  /** Inputs or formula changed: name and unit follow while their auto flag holds. */
  const change = (next: EditorState) => {
    setRefusal(undefined);
    setState(withAuto(next, others, infoOf));
  };

  // Clamped into the viewport once, at open: the panel never moves while typing (layout never moves).
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const maxTop = window.innerHeight - el.offsetHeight - EDGE_PX;
    const maxLeft = window.innerWidth - el.offsetWidth - EDGE_PX;
    setPlace({
      left: Math.max(EDGE_PX, Math.min(position.left, maxLeft)),
      top: Math.max(EDGE_PX, Math.min(position.top, maxTop)),
    });
  }, [position.left, position.top]);

  // Focus rule (C12): the formula field when a is filled, else picker a.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only at open
  useEffect(() => {
    (state.a !== undefined ? formulaRef.current : pickerARef.current)?.focus();
  }, []);

  // The armed Delete falls back after DELETE_CONFIRM_MS.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), DELETE_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  const run = async (input: CommandInput, created: boolean) => {
    setBusy(true);
    const result = await sendCommand(input);
    setBusy(false);
    if (!result.ok) {
      setRefusal(result.message);
      return;
    }
    onClose(created ? result.created : undefined);
  };

  const save = () => {
    if (busy || error !== undefined) return;
    const body = commandBody(state);
    void run(
      def ? { type: "computed.update", id: def.id, ...body } : { type: "computed.add", ...body },
      def === undefined,
    );
  };

  const remove = () => {
    if (!def || busy) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    void run({ type: "computed.remove", id: def.id }, false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Keys typed here never reach the app's shortcuts.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === "Enter" && (tag === "INPUT" || tag === "SELECT")) {
      e.preventDefault();
      save();
    }
  };

  const title = def ? "Edit computed signal" : "New computed signal";
  return (
    <div
      ref={panelRef}
      className="computed-editor"
      role="dialog"
      aria-labelledby={`${ids}-title`}
      style={{ left: place.left, top: place.top }}
      onKeyDown={onKeyDown}
    >
      <div className="computed-title" id={`${ids}-title`}>
        {title}
      </div>
      <div className="section-label">Inputs</div>
      <SignalPicker
        label="a"
        inputRef={pickerARef}
        value={state.a}
        signals={signals}
        infoOf={infoOf}
        onPick={(name) => change({ ...state, a: name })}
      />
      <SignalPicker
        label="b"
        value={state.b}
        signals={signals}
        infoOf={infoOf}
        disabled={!bUsed}
        onPick={(name) => change({ ...state, b: name })}
        onClear={() => {
          const { b: _, ...rest } = state;
          change(rest);
        }}
      />
      <div className="section-label">Formula</div>
      <div className="computed-formula">
        <select
          aria-label="Preset"
          value={preset}
          onChange={(e) => change(withPreset(state, e.target.value as PresetId))}
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {presetText(p)}
            </option>
          ))}
        </select>
        <input
          ref={formulaRef}
          type="text"
          className="mono"
          aria-label="Formula"
          spellCheck={false}
          autoComplete="off"
          maxLength={MAX_FORMULA_LENGTH}
          value={state.formula}
          onChange={(e) => change({ ...state, formula: e.target.value })}
        />
      </div>
      {/* One line, its height reserved, so nothing moves between valid and invalid (M4). */}
      <p className="computed-error" aria-live="polite" title={error}>
        {error ?? ""}
      </p>
      <div className="computed-names">
        <label>
          <span className="section-label">Name</span>
          <input
            type="text"
            aria-label="Name"
            maxLength={MAX_COMPUTED_NAME + 20}
            value={state.name}
            onChange={(e) => {
              setRefusal(undefined);
              setState({ ...state, name: e.target.value, nameAuto: false });
            }}
          />
        </label>
        <label>
          <span className="section-label">Unit</span>
          <input
            type="text"
            aria-label="Unit"
            maxLength={MAX_COMPUTED_UNIT + 10}
            value={state.unit}
            onChange={(e) => {
              setRefusal(undefined);
              setState({ ...state, unit: e.target.value, unitAuto: false });
            }}
          />
        </label>
      </div>
      <div className="computed-actions">
        {def && (
          <button type="button" className="computed-delete" disabled={busy} onClick={remove}>
            {armed ? "Click again to delete" : "Delete"}
          </button>
        )}
        <span className="computed-spacer" />
        <button type="button" onClick={() => onClose()}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || error !== undefined}
          onClick={save}
        >
          Save
        </button>
      </div>
    </div>
  );
}

interface PickerProps {
  label: "a" | "b";
  value: string | undefined;
  signals: readonly SignalInfo[];
  infoOf: (name: string) => SignalInfo | undefined;
  onPick: (name: string) => void;
  /** Shows `×`, which empties the field. */
  onClear?: () => void;
  /** b while the formula does not use it: shown, value kept, not editable. */
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

/**
 * A signal picker (C12): a 26 px field showing the picked signal's short name; typing searches the
 * list with the shared search, at most PICKER_ROWS rows; arrows and Enter pick; a signal with states
 * is listed disabled with HINTS.computedNumericOnly and cannot be picked.
 */
export function SignalPicker({
  label,
  value,
  signals,
  infoOf,
  onPick,
  onClear,
  disabled = false,
  inputRef,
}: PickerProps) {
  const [query, setQuery] = useState<string | undefined>();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ids = useId();
  const index = useMemo(() => buildSearchIndex(signals), [signals]);
  const rows = useMemo(
    () => (open ? searchSignals(index, query ?? "").slice(0, PICKER_ROWS) : []),
    [open, index, query],
  );
  const picked = value === undefined ? undefined : infoOf(value);
  const shown = query ?? (value === undefined ? "" : shortOf(picked ?? { name: value }));

  const close = () => {
    setOpen(false);
    setQuery(undefined);
    setActive(0);
  };
  const pick = (s: SignalInfo) => {
    if (s.states !== undefined) return;
    onPick(s.name);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        const n = rows.length;
        if (n > 0) setActive((active + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        return;
      }
      case "Enter": {
        if (!open) return; // saves (the dialog's handler)
        e.preventDefault();
        e.stopPropagation();
        const s = rows[active]?.signal;
        if (s) pick(s);
        return;
      }
      case "Escape":
        if (!open) return; // cancels (the dialog's handler)
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
    }
  };

  return (
    <div className={disabled ? "computed-picker disabled" : "computed-picker"}>
      <span className="computed-var mono">{label}</span>
      <div className="computed-field">
        <input
          ref={inputRef}
          type="text"
          className="mono"
          aria-label={`Signal for ${label}`}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${ids}-list`}
          aria-activedescendant={open && rows.length > 0 ? `${ids}-${active}` : undefined}
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          placeholder="Search a signal"
          title={picked ? shownName(picked) : value}
          value={shown}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={close}
          onKeyDown={onKeyDown}
        />
        {onClear && value !== undefined && !disabled && (
          <button
            type="button"
            className="computed-icon"
            aria-label={`Clear ${label}`}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClear}
          >
            ×
          </button>
        )}
        <button
          type="button"
          className="computed-icon"
          aria-label={`List signals for ${label}`}
          tabIndex={-1}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (open ? close() : setOpen(true))}
        >
          ▾
        </button>
        {open && (
          <div className="computed-list" id={`${ids}-list`} role="listbox">
            {rows.length === 0 && <div className="computed-none">No signal matches</div>}
            {rows.map((m, i) => {
              const s = m.signal;
              const states = s.states !== undefined;
              return (
                // biome-ignore lint/a11y/useFocusableInteractive: focus stays in the combobox
                // biome-ignore lint/a11y/useKeyWithClickEvents: arrows and Enter in the field pick
                <div
                  key={s.name}
                  id={`${ids}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={states || undefined}
                  className={`computed-option${i === active ? " active" : ""}${states ? " disabled" : ""}`}
                  title={states ? HINTS.computedNumericOnly(shortOf(s)) : shownName(s)}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(s)}
                >
                  <span className="computed-option-name mono">{shownName(s)}</span>
                  {s.unit && <span className="computed-option-unit">{s.unit}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
