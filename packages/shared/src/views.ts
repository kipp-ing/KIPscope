import { z } from "zod";
import { parseSignalId } from "./signals.ts";
import { fromIso, toIso } from "./time.ts";
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

export interface ViewDoc {
  kipscope: "view";
  version: 1;
  title: string;
  note?: string;
  /** When it was saved, ISO-8601 UTC to the second; informational. */
  saved?: string;
  /** Data refs of all signals, sorted, unique; informational (V3). */
  data: string[];
  linkTime: boolean;
  /** ISO-8601 UTC. */
  cursors: { a?: string; b?: string; diff: boolean };
  digits: Digits;
  measurement?: Measurement;
  events?: { filter?: string; signals?: string[] };
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
  "linkTime",
  "cursors",
  "digits",
  "measurement",
  "events",
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
  const doc = canonical({
    ...v,
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
  const windows: ViewWindowDoc[] = ws.windows.map((w) => {
    const signals = w.signals.map((s) => s.signalId);
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
  for (const id of windows.flatMap((w) => w.signals)) {
    const index = ws.colors[id];
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
    colors,
    windows,
  });
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

/** Runs `bytes` through a (de)compression stream; rejects once the output exceeds `limit`. */
async function transform(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
  limit = Number.POSITIVE_INFINITY,
): Promise<Uint8Array> {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new RangeError(`view link inflates to more than ${limit} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** base64url (no padding) of deflate-raw of the document's JSON; async (CompressionStream). */
export async function encodeViewLink(doc: ViewDoc): Promise<string> {
  const packed = await transform(
    new TextEncoder().encode(JSON.stringify(doc)),
    new CompressionStream("deflate-raw"),
  );
  let binary = "";
  for (let i = 0; i < packed.length; i += 0x8000) {
    binary += String.fromCharCode(...packed.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
  if (!/^[A-Za-z0-9_-]+$/.test(code) || code.length % 4 === 1 || code.length > MAX_VIEW_BYTES) {
    throw new SyntaxError("not a view link code");
  }
  const binary = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const text = await transform(bytes, new DecompressionStream("deflate-raw"), MAX_VIEW_BYTES);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(text));
}
