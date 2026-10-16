import {
  buildSearchIndex,
  type Digits,
  type SignalInfo,
  searchSignals,
  shownName,
  type WorkspaceWindow,
  windowTitle,
} from "@kipscope/shared";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { fetchCatalog } from "../api.ts";
import { SNA_ALPHA } from "../chart/build.ts";
import { DRAG_THRESHOLD_PX, type ExplorerDragSource } from "../chart/drag.ts";
import { isSearchKey } from "../keys.ts";
import type { SidebarPart } from "../layout/sidebar.ts";
import {
  CHUNK,
  formatSnaPhysical,
  HIDE_GRACE_MS,
  HOVER_DELAY_MS,
  NEW_WINDOW,
  nextShown,
  visibleCount,
} from "./format.ts";
import { explorerItems, firstSignal } from "./groups.ts";
import { Highlight } from "./Highlight.tsx";
import { SignalCard } from "./SignalCard.tsx";
import {
  clickMode,
  extendTo,
  isMacPlatform,
  NO_SELECTION,
  preventListPress,
  pruneSelection,
  type Selection,
  selectClick,
  selectedInOrder,
} from "./selection.ts";

export { NEW_WINDOW };

/** Retry interval while the catalog is not loaded yet (design E3). */
const RETRY_MS = 5000;

interface Props {
  /** All windows; "Add to" lists timeseries and values windows by windowTitle. */
  windows: WorkspaceWindow[];
  onAdd: (signal: SignalInfo, target: string) => void;
  /** `+` or Enter on a selected row of a selection of two or more (design M5): the selection in list order. */
  onAddMany: (signalIds: string[], target: string) => void;
  onSeen: (signals: SignalInfo[]) => void;
  /** Pointer down on a row's name; App starts its signal drag after DRAG_THRESHOLD_PX (window change D5). Absent → rows not draggable. */
  onDragStart?: (source: ExplorerDragSource, event: React.PointerEvent) => void;
  /** True while an App-level signal drag runs; the explorer closes and suppresses its hover card. */
  dragging?: boolean;
  /** Chart colour of a signal shown in a window; the SNA dot takes it like the chart's SNA lanes (E5). Absent or undefined → --sna. */
  colorOf?: (signalId: string) => string | undefined;
  /** Significant digits of the hover card's values (workspace option, design N10). */
  digits: Digits;
  /** NEW_WINDOW or the marked window's ID; App resolves it with resolveTarget. */
  target: string;
  /** The "Add to" select changed: a window ID marks it, NEW_WINDOW clears the mark. */
  onTarget: (target: string) => void;
  /** Sidebar open; while false, `/` calls onOpen and focuses the search after it becomes true. */
  open: boolean;
  onOpen: () => void;
  /** The part under the sidebar's switch (design V11); `/` switches to "signals" before focusing. */
  part: SidebarPart;
  onPart: (part: SidebarPart) => void;
  /** The events panel, shown in place of the explorer while `part` is "events". */
  children?: React.ReactNode;
}

/** The open hover card: index of a signal item, the row's rect, and how it was opened. */
interface Card {
  index: number;
  anchor: DOMRect;
  byKey: boolean;
}

/**
 * Searches the full catalog in the browser on every keystroke (spec signal-catalog, design E1–E10):
 * one line per match, hover card, keys, chunks, drag source and a stable "Add to" target; with
 * groups, a header per group that opens and closes (signal-groups, design G6).
 */
export function SignalExplorer({
  windows,
  onAdd,
  onAddMany,
  onSeen,
  onDragStart,
  dragging,
  colorOf,
  digits,
  target,
  onTarget,
  open,
  onOpen,
  part,
  onPart,
  children,
}: Props) {
  const [catalog, setCatalog] = useState<SignalInfo[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(CHUNK);
  /** Item index; undefined after a query change means firstSignal(items) (design G6). */
  const [active, setActive] = useState<number | undefined>();
  /** Groups flipped since the last query change (design G6); not remembered. */
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const [card, setCard] = useState<Card | undefined>();
  /** Selected signal rows (design M5); cleared by a query change, pruned when a group closes. */
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);

  const inputRef = useRef<HTMLInputElement>(null);
  /** Set while a list click focuses the search: its text is not selected then. */
  const quietFocus = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Set by arrow keys: the next render scrolls the active row into view and moves the card. */
  const keyMoved = useRef(false);
  /** Where the pointer went down on a row; a click after a move of DRAG_THRESHOLD_PX ends a drag. */
  const pressAt = useRef<{ index: number; x: number; y: number }>(undefined);
  /** Time of the last scroll caused by arrow keys; such scrolls keep the card open. */
  const keyScrollAt = useRef(0);
  const draggingRef = useRef(dragging);
  draggingRef.current = dragging;
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;

  const ids = useId();
  const listId = `${ids}-list`;
  const cardId = `${ids}-card`;
  const optionId = (i: number) => `${ids}-opt-${i}`;

  // Load the whole catalog once; it loads asynchronously at server start, so retry until it is there.
  useEffect(() => {
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      fetchCatalog(controller.signal).then(
        (snapshot) => {
          setCatalog(snapshot.items);
          setError(undefined);
          onSeenRef.current(snapshot.items);
        },
        (e: unknown) => {
          if (controller.signal.aborted) return;
          setError(e instanceof Error ? e.message : String(e));
          retry = setTimeout(load, RETRY_MS);
        },
      );
    };
    load();
    return () => {
      controller.abort();
      clearTimeout(retry);
    };
  }, []);

  const index = useMemo(() => buildSearchIndex(catalog ?? []), [catalog]);
  const matches = useMemo(() => searchSignals(index, query), [index, query]);
  const grouped = useMemo(() => (catalog ?? []).some((s) => s.group !== undefined), [catalog]);
  const items = useMemo(
    () => explorerItems(matches, query.trim() !== "", grouped, toggled),
    [matches, query, grouped, toggled],
  );
  const activeItem = active ?? firstSignal(items);
  const visible = visibleCount(items.length, shown);

  // The target is a window ID held by App (the mark, design L5); App resolves it with resolveTarget.
  const targetWindow = windows.find((w) => w.id === target);
  const addLabel = `Add to ${targetWindow ? windowTitle(targetWindow) : "new window"}`;

  const clearTimers = useCallback(() => {
    clearTimeout(openTimer.current);
    clearTimeout(hideTimer.current);
  }, []);

  const closeCard = useCallback(() => {
    clearTimers();
    setCard(undefined);
  }, [clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    if (dragging) closeCard();
  }, [dragging, closeCard]);

  const rowElement = (i: number) => listRef.current?.children[i] as HTMLElement | undefined;
  /** jsdom has no scrollIntoView. */
  const scrollToRow = (el: HTMLElement) => el.scrollIntoView?.({ block: "nearest" });

  const showCard = (i: number, byKey: boolean) => {
    const el = rowElement(i);
    if (!el || draggingRef.current || items[i]?.kind !== "signal") return;
    setCard({ index: i, anchor: el.getBoundingClientRect(), byKey });
  };

  /** Opens the card for row i after the hover delay, or at once while a card is open. */
  const requestCard = (i: number, byKey: boolean) => {
    clearTimers();
    if (draggingRef.current) return;
    if (card) showCard(i, byKey);
    else openTimer.current = setTimeout(() => showCard(i, byKey), HOVER_DELAY_MS);
  };

  /** Closes the card after the grace time unless the pointer reaches a row or the card. */
  const releaseCard = () => {
    clearTimers();
    hideTimer.current = setTimeout(() => setCard(undefined), HIDE_GRACE_MS);
  };

  const changeQuery = (q: string) => {
    setQuery(q);
    setActive(undefined);
    setToggled(new Set());
    setShown(CHUNK);
    setSelection(NO_SELECTION);
    closeCard();
  };

  /** Opens or closes a group; the header at item i stays active. */
  const toggleGroup = (name: string, i: number) => {
    const next = new Set(toggled);
    if (!next.delete(name)) next.add(name);
    setToggled(next);
    // A closed group's rows leave the selection (design M5).
    setSelection(
      pruneSelection(selection, explorerItems(matches, query.trim() !== "", grouped, next)),
    );
    setActive(i);
    closeCard();
  };

  /** `+` and Enter: the whole selection when the row is in one of two or more, else the row (L3). */
  const addSet = (s: SignalInfo) => {
    const selected = selectedInOrder(selection, items);
    if (selection.ids.has(s.id) && selected.length >= 2) onAddMany(selected, target);
    else onAdd(s, target);
  };

  /** A click on signal row i selects (L1) and makes it active; a click that ends a drag does nothing. */
  const clickRow = (e: React.MouseEvent, i: number) => {
    const press = pressAt.current;
    if (
      press &&
      press.index === i &&
      Math.hypot(e.clientX - press.x, e.clientY - press.y) >= DRAG_THRESHOLD_PX
    )
      return;
    setSelection(selectClick(selection, items, i, clickMode(e, isMacPlatform(navigator.platform))));
    setActive(i);
    keepKeys();
  };

  /** Focus into the search after a click in the list, so arrows, Shift+Arrow and Enter reach it
   * (the list keeps no focus, D-065); the query text stays unselected. */
  const keepKeys = () => {
    const input = inputRef.current;
    if (!input || document.activeElement === input) return;
    quietFocus.current = true;
    input.focus({ preventScroll: true });
    quietFocus.current = false;
  };

  // After an arrow key: keep the active item in view and let the card follow it (rows only).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs only after a key moved the item
  useEffect(() => {
    if (!keyMoved.current) return;
    keyMoved.current = false;
    const el = rowElement(activeItem);
    if (!el) return;
    keyScrollAt.current = performance.now();
    scrollToRow(el);
    if (items[activeItem]?.kind === "signal") requestCard(activeItem, true);
    else closeCard();
  }, [active, shown]);

  // After a query change the first signal item is active; bring it into view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs only when the query changed
  useEffect(() => {
    const el = rowElement(activeItem);
    if (el) scrollToRow(el);
  }, [query]);

  // `/` outside a text field focuses the search (design E8). While the sidebar is collapsed or shows
  // the events the search cannot take focus: `/` opens it on Signals, and the search is focused
  // after that render (L1, V11).
  const openRef = useRef(open);
  openRef.current = open;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const partRef = useRef(part);
  partRef.current = part;
  const onPartRef = useRef(onPart);
  onPartRef.current = onPart;
  const focusOnOpen = useRef(false);
  const focusSearch = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSearchKey(e, document.activeElement)) return;
      e.preventDefault();
      if (openRef.current && partRef.current === "signals") return focusSearch();
      focusOnOpen.current = true;
      if (!openRef.current) onOpenRef.current();
      if (partRef.current !== "signals") onPartRef.current("signals");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusSearch]);
  useEffect(() => {
    if (!open || part !== "signals" || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    focusSearch();
  }, [open, part, focusSearch]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        changeQuery("");
        return;
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        if (items.length === 0) return;
        const next = Math.max(
          0,
          Math.min(items.length - 1, activeItem + (e.key === "ArrowDown" ? 1 : -1)),
        );
        if (next === activeItem) return;
        if (next >= visible) setShown(nextShown(items.length, shown));
        if (e.shiftKey) setSelection(extendTo(selection, items, activeItem, next));
        keyMoved.current = true;
        setActive(next);
        return;
      }
      case "Enter": {
        const item = items[activeItem];
        if (!item) return;
        e.preventDefault();
        if (item.kind === "group") toggleGroup(item.name, activeItem);
        else addSet(item.match.signal);
        return;
      }
    }
  };

  const onListScroll = () => {
    if (performance.now() - keyScrollAt.current < 200) return;
    closeCard();
  };

  const cardItem = card && items[card.index];
  const cardMatch = cardItem?.kind === "signal" ? cardItem.match : undefined;
  const more = nextShown(items.length, shown) - visible;
  /** Signal rows rendered while items are cut off ("showing N"); undefined when all are rendered. */
  const shownRows =
    visible < items.length
      ? items.slice(0, visible).filter((it) => it.kind === "signal").length
      : undefined;

  return (
    // While the events show, the explorer's own elements stay mounted but hidden (events.css), so
    // query, scroll position and active row survive the switch.
    <aside className={part === "events" ? "explorer part-events" : "explorer"}>
      <div className="sidebar-switch" role="tablist" aria-label="Sidebar">
        {(["signals", "events"] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={part === p}
            title={p === "signals" ? "Signals ( / )" : "Events ( e )"}
            onClick={() => onPart(p)}
          >
            {p === "signals" ? "Signals" : "Events"}
          </button>
        ))}
      </div>
      <input
        ref={inputRef}
        type="search"
        placeholder="Search name, description, unit…  ( / )"
        value={query}
        onChange={(e) => changeQuery(e.target.value)}
        onKeyDown={onKeyDown}
        // Typing after focusing replaces the last query.
        onFocus={(e) => quietFocus.current || e.currentTarget.select()}
        onBlur={() => card?.byKey && closeCard()}
        aria-label="Search signals"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={items.length > 0}
        aria-controls={listId}
        aria-activedescendant={items.length > 0 ? optionId(activeItem) : undefined}
      />
      <label className="target">
        Add to{" "}
        <select
          value={target}
          title={targetWindow ? windowTitle(targetWindow) : "New window"}
          onChange={(e) => onTarget(e.target.value)}
        >
          <option value={NEW_WINDOW}>New window</option>
          {windows.map((w) => (
            <option key={w.id} value={w.id}>
              {windowTitle(w)}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{catalog ? error : `${error} (retrying)`}</p>}
      {catalog ? (
        <p className="count">
          {matches.length} match{matches.length === 1 ? "" : "es"}
          {shownRows !== undefined ? `, showing ${shownRows}` : ""}
        </p>
      ) : (
        !error && <p className="count">Loading catalog…</p>
      )}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: only blocks text selection and focus loss (D-065) */}
      <div className="results" onScroll={onListScroll} onMouseDown={preventListPress}>
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Signals"
          aria-multiselectable="true"
        >
          {items.slice(0, visible).map((item, i) => {
            if (item.kind === "group") {
              return (
                // A header is an option too, so arrows and aria-activedescendant reach it (design G6).
                // biome-ignore lint/a11y/useFocusableInteractive: focus stays in the combobox
                // biome-ignore lint/a11y/useKeyWithClickEvents: Enter in the search toggles the active header
                // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-expanded on the header option is pinned (design G6)
                <div
                  key={`g:${item.name}`}
                  id={optionId(i)}
                  role="option"
                  aria-selected={false}
                  aria-expanded={item.open}
                  className={i === activeItem ? "group-head active" : "group-head"}
                  onClick={() => {
                    toggleGroup(item.name, i);
                    keepKeys();
                  }}
                >
                  <span className="chevron" aria-hidden="true">
                    {item.open ? "▾" : "▸"}
                  </span>
                  <span className="group-name">{item.name}</span>
                  <span className="group-count">{item.count}</span>
                </div>
              );
            }
            const m = item.match;
            const s = m.signal;
            const selected = selection.ids.has(s.id);
            // Physical SNA values are readings of the signal: number-format with unit (design N9).
            const sna =
              s.sna &&
              `SNA ${s.sna.map((c) => formatSnaPhysical(c.value, s.unit, digits)).join(", ")}`;
            return (
              // Options of an aria-activedescendant listbox: focus stays in the combobox.
              // biome-ignore lint/a11y/useFocusableInteractive: see above
              // biome-ignore lint/a11y/useKeyWithClickEvents: Shift+Arrow in the search selects by keyboard
              <div
                key={`s:${s.id}`}
                id={optionId(i)}
                role="option"
                aria-selected={selected}
                aria-describedby={card?.index === i ? cardId : undefined}
                className={`row${i === activeItem ? " active" : ""}${selected ? " selected" : ""}`}
                onPointerEnter={() => requestCard(i, false)}
                onPointerLeave={releaseCard}
                // A click or a drag start on the row closes the card; it reopens on the next row entered.
                onPointerDown={(e) => {
                  pressAt.current = { index: i, x: e.clientX, y: e.clientY };
                  closeCard();
                }}
                onClick={(e) => clickRow(e, i)}
              >
                {sna ? (
                  <span
                    className="sna-dot"
                    role="img"
                    title={sna}
                    aria-label={sna}
                    style={{ background: colorOf?.(s.id) ?? "var(--sna)", opacity: SNA_ALPHA }}
                  />
                ) : (
                  <span className="sna-dot none" />
                )}
                <span
                  className={onDragStart ? "name draggable" : "name"}
                  title={s.displayName !== undefined ? s.name : undefined}
                  onPointerDown={(e) => {
                    if (e.button !== 0 || !onDragStart) return;
                    // A selected row of two or more drags the selection (L2).
                    const list = selected ? selectedInOrder(selection, items) : [];
                    const source: ExplorerDragSource =
                      list.length >= 2 ? { signalId: s.id, signalIds: list } : { signalId: s.id };
                    onDragStart(source, e);
                  }}
                >
                  <Highlight text={shownName(s)} ranges={m.shown} />
                </span>
                {s.unit && (
                  <span className="unit row-unit">
                    <Highlight text={s.unit} ranges={m.unit} />
                  </span>
                )}
                <button
                  type="button"
                  className="add"
                  title={addLabel}
                  aria-label={addLabel}
                  // Not a tab stop: Enter in the search adds the active row.
                  tabIndex={-1}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    addSet(s);
                  }}
                >
                  +
                </button>
              </div>
            );
          })}
        </div>
        {more > 0 && (
          <button
            type="button"
            className="show-more"
            onClick={() => setShown(nextShown(items.length, shown))}
          >
            Show {more} more
          </button>
        )}
      </div>
      {cardMatch && card && !dragging && (
        <SignalCard
          match={cardMatch}
          windows={windows}
          anchor={card.anchor}
          id={cardId}
          digits={digits}
          onPointerEnter={() => clearTimeout(hideTimer.current)}
          onPointerLeave={releaseCard}
        />
      )}
      {part === "events" && children}
    </aside>
  );
}
