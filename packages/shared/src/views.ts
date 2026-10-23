import { z } from "zod";
import { rebindSignalId } from "./case.ts";
import {
  ComputedInput,
  ComputedName,
  ComputedUnit,
  computedRef,
  computedSignalId,
  MAX_COMPUTED,
} from "./computed.ts";
import { packCode, unpackCode } from "./encoding.ts";
import { bindFormula, MAX_FORMULA_LENGTH, parseFormula } from "./formula.ts";
import { parseSignalId } from "./signals.ts";
import { fromIso, TIME_MAX, TIME_MIN, toIso } from "./time.ts";
import { MIN_SPAN_NS } from "./timenav.ts";
import {
  Digits,
  DisplayMode,
  isTimeseries,
  MAX_MEASUREMENT_KEY,
  MAX_MEASUREMENT_META,
  MAX_MEASUREMENT_TEXT,
  MAX_MEASUREMENT_VALUE,
  MAX_PLOT_HEIGHT,
  MAX_VIEW_NOTE,
  MAX_VIEW_TITLE,
  MAX_WINDOWS,
  MEASUREMENT_KEY,
  type Measurement,
  MIN_PLOT_HEIGHT,
  TimeInput,
  ValuesMode,
  type Workspace,
  type WorkspaceScope,
} from "./workspace.ts";

export { MAX_VIEW_NOTE, MAX_VIEW_TITLE, VIEW_NAME } from "./workspace.ts";

export const VIEW_VERSION = 1;
/** Largest view text accepted (YAML or JSON), and largest stored file. */
export const MAX_VIEW_BYTES = 262_144;
/** Signal entries per window in a document (assignments; the workspace limits still apply on open). */
export const MAX_VIEW_WINDOW_SIGNALS = 200;
/** The store's own view of the workspace before the last open (V5). */
export const PREVIOUS_VIEW = "_previous";
export const PREVIOUS_VIEW_TITLE = "Before last open";
/** Link length above which the UI advises sending the file instead (V8). */
export const MAX_LINK_CHARS = 8_192;

export type ViewWindowDoc =
  | {
      kind: "timeseries";
      title?: string;
      /** ISO-8601 UTC, exact to the ns. */
      from: string;
      to: string;
      mode: DisplayMode;
      envelope: boolean;
      height?: number;
      /** Full signal IDs, in window order. */
      signals: string[];
    }
  | { kind: "values"; title?: string; mode: ValuesMode; signals: string[] };

/** A computed signal in a view (add-computed-signals C10): no ID; windows list `<dataRef>/=<name>`. */
export interface ViewComputedDoc {
  name: string;
  formula: string;
  a: string;
  b?: string;
  unit?: string;
}

export interface ViewDoc {
  kipscope: "view";
  version: 1;
  title: string;
  note?: string;
  /** When it was saved, ISO-8601 UTC to the second; informational. */
  saved?: string;
  /** Data refs of all signals, sorted, unique; informational (V3). */
  data: string[];
  /** The scope the view opens with (design Z5, Z8); ISO-8601 UTC exact to the ns. */
  scope?: { dataRef: string; from: string; to: string };
  linkTime: boolean;
  /** ISO-8601 UTC. */
  cursors: { a?: string; b?: string; diff: boolean };
  digits: Digits;
  measurement?: Measurement;
  events?: { filter?: string; signals?: string[] };
  /** Computed signals, creation order; absent when none (C10). */
  computed?: ViewComputedDoc[];
  /** Palette index (0…9) per signal ID; absent entries get the next free colour on open. */
  colors?: Record<string, number>;
  windows: ViewWindowDoc[];
}

export type ParsedView =
  | { ok: true; doc: ViewDoc; warnings: string[] }
  | { ok: false; code: "invalid_view" | "unsupported_version"; message: string };

/** One saved view in the list (design V5). */
export interface ViewSummary {
  name: string;
  title: string;
  note?: string;
  saved?: string;
  windows: number;
  /** Distinct signal IDs over all windows. */
  signals: number;
  data: string[];
  /** Set when the file cannot be read or is not a valid view; the other fields are then name-only. */
  error?: string;
}

const NO_CONTROL = (s: string) => !/\p{Cc}/u.test(s);
/** Control characters other than tab and line breaks. */
const NO_CONTROL_BUT_BREAKS = (s: string) => !/(?![\t\n\r])\p{Cc}/u.test(s);

const ViewTitle = z
  .string()
  .trim()
  .min(1)
  .max(MAX_VIEW_TITLE)
  .refine(NO_CONTROL, { message: "no line breaks or control characters" });
const ViewNote = z
  .string()
  .max(MAX_VIEW_NOTE)
  .refine(NO_CONTROL_BUT_BREAKS, { message: "no control characters" });

/** `POST /api/views` body (design V6); the server checks `name` against VIEW_NAME itself. */
export const SaveViewRequest = z.object({
  title: ViewTitle,
  note: ViewNote.optional(),
  name: z.string().optional(),
  overwrite: z.boolean().optional(),
});
export type SaveViewRequest = z.infer<typeof SaveViewRequest>;

/** `POST /api/views/import` body (design V6); the server checks size and `name` itself. */
export const ImportViewRequest = z.object({
  text: z.string(),
  name: z.string().optional(),
  overwrite: z.boolean().optional(),
  open: z.boolean().optional(),
});
export type ImportViewRequest = z.infer<typeof ImportViewRequest>;

const Id = z.string().min(1).max(200);
/**
 * UTC ISO-8601 exact to the ns with the shortest fraction (`…:01.5Z`, as design V1's example), so
 * reading a canonical file and writing it again gives the same text.
 */
const viewIso = (t: bigint) => toIso(t).replace(/(\.\d*[1-9])0+Z$/, "$1Z");
/** Any time TimeInput reads, out as viewIso. */
const IsoTime = TimeInput.transform((ns) => viewIso(BigInt(ns)));
const Text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(NO_CONTROL, { message: "no line breaks or control characters" });

const TimeseriesWindowDoc = z
  .object({
    kind: z.literal("timeseries"),
    title: z.string().trim().max(200).optional(),
    from: IsoTime,
    to: IsoTime,
    mode: DisplayMode.default("line"),
    envelope: z.boolean().default(false),
    height: z.number().int().min(MIN_PLOT_HEIGHT).max(MAX_PLOT_HEIGHT).optional(),
    signals: z.array(Id).max(MAX_VIEW_WINDOW_SIGNALS),
  })
  .refine((w) => fromIso(w.to) > fromIso(w.from), {
    message: "to must be after from",
    path: ["to"],
  });

const ValuesWindowDoc = z.object({
  kind: z.literal("values"),
  title: z.string().trim().max(200).optional(),
  mode: ValuesMode.default("line"),
  signals: z.array(Id).max(MAX_VIEW_WINDOW_SIGNALS),
});

const ViewDocBody = z.object({
  title: ViewTitle,
  note: ViewNote.optional(),
  saved: IsoTime.optional(),
  data: z.array(Id).max(MAX_VIEW_WINDOW_SIGNALS).optional(),
  scope: z
    .object({
      dataRef: Id.refine((s) => !s.includes("/"), { message: "a data ref holds no /" }),
      from: IsoTime,
      to: IsoTime,
    })
    .refine((s) => fromIso(s.to) - fromIso(s.from) >= MIN_SPAN_NS, {
      message: `to must be at least ${MIN_SPAN_NS} ns after from`,
      path: ["to"],
    })
    .optional(),
  linkTime: z.boolean().default(true),
  cursors: z
    .object({ a: IsoTime.optional(), b: IsoTime.optional(), diff: z.boolean().default(false) })
    .default({ diff: false }),
  digits: Digits.default(3),
  measurement: z
    .object({
      name: Text(MAX_MEASUREMENT_TEXT).optional(),
      object: Text(MAX_MEASUREMENT_TEXT).optional(),
      meta: z
        .array(
          z.object({
            key: z.string().trim().max(MAX_MEASUREMENT_KEY).regex(MEASUREMENT_KEY),
            value: Text(MAX_MEASUREMENT_VALUE),
          }),
        )
        .max(MAX_MEASUREMENT_META)
        .optional(),
    })
    .optional(),
  // Filter and signals are checked on open (a bad filter → default, too many → first ones).
  events: z
    .object({
      filter: z.string().optional(),
      signals: z.array(Id).max(MAX_VIEW_WINDOW_SIGNALS).optional(),
    })
    .optional(),
  // Entries are checked one by one in parseViewDoc: a broken one is left out with a warning.
  computed: z.array(z.unknown()).max(MAX_VIEW_WINDOW_SIGNALS).optional(),
  colors: z.record(Id, z.number()).optional(),
  windows: z
    .array(z.discriminatedUnion("kind", [TimeseriesWindowDoc, ValuesWindowDoc]))
    .max(MAX_WINDOWS),
});

const KNOWN_TOP = [
  "kipscope",
  "version",
  "title",
  "note",
  "saved",
  "data",
  "scope",
  "linkTime",
  "cursors",
  "digits",
  "measurement",
  "events",
  "computed",
  "colors",
  "windows",
];
const KNOWN_WINDOW: Record<string, string[]> = {
  timeseries: ["kind", "title", "from", "to", "mode", "envelope", "height", "signals"],
  values: ["kind", "title", "mode", "signals"],
};
const KNOWN_NESTED: Record<string, string[]> = {
  cursors: ["a", "b", "diff"],
  events: ["filter", "signals"],
  measurement: ["name", "object", "meta"],
  scope: ["dataRef", "from", "to"],
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** One warning per key of `value` that is not in `known`. */
function unknownKeys(value: unknown, known: string[], prefix: string, warnings: string[]): void {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) warnings.push(`unknown key "${prefix}${key}" ignored`);
  }
}

/** The document in canonical key order (ViewDoc's), absent and empty optional fields left out. */
function canonical(d: ViewDoc): ViewDoc {
  const m = d.measurement;
  const e = d.events;
  return {
    kipscope: "view",
    version: VIEW_VERSION,
    title: d.title,
    ...(d.note ? { note: d.note } : {}),
    ...(d.saved !== undefined && { saved: d.saved }),
    data: [...new Set(d.data)].sort(),
    ...(d.scope && { scope: { dataRef: d.scope.dataRef, from: d.scope.from, to: d.scope.to } }),
    linkTime: d.linkTime,
    cursors: {
      ...(d.cursors.a !== undefined && { a: d.cursors.a }),
      ...(d.cursors.b !== undefined && { b: d.cursors.b }),
      diff: d.cursors.diff,
    },
    digits: d.digits,
    ...(m &&
      (m.name || m.object || m.meta?.length) && {
        measurement: {
          ...(m.name ? { name: m.name } : {}),
          ...(m.object ? { object: m.object } : {}),
          ...(m.meta?.length ? { meta: m.meta.map(({ key, value }) => ({ key, value })) } : {}),
        },
      }),
    ...(e &&
      (e.filter !== undefined || e.signals?.length) && {
        events: {
          ...(e.filter !== undefined && { filter: e.filter }),
          ...(e.signals?.length ? { signals: e.signals } : {}),
        },
      }),
    ...(d.computed?.length && {
      computed: d.computed.map((c) => ({
        name: c.name,
        formula: c.formula,
        a: c.a,
        ...(c.b !== undefined && { b: c.b }),
        ...(c.unit ? { unit: c.unit } : {}),
      })),
    }),
    ...(d.colors && Object.keys(d.colors).length > 0 && { colors: d.colors }),
    windows: d.windows.map((w): ViewWindowDoc => {
      const title = w.title ? { title: w.title } : {};
      if (w.kind === "values")
        return { kind: "values", ...title, mode: w.mode, signals: w.signals };
      return {
        kind: "timeseries",
        ...title,
        from: w.from,
        to: w.to,
        mode: w.mode,
        envelope: w.envelope,
        ...(w.height !== undefined && { height: w.height }),
        signals: w.signals,
      };
    }),
  };
}

/** Data refs of window and events-line signals, sorted, unique. */
function dataRefs(windows: { signals: string[] }[], eventSignals: string[] = []): string[] {
  const refs = [...windows.flatMap((w) => w.signals), ...eventSignals].map(
    (id) => parseSignalId(id)?.dataRef,
  );
  return [...new Set(refs.filter((r): r is string => r !== undefined))].sort();
}

const ComputedEntry = z.object({
  name: ComputedName,
  formula: z.string().max(MAX_FORMULA_LENGTH),
  a: ComputedInput,
  b: ComputedInput.optional(),
  unit: ComputedUnit.optional(),
});
const KNOWN_COMPUTED = ["name", "formula", "a", "b", "unit"];

/**
 * The valid computed entries (C6, C1; names unique ignoring case, at most MAX_COMPUTED); each
 * other one left out with the warning `computed signal "<name>" left out: <reason>`.
 */
function computedEntries(entries: readonly unknown[], warnings: string[]): ViewComputedDoc[] {
  const out: ViewComputedDoc[] = [];
  const names = new Set<string>();
  for (const [i, entry] of entries.entries()) {
    const label = isRecord(entry) && typeof entry.name === "string" ? entry.name : `#${i + 1}`;
    const leftOut = (reason: string) =>
      warnings.push(`computed signal "${label}" left out: ${reason}`);
    unknownKeys(entry, KNOWN_COMPUTED, `computed[${i}].`, warnings);
    const parsed = ComputedEntry.safeParse(entry);
    if (!parsed.success) {
      leftOut(
        parsed.error.issues.map((e) => `${e.path.join(".") || "entry"}: ${e.message}`).join("; "),
      );
      continue;
    }
    const c = parsed.data;
    const bound = bindFormula(parseFormula(c.formula), {
      a: c.a,
      ...(c.b !== undefined && { b: c.b }),
    });
    const name = c.name.toLowerCase();
    if (!bound.ok) leftOut(bound.message);
    else if (names.has(name)) leftOut("Name already used");
    else if (out.length >= MAX_COMPUTED) leftOut(`a view holds at most ${MAX_COMPUTED}`);
    else {
      names.add(name);
      out.push({
        name: c.name,
        formula: c.formula.trim(),
        a: bound.a,
        ...(bound.b !== undefined && { b: bound.b }),
        ...(c.unit ? { unit: c.unit } : {}),
      });
    }
  }
  return out;
}

/** Validates a parsed YAML/JSON value; upgrades older versions (none yet); unknown keys → warnings. */
export function parseViewDoc(data: unknown): ParsedView {
  const invalid = (message: string): ParsedView => ({ ok: false, code: "invalid_view", message });
  if (!isRecord(data) || data.kipscope !== "view") return invalid("not a KIPscope view");
  const version = data.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return invalid("version must be a positive integer");
  }
  if (version > VIEW_VERSION) {
    return {
      ok: false,
      code: "unsupported_version",
      message: `view version ${version}; this KIPscope reads ${VIEW_VERSION}`,
    };
  }
  // Later versions upgrade vN → vN+1 here; v1 has no step.
  const warnings: string[] = [];
  unknownKeys(data, KNOWN_TOP, "", warnings);
  for (const [key, known] of Object.entries(KNOWN_NESTED)) {
    unknownKeys(data[key], known, `${key}.`, warnings);
  }
  if (Array.isArray(data.windows)) {
    data.windows.forEach((w, i) => {
      const known = isRecord(w) && typeof w.kind === "string" ? KNOWN_WINDOW[w.kind] : undefined;
      if (known) unknownKeys(w, known, `windows[${i}].`, warnings);
    });
  }
  const parsed = ViewDocBody.safeParse(data);
  if (!parsed.success) {
    return invalid(
      parsed.error.issues.map((i) => `${i.path.join(".") || "view"}: ${i.message}`).join("; "),
    );
  }
  const v = parsed.data;
  const computed = computedEntries(v.computed ?? [], warnings);
  const doc = canonical({
    ...v,
    computed,
    kipscope: "view",
    version: VIEW_VERSION,
    data: v.data ?? dataRefs(v.windows, v.events?.signals),
  } as ViewDoc);
  return { ok: true, doc, warnings };
}

/** The open workspace as a document; IDs, nextId and lastZoomed are not part of it. */
export function workspaceToView(
  ws: Workspace,
  meta: { title: string; note?: string; saved?: string },
): ViewDoc {
  // A computed signal as `<dataRef>/=<name>`: a view holds no IDs (C10).
  const names = new Map((ws.computed ?? []).map((c) => [c.id, c.name]));
  const docId = (signalId: string) => {
    const ref = computedRef(signalId);
    const name = ref && names.get(ref.id);
    return ref && name !== undefined ? computedSignalId(ref.dataRef, name) : signalId;
  };
  const windows: ViewWindowDoc[] = ws.windows.map((w) => {
    const signals = w.signals.map((s) => docId(s.signalId));
    const title = w.title !== undefined ? { title: w.title } : {};
    if (!isTimeseries(w)) return { kind: "values", ...title, mode: w.mode, signals };
    return {
      kind: "timeseries",
      ...title,
      from: viewIso(BigInt(w.range.from)),
      to: viewIso(BigInt(w.range.to)),
      mode: w.display.mode,
      envelope: w.display.envelope,
      ...(w.height !== undefined && { height: w.height }),
      signals,
    };
  });
  // Colours of window signals in order of first appearance.
  const colors: Record<string, number> = {};
  for (const s of ws.windows.flatMap((w) => w.signals)) {
    const id = docId(s.signalId);
    const index = ws.colors[s.signalId];
    if (index !== undefined && !(id in colors)) colors[id] = index;
  }
  const iso = (t: string | undefined) => (t === undefined ? undefined : viewIso(BigInt(t)));
  const a = iso(ws.cursors.a);
  const b = iso(ws.cursors.b);
  return canonical({
    kipscope: "view",
    version: VIEW_VERSION,
    title: meta.title,
    ...(meta.note !== undefined && { note: meta.note }),
    ...(meta.saved !== undefined && { saved: meta.saved }),
    data: dataRefs(windows, ws.eventSignals),
    ...(ws.scope && {
      scope: {
        dataRef: ws.scope.dataRef,
        from: viewIso(BigInt(ws.scope.from)),
        to: viewIso(BigInt(ws.scope.to)),
      },
    }),
    linkTime: ws.linkTime,
    cursors: {
      ...(a !== undefined && { a }),
      ...(b !== undefined && { b }),
      diff: ws.cursors.diff,
    },
    digits: ws.options.digits,
    ...(ws.measurement && { measurement: ws.measurement }),
    events: {
      ...(ws.eventFilter !== undefined && { filter: ws.eventFilter }),
      ...(ws.eventSignals && { signals: ws.eventSignals }),
    },
    ...(ws.computed && {
      computed: ws.computed.map(({ id: _id, ...c }) => c),
    }),
    colors,
    windows,
  });
}

/**
 * The scope a view opens with (design Z8): `doc.scope` unpadded; else the data ref of the first
 * signal (timeseries windows first, then any window, then the events line) and the union of the
 * timeseries ranges and cursors, padded by `pad` on each side within the time bounds. Undefined
 * without a data ref or a time.
 */
export function viewScope(doc: ViewDoc, pad: bigint): WorkspaceScope | undefined {
  const ns = (iso: string) => fromIso(iso);
  if (doc.scope) {
    const { dataRef, from, to } = doc.scope;
    return { dataRef, from: ns(from).toString(), to: ns(to).toString() };
  }
  const firstRef = (ids: string[]) =>
    ids.map((id) => parseSignalId(id)?.dataRef).find((r) => r !== undefined);
  const dataRef =
    firstRef(
      doc.windows.find((w) => w.kind === "timeseries" && w.signals.length > 0)?.signals ?? [],
    ) ??
    firstRef(doc.windows.find((w) => w.signals.length > 0)?.signals ?? []) ??
    firstRef(doc.events?.signals ?? []);
  if (dataRef === undefined) return undefined;
  const spans: [bigint, bigint][] = doc.windows.flatMap((w) =>
    w.kind === "timeseries" ? [[ns(w.from), ns(w.to)] as [bigint, bigint]] : [],
  );
  for (const t of [doc.cursors.a, doc.cursors.b]) {
    if (t !== undefined) spans.push([ns(t), ns(t) + 1n]);
  }
  if (spans.length === 0) return undefined;
  let from = spans.reduce((m, [f]) => (f < m ? f : m), TIME_MAX) - pad;
  let to = spans.reduce((m, [, t]) => (t > m ? t : m), TIME_MIN) + pad;
  if (from < TIME_MIN) from = TIME_MIN;
  if (to > TIME_MAX) to = TIME_MAX;
  // A lone cursor without pad: keep the scope's minimum span.
  if (to - from < MIN_SPAN_NS) to = from + MIN_SPAN_NS;
  return { dataRef, from: from.toString(), to: to.toString() };
}

/**
 * A view as a layout for another data ref (add-case-open K8): signals of the view's data ref
 * (viewScope's) move to `toRef` by name, signals of any other data ref are left out with a
 * warning; the scope is dropped, since a catalog session gives it. Unchanged without a data ref.
 */
export function rebindView(doc: ViewDoc, toRef: string): { doc: ViewDoc; warnings: string[] } {
  const fromRef = viewScope(doc, 0n)?.dataRef;
  if (fromRef === undefined) return { doc, warnings: [] };
  const dropped = new Set<string>();
  const move = (id: string): string[] => {
    const ref = parseSignalId(id)?.dataRef;
    if (ref === fromRef) return [rebindSignalId(id, toRef)];
    if (ref === toRef) return [id];
    dropped.add(id);
    return [];
  };
  const unique = (ids: string[]) => [...new Set(ids.flatMap(move))];
  const windows = doc.windows.map((w) => ({ ...w, signals: unique(w.signals) }));
  const colors: Record<string, number> = {};
  for (const [id, index] of Object.entries(doc.colors ?? {})) {
    const [next] = move(id);
    if (next !== undefined && !(next in colors)) colors[next] = index;
  }
  const { scope: _scope, ...rest } = doc;
  const events = doc.events && {
    ...doc.events,
    ...(doc.events.signals && { signals: unique(doc.events.signals) }),
  };
  const next: ViewDoc = {
    ...rest,
    data: dataRefs(windows, events?.signals),
    ...(events && { events }),
    ...(doc.colors && { colors }),
    windows,
  };
  const warnings =
    dropped.size > 0
      ? [`signals of another data ref than ${fromRef} left out: ${[...dropped].sort().join(", ")}`]
      : [];
  return { doc: next, warnings };
}

/** File name from a title: NFKD, diacritics dropped, lower case, runs of other characters → "-", trimmed, ≤ 63; "" → "view". */
export function viewName(title: string): string {
  const name = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/, "");
  return name || "view";
}

/** base64url (no padding) of deflate-raw of the document's JSON; async (CompressionStream). */
export async function encodeViewLink(doc: ViewDoc): Promise<string> {
  return packCode(JSON.stringify(doc));
}

/** The document a link carries: title = view title ?? measurement name ?? "Shared view"; the open view's note when set; no `saved`. */
export function linkViewDoc(ws: Workspace): ViewDoc {
  const view = ws.view;
  return workspaceToView(ws, {
    title: view?.title ?? ws.measurement?.name ?? "Shared view",
    ...(view?.note !== undefined && { note: view.note }),
  });
}

/** The one link encoder of web "Copy link" and CLI `view link`: `<origin><path of page>#view=<code>`; the page's query and fragment are dropped. */
export async function viewLinkUrl(ws: Workspace, page: string): Promise<string> {
  const { origin, pathname } = new URL(page);
  return `${origin}${pathname}#view=${await encodeViewLink(linkViewDoc(ws))}`;
}

/** Inverse of encodeViewLink up to JSON.parse; rejects bad base64url, bad deflate and > MAX_VIEW_BYTES inflated. */
export async function decodeViewLink(code: string): Promise<unknown> {
  // Deflate never shrinks below ~1/1000, so a longer code cannot be a valid view.
  if (code.length > MAX_VIEW_BYTES) throw new SyntaxError("not a view link code");
  return JSON.parse(await unpackCode(code, MAX_VIEW_BYTES, "view link"));
}
