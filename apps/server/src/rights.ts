import { readFileSync } from "node:fs";
import {
  buildSearchIndex,
  type Command,
  parseSignalId,
  parseViewDoc,
  type SearchIndex,
  type SessionRights,
  type SessionShare,
  type SignalInfo,
  type SignalPage,
  searchSignals,
  type Workspace,
} from "@kipscope/shared";
import { parse } from "yaml";
import { type Catalog, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./catalog.ts";

/** The rules file (design M3): which data-ref patterns and share right each role gives. */
export interface Rules {
  readonly roles: readonly { role: string; data: readonly string[]; share: boolean }[];
}
/** What a request may do: see data refs matching `data`, share sessions with `share`. */
export interface Rights {
  readonly data: readonly string[];
  readonly share: boolean;
}

/** Rights of every request in `none` mode (D-084 „bei mir lokal ohne login"). */
export const ALL_RIGHTS: Rights = Object.freeze({ data: Object.freeze(["*"]), share: true });

/** Bounds of the rules file (design M3, Numbers). */
const MAX_RULE_ROLES = 1_000;
const MAX_RULE_PATTERNS = 200;
const MAX_TEXT = 128;
const RULE_KEYS = new Set(["role", "data", "share"]);
const CONTROL = /\p{Cc}/u;
const BAD_PATTERN = /[/\s\p{Cc}]/u;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads and checks the rules file; throws naming the file, the entry's index and the key. */
export function loadRules(path: string): Rules {
  const fail = (message: string): never => {
    throw new Error(`rules file ${path}: ${message}`);
  };
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    fail(`cannot read: ${(error as NodeJS.ErrnoException).code ?? String(error)}`);
  }
  let data: unknown;
  try {
    data = parse(text, { schema: "core" });
  } catch (error) {
    fail(`not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(data)) return fail("not a mapping");
  for (const key of Object.keys(data))
    if (!["kipscope", "version", "roles"].includes(key)) fail(`${key}: unknown key`);
  if (data.kipscope !== "rules") fail("kipscope: must be rules");
  if (data.version !== 1) fail(`version: must be 1, not ${String(data.version)}`);
  if (!Array.isArray(data.roles)) return fail("roles: must be a list");
  if (data.roles.length > MAX_RULE_ROLES) fail(`roles: more than ${MAX_RULE_ROLES} entries`);
  const seen = new Set<string>();
  const roles = data.roles.map((entry: unknown, i) => {
    const at = `roles[${i}]`;
    if (!isRecord(entry)) return fail(`${at}: must be a mapping`);
    for (const key of Object.keys(entry))
      if (!RULE_KEYS.has(key)) fail(`${at}.${key}: unknown key`);
    const { role, data: patterns, share } = entry;
    if (typeof role !== "string" || role.length < 1 || role.length > MAX_TEXT || CONTROL.test(role))
      fail(`${at}.role: 1–${MAX_TEXT} characters without control characters`);
    const name = role as string;
    if (seen.has(name)) fail(`${at}.role: ${name} appears more than once`);
    seen.add(name);
    if (!Array.isArray(patterns)) return fail(`${at}.data: must be a list`);
    if (patterns.length > MAX_RULE_PATTERNS)
      fail(`${at}.data: more than ${MAX_RULE_PATTERNS} patterns`);
    patterns.forEach((p: unknown, j) => {
      if (typeof p !== "string" || p.length < 1 || p.length > MAX_TEXT || BAD_PATTERN.test(p))
        fail(
          `${at}.data[${j}]: 1–${MAX_TEXT} characters without "/", whitespace or control characters`,
        );
    });
    if (share !== undefined && typeof share !== "boolean")
      fail(`${at}.share: must be true or false`);
    return { role: name, data: patterns as string[], share: share === true };
  });
  return { roles };
}

/** Union of the rights of every rule naming one of the identity's roles; none matching: no rights. */
export function rightsOf(identity: { readonly roles: readonly string[] }, rules: Rules): Rights {
  const roles = new Set(identity.roles);
  const data: string[] = [];
  let share = false;
  for (const rule of rules.roles) {
    if (!roles.has(rule.role)) continue;
    for (const pattern of rule.data) if (!data.includes(pattern)) data.push(pattern);
    if (rule.share) share = true;
  }
  return { data, share };
}

/** Deny by default: rights without a data pattern are no rights (design M3). */
export function hasRights(rights: Rights): boolean {
  return rights.data.length > 0;
}

/** Characters of a text, one per code point: the text itself unless it holds a surrogate. */
type Chars = string | readonly string[];
const SURROGATE = /[\uD800-\uDFFF]/;
const charsOf = (text: string): Chars => (SURROGATE.test(text) ? Array.from(text) : text);

/** Compiled pattern sets; bounded, since rights come from a finite rules file. */
const compiled = new Map<string, readonly Chars[]>();
const MAX_COMPILED = 1_000;

/** A pattern set split into characters once, duplicates dropped. */
function matcher(patterns: readonly string[]): readonly Chars[] {
  const key = patterns.join("\n");
  let set = compiled.get(key);
  if (!set) {
    set = [...new Set(patterns)].map(charsOf);
    if (compiled.size >= MAX_COMPILED) compiled.clear();
    compiled.set(key, set);
  }
  return set;
}

/**
 * Whether the whole text matches the glob: `*` any run of characters (also none, newlines too),
 * `?` one, everything else literal. Two pointers that fall back to the last `*` only, so no
 * backtracking: at most text × pattern steps, linear for any pattern a rules file holds.
 */
function globMatch(pattern: Chars, text: Chars): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === "*") {
      star = p++;
      mark = t;
    } else if (p < pattern.length && (pattern[p] === "?" || pattern[p] === text[t])) {
      p++;
      t++;
    } else if (star >= 0) {
      p = star + 1;
      t = ++mark;
    } else return false;
  }
  while (p < pattern.length && pattern[p] === "*") p++;
  return p === pattern.length;
}

/** Whether a data ref matches one of the rights' patterns; decided from the patterns alone. */
export function canSee(rights: Rights, dataRef: string): boolean {
  const text = charsOf(dataRef);
  return matcher(rights.data).some((pattern) => globMatch(pattern, text));
}

/** Whether the rights see every data ref, so lists need no filter. */
const seesAll = (rights: Rights) => rights.data.includes("*");

const dataRefOf = (id: unknown): string | undefined =>
  typeof id === "string" ? parseSignalId(id)?.dataRef : undefined;

function unique(refs: readonly (string | undefined)[]): string[] {
  return [...new Set(refs.filter((r): r is string => r !== undefined))];
}

/** Data refs a workspace holds: its scope, window signals and events-line signals; unique. */
export function dataRefsOfWorkspace(workspace: Workspace): string[] {
  return unique([
    workspace.scope?.dataRef,
    ...workspace.windows.flatMap((w) => w.signals.map((s) => dataRefOf(s.signalId))),
    ...(workspace.eventSignals ?? []).map(dataRefOf),
  ]);
}

const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Data refs a view document names: its scope, window signals and events signals. A document the
 * parser reads is taken as parsed; any other value as far as its shape goes, so a document that
 * will be refused anyway still names what it holds.
 */
export function dataRefsOfView(document: unknown): string[] {
  const parsed = parseViewDoc(document);
  if (parsed.ok) {
    const { doc } = parsed;
    return unique([
      doc.scope?.dataRef,
      ...doc.windows.flatMap((w) => w.signals.map(dataRefOf)),
      ...(doc.events?.signals ?? []).map(dataRefOf),
    ]);
  }
  if (!isRecord(document)) return [];
  const scope = isRecord(document.scope) ? document.scope.dataRef : undefined;
  const events = isRecord(document.events) ? document.events.signals : undefined;
  return unique([
    typeof scope === "string" ? scope : undefined,
    ...listOf(document.windows).flatMap((w) =>
      isRecord(w) ? listOf(w.signals).map(dataRefOf) : [],
    ),
    ...listOf(events).map(dataRefOf),
  ]);
}

/** Data refs a command names (design M6 table); a command that names none gives []. */
export function dataRefsOfCommand(command: Command): string[] {
  switch (command.type) {
    case "window.addSignal":
    case "events.addSignal":
      return unique([dataRefOf(command.signalId)]);
    case "scope.set":
      return [command.dataRef];
    case "view.open":
      // A caller-given scope opens on its data ref as much as the document's own.
      return unique([command.scope?.dataRef, ...dataRefsOfView(command.view)]);
    default:
      return [];
  }
}

/**
 * A user's rights on a session (design M6): none when any data ref of its workspace is hidden from
 * them, whoever they are; else by owner and share level.
 */
export function sessionRights(
  user: string,
  rights: Rights,
  session: {
    readonly record: { readonly owner: string; readonly share: SessionShare };
    readonly store: { readonly workspace: Workspace };
  },
): SessionRights | undefined {
  if (!dataRefsOfWorkspace(session.store.workspace).every((ref) => canSee(rights, ref)))
    return undefined;
  const { owner, share } = session.record;
  if (owner === user) return { open: true, change: true, owner: true };
  if (share === "write") return { open: true, change: true, owner: false };
  if (share === "read") return { open: true, change: false, owner: false };
  return undefined;
}

/** A shared signal list as one user sees it (design M6 "Filtered lists"). */
export interface CatalogView
  extends Pick<Catalog, "loadedAt" | "lastError" | "unavailableReason" | "refresh"> {
  /** Undefined for a signal the user may not see. */
  get(id: string): SignalInfo | undefined;
  /** Visible signals only. */
  all(): readonly SignalInfo[];
  /** Over visible signals; `total` counts them only. */
  search(q: string, offset: number, limit: number): SignalPage;
  snaRanges(id: string): ReturnType<Catalog["snaRanges"]>;
  /** Visible signals. */
  readonly size: number;
}

interface Visible {
  readonly signals: readonly SignalInfo[];
  readonly index: SearchIndex;
}

/** Visible signals per loaded list (keyed by its entries array, which a load replaces) and pattern set. */
const visibleCache = new WeakMap<readonly SignalInfo[], Map<string, Visible>>();

function visibleOf(all: readonly SignalInfo[], rights: Rights): Visible {
  let byRights = visibleCache.get(all);
  if (!byRights) {
    byRights = new Map();
    visibleCache.set(all, byRights);
  }
  const key = rights.data.join("\n");
  let visible = byRights.get(key);
  if (!visible) {
    const signals = all.filter((s) => canSee(rights, s.dataRef));
    visible = { signals, index: buildSearchIndex(signals) };
    byRights.set(key, visible);
  }
  return visible;
}

/**
 * The view of a shared list for `rights`: the list itself when they see every data ref, else one
 * that hides the signals of hidden data refs from lookups, lists, searches and counts. The list
 * itself, its loads and caches stay shared.
 */
export function catalogView(catalog: Catalog, rights: Rights): CatalogView {
  if (seesAll(rights)) return catalog;
  const visible = (id: string) => {
    const ref = parseSignalId(id)?.dataRef;
    return ref !== undefined && canSee(rights, ref);
  };
  return {
    get loadedAt() {
      return catalog.loadedAt;
    },
    get lastError() {
      return catalog.lastError;
    },
    get unavailableReason() {
      return catalog.unavailableReason;
    },
    refresh: () => catalog.refresh(),
    get: (id) => (visible(id) ? catalog.get(id) : undefined),
    all: () => visibleOf(catalog.all(), rights).signals,
    search(q, offset = 0, limit = DEFAULT_PAGE_SIZE) {
      const matches = searchSignals(visibleOf(catalog.all(), rights).index, q).map((m) => m.signal);
      const size = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
      const items = matches.slice(offset, offset + size);
      return { items, total: matches.length, more: offset + items.length < matches.length };
    },
    snaRanges: (id) => (visible(id) ? catalog.snaRanges(id) : []),
    get size() {
      return visibleOf(catalog.all(), rights).signals.length;
    },
  };
}
