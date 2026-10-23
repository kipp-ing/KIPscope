import {
  buildSearchIndex,
  type CommandInput,
  type CommandResult,
  type ComputedDef,
  computedRef,
  type Digits,
  type SignalInfo,
  searchSignals,
  shownName,
  toggleFavourites,
  type WorkspaceScope,
  type WorkspaceWindow,
  windowTitle,
} from "@kipscope/shared";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiRequestError, changeFavourites, fetchCatalog } from "../api.ts";
import { SNA_ALPHA } from "../chart/build.ts";
import { DRAG_THRESHOLD_PX, type ExplorerDragSource } from "../chart/drag.ts";
import { ComputedEditor } from "../computed/ComputedEditor.tsx";
import {
  type EditorContext,
  type EditorState,
  formulaNames,
  fromDef,
  prefill,
  withAuto,
} from "../computed/editor.ts";
import { HINTS } from "../help/hints.ts";
import { isEditKey, isSearchKey, isStarKey } from "../keys.ts";
import type { SidebarPart } from "../layout/sidebar.ts";
import { CatalogLoader, NO_SCOPE_TEXT, partialText } from "./catalogLoader.ts";
import {
  CHUNK,
  formatSnaPhysical,
  HIDE_GRACE_MS,
  HOVER_DELAY_MS,
  NEW_WINDOW,
  nextShown,
  visibleCount,
} from "./format.ts";
import { COMPUTED_GROUP, type ExplorerItem, explorerItems, firstSignal } from "./groups.ts";
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
  selectedInClickOrder,
  selectedInOrder,
} from "./selection.ts";
import { shouldClearOnAnswer } from "./starRequest.ts";
import { sidebarTabs, type TabEvents } from "./tabs.ts";

export { NEW_WINDOW };

interface Props {
  /** The workspace's scope; a change loads that scope's catalog (add-scope Z12). */
  scope?: WorkspaceScope | undefined;
  /** 1-based position of the open catalog's session, for the note on a `partial` list (add-case-open K14). */
  session?: number | undefined;
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
  /** The strip's events, counted on the Events tab (design DW14); absent while they load. */
  eventsTab?: TabEvents | undefined;
  /** The user's favourite names from the live channel (add-favourites F9); undefined until the first. */
  favourites?: readonly string[] | undefined;
  /**
   * The computed signals' infos of the list in use (`computedInfos`, add-computed-signals C11);
   * absent: no Computed section.
   */
  computed?: readonly SignalInfo[] | undefined;
  /** The workspace's computed definitions, for the editor (C12). */
  computedDefs?: readonly ComputedDef[] | undefined;
  /** Sends the editor's computed.add|update|remove (App's command, results shown as any command's). */
  onCommand?: (input: CommandInput) => Promise<CommandResult>;
}

/** A row by what it shows (add-favourites F10): a signal and whether it is the Favourites copy, or a header. */
type RowKey = { id: string; copy: boolean } | { group: string } | { hint: true };

function rowKey(item: ExplorerItem | undefined): RowKey | undefined {
  if (!item) return undefined;
  if (item.kind === "hint") return { hint: true };
  return item.kind === "group"
    ? { group: item.name }
    : { id: item.match.signal.id, copy: item.inFavourites === true };
}

/** A computed row that cannot be shown here (C12): its inputs are not in the list. */
const unavailable = (s: SignalInfo) => s.computed?.unavailable !== undefined;

/**
 * The open editor: the edited definition (none for a new one), its first state (with the caret of
 * a prefill, F12) and its place.
 */
interface EditorOpen {
  def?: ComputedDef;
  initial: EditorState & { caret?: number };
  position: { left: number; top: number };
}

/** Index of the row `key` in `items`, else `old` clamped to the items (F10); -1 for no items. */
function findRow(items: readonly ExplorerItem[], key: RowKey | undefined, old: number): number {
  if (key) {
    const i = items.findIndex((it) =>
      "hint" in key
        ? it.kind === "hint"
        : "group" in key
          ? it.kind === "group" && it.name === key.group
          : it.kind === "signal" &&
            it.match.signal.id === key.id &&
            (it.inFavourites === true) === key.copy,
    );
    if (i >= 0) return i;
  }
  return Math.min(old, items.length - 1);
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
  scope,
  session,
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
  eventsTab,
  favourites,
  computed,
  computedDefs,
  onCommand,
}: Props) {
  const [catalog, setCatalog] = useState<SignalInfo[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  /** Scoped mode without a scope: the server answered 409 scope_required. */
  const [noScope, setNoScope] = useState(false);
  /** The list is the last linked session's while the vehicle's own loads (K11). */
  const [partial, setPartial] = useState(false);
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

  // The catalog of the workspace's scope, loaded again whenever the scope changes; it loads
  // asynchronously at server start, so a failure is retried until it is there.
  const [loader] = useState(
    () =>
      new CatalogLoader(fetchCatalog, (r) => {
        if (r.kind === "loaded") {
          setCatalog(r.snapshot.items);
          setError(undefined);
          setNoScope(false);
          setPartial(r.snapshot.partial === true);
          onSeenRef.current(r.snapshot.items);
        } else if (r.kind === "no_scope") {
          setCatalog(undefined);
          setError(undefined);
          setNoScope(true);
          setPartial(false);
        } else setError(r.message);
      }),
  );
  useEffect(() => {
    loader.setScope(scope);
  }, [loader, scope]);
  useEffect(() => () => loader.dispose(), [loader]);

  const index = useMemo(() => buildSearchIndex(catalog ?? []), [catalog]);
  const matches = useMemo(() => searchSignals(index, query), [index, query]);
  const grouped = useMemo(() => (catalog ?? []).some((s) => s.group !== undefined), [catalog]);
  const searching = query.trim() !== "";
  // The Computed section (C12): the computed infos through the same search.
  const computedIndex = useMemo(() => buildSearchIndex(computed ?? []), [computed]);
  const computedSection = useMemo(
    // Not before the list is in: an empty section would claim there are no definitions.
    () => (computed && catalog ? { matches: searchSignals(computedIndex, query) } : undefined),
    [computed, catalog, computedIndex, query],
  );
  const items = useMemo(
    () => explorerItems(matches, searching, grouped, toggled, favourites, computedSection),
    [matches, searching, grouped, toggled, favourites, computedSection],
  );
  const starred = useMemo(() => new Set(favourites), [favourites]);
  // Header tooltip (F7): distinct favourite names in this catalog, of all the user's favourites.
  const favouritesHint = useMemo(() => {
    const names = new Set((catalog ?? []).map((s) => s.name));
    return HINTS.favourites(
      (favourites ?? []).filter((n) => names.has(n)).length,
      favourites?.length ?? 0,
    );
  }, [catalog, favourites]);
  // While searching the best hit is active, its Favourites copy when it has one (F6).
  const activeItem = active ?? firstSignal(items, searching ? matches[0]?.signal.id : undefined);
  const visible = visibleCount(items.length, shown);

  // The target is a window ID held by App (the mark, design L5); App resolves it with resolveTarget.
  const targetWindow = windows.find((w) => w.id === target);
  const addLabel = HINTS.addButton(targetWindow ? windowTitle(targetWindow) : undefined);

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
      pruneSelection(
        selection,
        explorerItems(matches, searching, grouped, next, favourites, computedSection),
      ),
    );
    setActive(i);
    closeCard();
  };

  /**
   * `+` and Enter: the whole selection when the row is in one of two or more, else the row (L3);
   * unavailable computed rows are never added (C12).
   */
  const addSet = (s: SignalInfo) => {
    if (unavailable(s)) return;
    const blocked = new Set((computed ?? []).filter(unavailable).map((c) => c.id));
    const selected = selectedInOrder(selection, items).filter((id) => !blocked.has(id));
    if (selection.ids.has(s.id) && selected.length >= 2) onAddMany(selected, target);
    else onAdd(s, target);
  };

  // The computed signal editor (C12): opened by the header's +, the hint row, a row's pencil or F2.
  const [editor, setEditor] = useState<EditorOpen | undefined>();
  /**
   * The ID (`c<n>`) of a definition just created, until its info is in: then its row becomes active
   * and it is added (Q-8). State, not a ref, so the order of the HTTP answer and the live push does
   * not matter: the effect below runs on whichever comes last.
   */
  const [created, setCreated] = useState<string | undefined>();
  const asideRef = useRef<HTMLElement>(null);
  // The formula field's suggestions (F11): the list in use once per name plus each definition once,
  // ranked by the explorer search.
  const completionIndex = useMemo(() => {
    const names = new Set<string>();
    const defs = new Set<string>();
    const rows: SignalInfo[] = [];
    for (const s of catalog ?? []) {
      if (names.has(s.name)) continue;
      names.add(s.name);
      rows.push(s);
    }
    for (const c of computed ?? []) {
      const id = computedRef(c.id)?.id;
      if (id === undefined || defs.has(id)) continue;
      defs.add(id);
      rows.push(c);
    }
    return buildSearchIndex(rows);
  }, [catalog, computed]);
  /** Names, definitions and the edited one for resolving and checking a formula (F2, F11). */
  const editorContext = (selfId?: string): EditorContext => {
    const defs = computedDefs ?? [];
    return { names: formulaNames(catalog ?? [], defs), defs, ...(selfId ? { selfId } : {}) };
  };

  /** Left edge 8 px right of the sidebar, top at the Computed header (the editor clamps it). */
  const editorPosition = () => {
    const aside = asideRef.current?.getBoundingClientRect();
    const head = listRef.current?.querySelector("[data-computed-head]")?.getBoundingClientRect();
    return { left: (aside?.right ?? 0) + 8, top: head?.top ?? aside?.top ?? 0 };
  };

  /**
   * New computed signal, the field prefilled from the selection in click order (F12, L2): catalog
   * and available computed rows; `prefill` leaves out signals with states and keeps eight.
   */
  const openNew = () => {
    if (!onCommand) return;
    const byId = new Map<string, SignalInfo>();
    for (const it of items) if (it.kind === "signal") byId.set(it.match.signal.id, it.match.signal);
    const selected = selectedInClickOrder(selection, items)
      .flatMap((id) => byId.get(id) ?? [])
      .filter((s) => !unavailable(s));
    const filled = prefill(selected);
    const initial = { ...withAuto(filled, editorContext()), caret: filled.caret };
    closeCard();
    setEditor({ initial, position: editorPosition() });
  };

  /** Edit the definition behind a computed row. */
  const openEdit = (s: SignalInfo) => {
    const ref = computedRef(s.id);
    const def = ref && computedDefs?.find((d) => d.id === ref.id);
    if (!def || !onCommand) return;
    closeCard();
    setEditor({ def, initial: fromDef(def, editorContext(def.id)), position: editorPosition() });
  };

  const closeEditor = (id?: string) => {
    setEditor(undefined);
    if (id !== undefined) setCreated(id);
    keepKeys();
  };

  // After a new Save, once both the answer (its ID) and the live state (its info) are in, in either
  // order: its row becomes active and it is added exactly like Enter on a signal row, to the "Add to"
  // target, with "New window" into a new window (Q-8, L3). A refused add flashes as today and keeps
  // the definition.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the ID or the computed infos change
  useEffect(() => {
    if (created === undefined) return;
    const info = computed?.find((c) => computedRef(c.id)?.id === created);
    if (!info) return;
    setCreated(undefined);
    const at = findRow(items, { id: info.id, copy: false }, -1);
    if (at >= 0) {
      setActive(at);
      setSelection(NO_SELECTION);
      const el = rowElement(at);
      if (el) scrollToRow(el);
    }
    if (!unavailable(info)) onAdd(info, target);
  }, [created, computed]);

  /** The pending star request (F10): the row its click came from and that row's offsetTop then, or
   * no press for the key. The next favourites list keeps that row in place, after the key the active
   * row in view. */
  const starRequest = useRef<{ press: { key: RowKey | undefined; top: number } | undefined }>(
    undefined,
  );
  /** The row the list holds in place when the favourites change without a star click (F10, D-092):
   * the active row if fully visible, else the first fully visible row, and its offsetTop. Taken
   * after every render and scroll, so it holds the layout before the next favourites list. */
  const anchor = useRef<{ key: RowKey | undefined; top: number }>(undefined);

  /** Star or unstar signal s, or the selection it is in (F8), from a click at press or the key; the
   * list changes when the live channel sends the new favourites (F9: no optimistic change). */
  const star = (s: SignalInfo, press?: { key: RowKey | undefined; top: number }) => {
    const selected = selectedInOrder(selection, items);
    let names = [s.name];
    if (selection.ids.has(s.id) && selected.length >= 2) {
      const nameOf = new Map<string, string | undefined>();
      // Computed signals have no star (C12): they leave the starred names out.
      for (const it of items)
        if (it.kind === "signal")
          nameOf.set(
            it.match.signal.id,
            it.match.signal.computed ? undefined : it.match.signal.name,
          );
      names = [
        ...new Set(selected.flatMap((id) => (nameOf.has(id) ? (nameOf.get(id) ?? []) : [id]))),
      ];
    }
    const change = toggleFavourites(starred, names);
    if (!change) return;
    const request = { press };
    starRequest.current = request;
    changeFavourites(change).then(
      // The push follows only when the list changed. An answer that equals the shown list changed
      // nothing (F4: the local stars were stale) or its push has rendered: nothing is left to arm.
      // Otherwise the push is still to come and takes the request.
      (answer) => {
        if (
          starRequest.current === request &&
          shouldClearOnAnswer(answer.names, last.current.favourites ?? [])
        )
          starRequest.current = undefined;
      },
      (err: unknown) => {
        if (starRequest.current === request) starRequest.current = undefined;
        console.error("favourites:", err instanceof ApiRequestError ? err.code : err);
      },
    );
  };

  /** F10's anchor row in the layout now (see `anchor`); undefined without rows in view. */
  const visibleAnchor = () => {
    const list = listRef.current;
    const results = list?.parentElement;
    if (!list || !results) return undefined;
    const box = results.getBoundingClientRect();
    const viewTop = box.top + results.clientTop;
    const viewBottom = viewTop + results.clientHeight;
    const fully = (el: Element | undefined) => {
      const r = el?.getBoundingClientRect();
      return r !== undefined && r.top >= viewTop && r.bottom <= viewBottom;
    };
    let i = activeItem;
    if (!fully(rowElement(i))) {
      // Rows are in order: the first whose top is in the view, by bisection.
      const rows = list.children;
      let lo = 0;
      let hi = rows.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((rows[mid] as Element).getBoundingClientRect().top < viewTop) lo = mid + 1;
        else hi = mid;
      }
      if (!fully(rows[lo])) return undefined;
      i = lo;
    }
    const el = rowElement(i);
    return el && { key: rowKey(items[i]), top: el.offsetTop };
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

  // F10: when the favourites change the list, the active row (and the card's) stay on the same row;
  // after a star click the clicked row stays under the pointer, after the key the active row in view.
  const last = useRef({ items, active: activeItem, favourites });
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs only when the favourites changed
  useLayoutEffect(() => {
    const before = last.current;
    // The first favourites message is no star change: the default active row applies.
    if (before.favourites === undefined || before.items.length === 0 || items.length === 0) return;
    const next = findRow(items, rowKey(before.items[before.active]), before.active);
    if (active !== undefined || next !== activeItem) setActive(next);
    if (card) {
      const at = findRow(items, rowKey(before.items[card.index]), card.index);
      if (items[at]?.kind === "signal") setCard({ ...card, index: at });
      else closeCard();
    }
    const request = starRequest.current;
    starRequest.current = undefined;
    // After a click the clicked row stays under the pointer; else (the key, another tab, the CLI)
    // the anchor row stays where it was (D-092). One scrollTop correction either way; -1 when the
    // row is gone (e.g. its Favourites copy was unstarred): no correction.
    const hold = request?.press ?? anchor.current;
    const at = hold ? findRow(items, hold.key, -1) : -1;
    const el = at >= 0 ? rowElement(at) : undefined;
    const results = listRef.current?.parentElement;
    if (hold && el && results) {
      keyScrollAt.current = performance.now();
      results.scrollTop += el.offsetTop - hold.top;
    }
    if (request && !request.press) {
      const activeEl = rowElement(next);
      if (activeEl) scrollToRow(activeEl);
    }
  }, [favourites]);
  useLayoutEffect(() => {
    last.current = { items, active: activeItem, favourites };
    anchor.current = visibleAnchor();
  });

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
    // Ctrl/Cmd+D stars the active row or its selection (F8); never the browser's bookmark dialog.
    if (isStarKey(e, isMacPlatform(navigator.platform))) {
      e.preventDefault();
      const item = items[activeItem];
      if (item?.kind !== "signal" || item.match.signal.computed) return;
      star(item.match.signal);
      return;
    }
    // F2 on an active computed row opens its editor (C12).
    if (isEditKey(e)) {
      const item = items[activeItem];
      if (item?.kind !== "signal" || !item.match.signal.computed) return;
      e.preventDefault();
      openEdit(item.match.signal);
      return;
    }
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
        else if (item.kind === "hint") openNew();
        else addSet(item.match.signal);
        return;
      }
    }
  };

  const onListScroll = () => {
    anchor.current = visibleAnchor();
    if (performance.now() - keyScrollAt.current < 200) return;
    closeCard();
  };

  const cardItem = card && items[card.index];
  const cardMatch = cardItem?.kind === "signal" ? cardItem.match : undefined;
  const more = nextShown(items.length, shown) - visible;
  const tabs = sidebarTabs({
    signals: catalog?.length ?? 0,
    ...(query.trim() !== "" ? { matches: matches.length } : {}),
    ...(eventsTab ? { events: eventsTab } : {}),
  });
  // No count and no count tooltip on Signals until the catalog is in.
  const signalsTab = catalog ? tabs.signals : {};

  return (
    // While the events show, the explorer's own elements stay mounted but hidden (events.css), so
    // query, scroll position and active row survive the switch.
    <aside ref={asideRef} className={part === "events" ? "explorer part-events" : "explorer"}>
      <div className="sidebar-switch" role="tablist" aria-label="Sidebar">
        {(["signals", "events"] as const).map((p) => {
          const tab: { count?: string; title?: string } =
            p === "signals" ? signalsTab : tabs.events;
          return (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={part === p}
              title={tab.title}
              // The count is drawn by CSS (styles.css), so the tab's text stays its name.
              data-count={tab.count}
              onClick={() => onPart(p)}
            >
              {p === "signals" ? "Signals" : "Events"}
            </button>
          );
        })}
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
        title={HINTS.search}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={items.length > 0}
        aria-controls={listId}
        aria-activedescendant={items.length > 0 ? optionId(activeItem) : undefined}
      />
      {/* A cut window title is read whole in the select's tooltip (design DW22). */}
      <label className="target">
        Add to{" "}
        <select
          value={target}
          title={targetWindow ? `${windowTitle(targetWindow)}\n${HINTS.target}` : HINTS.target}
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
      {catalog && partial && <p className="count partial">{partialText(session ?? 1)}</p>}
      {/* The counts sit on the tabs (design DW14); only states keep a line here. */}
      {!catalog &&
        (noScope ? (
          <p className="count">{NO_SCOPE_TEXT}</p>
        ) : (
          !error && <p className="count">Loading catalog…</p>
        ))}
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
                  title={item.favourites ? favouritesHint : undefined}
                  data-computed-head={item.computed ? "" : undefined}
                  onClick={() => {
                    toggleGroup(item.name, i);
                    keepKeys();
                  }}
                >
                  <span className="chevron" aria-hidden="true">
                    {item.open ? "▾" : "▸"}
                  </span>
                  <span className="group-name" title={item.favourites ? favouritesHint : item.name}>
                    {item.name}
                  </span>
                  <span className="group-count">{item.count}</span>
                  {item.computed && onCommand && (
                    <button
                      type="button"
                      className="computed-new"
                      aria-label="New computed signal"
                      title={HINTS.computedNew}
                      tabIndex={-1}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        // A click on + opens the editor; it does not toggle the section.
                        e.stopPropagation();
                        openNew();
                      }}
                    >
                      +
                    </button>
                  )}
                </div>
              );
            }
            if (item.kind === "hint") {
              return (
                // biome-ignore lint/a11y/useFocusableInteractive: focus stays in the combobox
                // biome-ignore lint/a11y/useKeyWithClickEvents: Enter in the search opens the editor
                <div
                  key={`h:${COMPUTED_GROUP}`}
                  id={optionId(i)}
                  role="option"
                  aria-selected={false}
                  className={i === activeItem ? "computed-hint active" : "computed-hint"}
                  onClick={() => {
                    setActive(i);
                    openNew();
                  }}
                >
                  {item.text}
                </div>
              );
            }
            const m = item.match;
            const s = m.signal;
            if (s.computed) {
              const off = s.computed.unavailable;
              return (
                // biome-ignore lint/a11y/useFocusableInteractive: focus stays in the combobox
                // biome-ignore lint/a11y/useKeyWithClickEvents: Shift+Arrow in the search selects by keyboard
                <div
                  key={`c:${s.id}`}
                  id={optionId(i)}
                  role="option"
                  aria-selected={selection.ids.has(s.id)}
                  aria-disabled={off !== undefined || undefined}
                  aria-describedby={card?.index === i ? cardId : undefined}
                  className={`row computed${off !== undefined ? " unavailable" : ""}${i === activeItem ? " active" : ""}${selection.ids.has(s.id) ? " selected" : ""}`}
                  title={off}
                  onPointerEnter={() => requestCard(i, false)}
                  onPointerLeave={releaseCard}
                  onPointerDown={(e) => {
                    pressAt.current = { index: i, x: e.clientX, y: e.clientY };
                    closeCard();
                  }}
                  onClick={(e) => clickRow(e, i)}
                >
                  {/* In the row's 18 px indent where other rows have the star (C12). */}
                  <span className="computed-glyph" aria-hidden="true">
                    ƒ
                  </span>
                  <span className="sna-dot none" />
                  <span
                    className={onDragStart && off === undefined ? "name draggable" : "name"}
                    title={off ?? shownName(s)}
                    onPointerDown={(e) => {
                      if (e.button !== 0 || !onDragStart || off !== undefined) return;
                      onDragStart({ signalId: s.id }, e);
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
                    className="edit"
                    title={HINTS.computedEdit}
                    aria-label="Edit computed signal"
                    tabIndex={-1}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(s);
                    }}
                  >
                    ✎
                  </button>
                  {off === undefined && (
                    <button
                      type="button"
                      className="add"
                      title={addLabel}
                      aria-label={addLabel}
                      tabIndex={-1}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        addSet(s);
                      }}
                    >
                      +
                    </button>
                  )}
                </div>
              );
            }
            const selected = selection.ids.has(s.id);
            const isStarred = starred.has(s.name);
            const starHint = HINTS.star(isStarred);
            // Physical SNA values are readings of the signal: number-format with unit (design N9).
            const sna =
              s.sna &&
              `SNA ${s.sna.map((c) => formatSnaPhysical(c.value, s.unit, digits)).join(", ")}`;
            return (
              // Options of an aria-activedescendant listbox: focus stays in the combobox.
              // biome-ignore lint/a11y/useFocusableInteractive: see above
              // biome-ignore lint/a11y/useKeyWithClickEvents: Shift+Arrow in the search selects by keyboard
              <div
                key={`${item.inFavourites ? "f" : "s"}:${s.id}`}
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
                {/* In the row's 18 px indent (F7): no drag, card, selection or active change. */}
                <button
                  type="button"
                  className={isStarred ? "star on" : "star"}
                  aria-pressed={isStarred}
                  title={starHint}
                  aria-label={starHint}
                  // Not a tab stop: Ctrl/Cmd+D in the search stars the active row.
                  tabIndex={-1}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    const row = e.currentTarget.parentElement;
                    star(s, { key: rowKey(item), top: row?.offsetTop ?? 0 });
                  }}
                >
                  {isStarred ? "★" : "☆"}
                </button>
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
                  // The source name, whole even where the shown name is cut (design DW22).
                  title={s.name}
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
      {editor &&
        onCommand &&
        createPortal(
          <ComputedEditor
            def={editor.def}
            initial={editor.initial}
            defs={computedDefs ?? []}
            catalog={catalog ?? []}
            index={completionIndex}
            position={editor.position}
            sendCommand={onCommand}
            onClose={closeEditor}
          />,
          document.body,
        )}
    </aside>
  );
}
