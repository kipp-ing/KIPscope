import {
  type CommandInput,
  type CommandResult,
  type ComputedDef,
  computedRef,
  computedUsers,
  MAX_COMPUTED_NAME,
  MAX_COMPUTED_UNIT,
  MAX_FORMULA_LENGTH,
  type MatchRange,
  resolveFormula,
  type SearchIndex,
  type SignalInfo,
  shownName,
} from "@kipscope/shared";
import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Highlight } from "../explorer/Highlight.tsx";
import { HINTS } from "../help/hints.ts";
import {
  accept,
  type CompletionToken,
  highlightSpans,
  type Suggestion,
  suggestions,
  tokenAt,
} from "./completion.ts";
import {
  canonicalFormula,
  type EditorContext,
  type EditorState,
  editorError,
  formulaNames,
  withAuto,
} from "./editor.ts";
import "./computed.css";

/** The second click on Delete must follow the first within this long (C12). */
export const DELETE_CONFIRM_MS = 3000;
/** Room kept between the panel and the viewport's edges. */
const EDGE_PX = 8;

export interface ComputedEditorProps {
  /** The definition being edited; absent for a new one. */
  def?: ComputedDef | undefined;
  /** `prefill` (with its caret) or `fromDef`; name and unit follow the formula while auto. */
  initial: EditorState & { caret?: number };
  /** Every definition of the workspace (the edited one included). */
  defs: readonly ComputedDef[];
  /** The signal list in use: typed names resolve against its catalog signals (F2). */
  catalog: readonly SignalInfo[];
  /** The completion index: the list's catalog signals plus its computed infos (F11). */
  index: SearchIndex;
  /** Where the panel wants its top-left corner (beside the sidebar, at the Computed header). */
  position: { left: number; top: number };
  sendCommand: (input: CommandInput) => Promise<CommandResult>;
  /** Closed: by Cancel or Esc (nothing), Delete or a saved edit (nothing), a new Save (its ID). */
  onClose: (created?: string) => void;
}

/** IDs of the index's computed infos of the edited definition and its users (F11: a cycle). */
function excludedIds(
  def: ComputedDef | undefined,
  defs: readonly ComputedDef[],
  index: SearchIndex,
) {
  const out = new Set<string>();
  if (!def) return out;
  const ids = new Set([def.id]);
  const queue = [def.name];
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    for (const user of computedUsers(name, defs)) {
      if (ids.has(user.id)) continue;
      ids.add(user.id);
      queue.push(user.name);
    }
  }
  for (const s of index.signals) {
    const ref = computedRef(s.id);
    if (ref && ids.has(ref.id)) out.add(s.id);
  }
  return out;
}

/** The query's terms in `text` (case ignored), as the explorer marks its hits. */
function hits(text: string, query: string): MatchRange[] {
  const lower = text.toLowerCase();
  const found: [number, number][] = [];
  for (const t of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const i = lower.indexOf(t);
    if (i >= 0) found.push([i, i + t.length]);
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of found) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push(r);
  }
  return merged;
}

const FUNCTION_TEXT = { abs: "abs(x)", min: "min(x, y, …)", max: "max(x, y, …)" } as const;

/**
 * The computed signal editor (C12, improve-formula-editor F11): a non-modal dialog panel with the
 * formula field (typed names, suggestions as in the explorer search, tinted names), a one-line live
 * error, name and unit, and Delete / Cancel / Save (the one primary). It sends
 * computed.add|update|remove through `sendCommand` and shows a refusal in its error line.
 */
export function ComputedEditor({
  def,
  initial,
  defs,
  catalog,
  index,
  position,
  sendCommand,
  onClose,
}: ComputedEditorProps) {
  /** The suggestion list is open (an input event left a token at the caret). */
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(0);
  const names = useMemo(() => formulaNames(catalog, defs), [catalog, defs]);
  const ctx = useMemo<EditorContext>(
    () => ({ names, defs, ...(def ? { selfId: def.id } : {}) }),
    [names, defs, def],
  );
  const [state, setState] = useState<EditorState>(() => {
    const { caret: _, ...s } = initial;
    return withAuto(s, ctx);
  });
  const [caret, setCaret] = useState(initial.caret ?? initial.formula.length);
  /**
   * The server's message of a refused command, in the error line until the next change. A refused
   * Save blocks Save until then; a refused Delete (`computed_in_use`) is transient: it leaves Save
   * alone and goes with the next keystroke.
   */
  const [refusal, setRefusal] = useState<{ message: string; blocks: boolean } | undefined>();
  /** A key went down in the panel: from then on an empty formula's error reads as an error. */
  const [typed, setTyped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [place, setPlace] = useState(position);
  const panelRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  /** A caret to put into the field after the next render (prefill, accept). */
  const caretToSet = useRef<number | undefined>(initial.caret ?? initial.formula.length);
  const ids = useId();

  const live = editorError(state, ctx);
  const error = refusal?.message ?? live;
  const blocked = busy || live !== undefined || refusal?.blocks === true;
  /** A new empty editor opens with its error muted, not red, until the first keystroke. */
  const quiet = refusal === undefined && !typed && state.formula === "";
  const resolved = useMemo(() => resolveFormula(state.formula, names), [state.formula, names]);
  const spans = useMemo(
    () => highlightSpans(state.formula, names, resolved.ok ? undefined : resolved.at),
    [state.formula, names, resolved],
  );
  const exclude = useMemo(() => excludedIds(def, defs, index), [def, defs, index]);
  const { token, rows } = useMemo(() => {
    const t = listOpen ? tokenAt(state.formula, caret) : undefined;
    return { token: t, rows: t ? suggestions(t, index, exclude) : [] };
  }, [listOpen, state.formula, caret, index, exclude]);
  /** The list shows only with rows: an empty one would cover the error line for nothing. */
  const list = token !== undefined && rows.length > 0 ? token : undefined;

  const closeList = () => {
    setListOpen(false);
    setActive(0);
  };

  /** The formula changed: name and unit follow while their auto flag holds. */
  const changeFormula = (formula: string, at: number) => {
    setRefusal(undefined);
    setState(withAuto({ ...state, formula }, ctx));
    setCaret(at);
  };

  const acceptRow = (t: CompletionToken, s: Suggestion | undefined) => {
    if (!s || (s.kind === "signal" && s.disabled !== undefined)) return;
    const next = accept(state.formula, t, s);
    changeFormula(next.text, next.caret);
    caretToSet.current = next.caret;
    closeList();
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

  // Focus in the field at open (F12); the caret follows in the next effect.
  useLayoutEffect(() => {
    fieldRef.current?.focus();
  }, []);

  // The caret after prefill or accept; the tint layer follows the field's scroll.
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const at = caretToSet.current;
    if (at !== undefined) {
      caretToSet.current = undefined;
      el.setSelectionRange(at, at);
    }
    if (layerRef.current) layerRef.current.scrollTop = el.scrollTop;
  });

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
      setRefusal({ message: result.message, blocks: input.type !== "computed.remove" });
      return;
    }
    onClose(created ? result.created : undefined);
  };

  const save = () => {
    if (blocked) return;
    const formula = canonicalFormula(state, ctx);
    if (formula === undefined) return;
    const unit = state.unit.trim();
    const body = { name: state.name.trim(), formula, ...(unit !== "" ? { unit } : {}) };
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

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    // Keys typed here never reach the app's shortcuts.
    e.stopPropagation();
    setTyped(true);
    if (refusal && !refusal.blocks) setRefusal(undefined);
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
      save();
    }
  };

  /** F11 keys: with the list open ↑/↓, Enter or Tab accept, Esc closes only the list. */
  const onFieldKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (list) {
      const n = rows.length;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((active + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        acceptRow(list, rows[Math.min(active, n - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeList();
        return;
      }
    }
    if (e.key === "Enter") {
      // Never a newline: Enter saves when valid (L3).
      e.preventDefault();
      e.stopPropagation();
      save();
    }
  };

  /** The caret moved: the list closes when it leaves the token it was opened for. */
  const onFieldSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const at = el.selectionStart;
    if (at === caret && el.selectionEnd === at) return;
    if (listOpen) {
      const now = el.selectionEnd === at ? tokenAt(el.value, at) : undefined;
      const before = el.value === state.formula ? tokenAt(state.formula, caret) : now;
      if (!now || now.start !== before?.start) closeList();
    }
    setCaret(at);
  };

  const title = def ? "Edit computed signal" : "New computed signal";
  return (
    <div
      ref={panelRef}
      className="computed-editor"
      role="dialog"
      aria-labelledby={`${ids}-title`}
      style={{ left: place.left, top: place.top }}
      onKeyDown={onPanelKeyDown}
    >
      <div className="computed-title" id={`${ids}-title`}>
        {title}
      </div>
      <div className="section-label">Formula</div>
      <div className="computed-formula">
        <div className="computed-tints mono" ref={layerRef} aria-hidden="true">
          {tinted(state.formula, spans)}
        </div>
        <textarea
          ref={fieldRef}
          className="mono"
          aria-label="Formula"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={list !== undefined}
          aria-controls={`${ids}-list`}
          aria-activedescendant={list ? `${ids}-${active}` : undefined}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={HINTS.formulaPlaceholder}
          maxLength={MAX_FORMULA_LENGTH}
          value={state.formula}
          onChange={(e) => {
            const el = e.currentTarget;
            changeFormula(el.value, el.selectionStart);
            setActive(0);
            setListOpen(tokenAt(el.value, el.selectionStart) !== undefined);
          }}
          onSelect={onFieldSelect}
          onScroll={(e) => {
            if (layerRef.current) layerRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onBlur={closeList}
          onKeyDown={onFieldKeyDown}
        />
        {list && (
          <div className="computed-list" id={`${ids}-list`} role="listbox">
            {rows.map((s, i) => (
              <SuggestionRow
                key={s.kind === "function" ? s.name : s.info.id}
                id={`${ids}-${i}`}
                s={s}
                query={list.query}
                active={i === active}
                onHover={() => setActive(i)}
                onAccept={() => acceptRow(list, s)}
              />
            ))}
          </div>
        )}
      </div>
      {/* One line, its height reserved, so nothing moves between valid and invalid (M8). */}
      <p
        className={quiet ? "computed-error quiet" : "computed-error"}
        aria-live="polite"
        title={error}
      >
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
        <button type="button" className="primary" disabled={blocked} onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}

/** The formula's text with a `mark` per tinted span; the text itself is transparent (F11). */
function tinted(
  text: string,
  spans: readonly { start: number; end: number; kind: "signal" | "computed" | "bad" }[],
): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.start > at) out.push(text.slice(at, s.start));
    const cls = s.kind === "signal" ? "sig" : s.kind === "computed" ? "sig computed" : "bad";
    out.push(
      <mark key={s.start} className={cls}>
        {text.slice(s.start, s.end)}
      </mark>,
    );
    at = s.end;
  }
  // The trailing space keeps a last empty line as tall as in the field.
  out.push(`${text.slice(at)} `);
  return out;
}

interface RowProps {
  id: string;
  s: Suggestion;
  query: string;
  active: boolean;
  onHover: () => void;
  onAccept: () => void;
}

/**
 * One suggestion (F11): a function as `abs(x)`, a computed signal with `ƒ` and its name, a catalog
 * signal with its shown name (mono) and unit; a signal with states drawn disabled with its title.
 * A mouse-down accepts without leaving the field.
 */
export function SuggestionRow({ id, s, query, active, onHover, onAccept }: RowProps) {
  const disabled = s.kind === "signal" ? s.disabled : undefined;
  const computed = s.kind === "signal" && s.info.computed !== undefined;
  const text = s.kind === "function" ? FUNCTION_TEXT[s.name] : shownName(s.info);
  const cls = `computed-option${active ? " active" : ""}${disabled ? " disabled" : ""}`;
  return (
    // biome-ignore lint/a11y/useFocusableInteractive: focus stays in the formula field
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={disabled !== undefined || undefined}
      className={cls}
      title={disabled ?? (s.kind === "signal" ? shownName(s.info) : undefined)}
      onMouseDown={(e) => {
        e.preventDefault();
        onAccept();
      }}
      onMouseEnter={onHover}
    >
      <span className="computed-option-glyph">{computed ? "ƒ" : ""}</span>
      <span className={computed ? "computed-option-name" : "computed-option-name mono"}>
        <Highlight text={text} ranges={hits(text, query)} />
      </span>
      {s.kind === "signal" && s.info.unit && (
        <span className="computed-option-unit">{s.info.unit}</span>
      )}
    </div>
  );
}
