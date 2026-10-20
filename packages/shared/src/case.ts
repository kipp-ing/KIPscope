import { z } from "zod";
import { packCode, unpackCode } from "./encoding.ts";
import type { DiagEvent } from "./events.ts";
import { parseDuration } from "./localtime.ts";
import { parseSignalId } from "./signals.ts";
import { TIME_MAX, TIME_MIN } from "./time.ts";
import { MIN_SPAN_NS } from "./timenav.ts";
import {
  CaseAlign,
  type EventMatch,
  TimeInput,
  type TimeRange,
  VIEW_NAME,
  type WorkspaceScope,
} from "./workspace.ts";

export { CaseAlign, EventMatch } from "./workspace.ts";

export const CASES_KIND = "cases";
export const CASES_VERSION = 1;
/** Sessions per catalog (file, API, link). */
export const MAX_CASES = 2_000;
/** Characters of a `cases` string in a request body. */
export const MAX_CASES_TEXT = 4_000_000;
/** Bytes of the catalog JSON after inflating. */
export const MAX_CASES_JSON = 4_194_304;
/** Meta keys per session. */
export const MAX_CASE_META = 16;
/** KIPSCOPE_CASE_PAD default. */
export const DEFAULT_CASE_PAD = "60s";
/** 1 d. */
export const MAX_CASE_PAD_NS = 86_400_000_000_000n;
/** Rows the catalog list renders before "type to filter". */
export const CASE_LIST_ROWS = 500;
/** Request header; the only accepted value is "preload". */
export const CLASS_HEADER = "x-kipscope-class";
export const DAY_NS = 86_400_000_000_000n;
/** K11 */
export const WORK_HALF_MAX_NS = 15n * DAY_NS;
/** Route limit for a work window (K11). */
export const WORK_SPAN_MAX_NS = 32n * DAY_NS;

/** Object name as the finder sends it (a VIN): 1–128 characters, no control characters. */
export const CaseObject = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\p{Cc}]+$/u);
export const CaseMetaValue = z.union([
  z.string().max(200),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

/** One session as sent. Times as TimeInput accepts them (ISO UTC with Z or offset, or decimal ns). Unknown keys are ignored. */
export const CaseEntryInput = z.object({
  /** Opaque, shown and sent back unchanged. */
  id: z.string().min(1).max(256),
  object: CaseObject,
  /** Display only. */
  kind: z.string().min(1).max(32).optional(),
  from: TimeInput,
  /** to − from ≥ MIN_SPAN_NS. */
  to: TimeInput,
  /** Display only (for example a fleet number). */
  title: z.string().max(120).optional(),
  /** ≤ MAX_CASE_META keys, display only. */
  meta: z.record(z.string().min(1).max(64), CaseMetaValue).optional(),
  /** from ≤ anchor ≤ to. */
  anchor: TimeInput.optional(),
});

/** The catalog document (D-078 one command for link, file, CLI). Unknown keys are ignored. */
export const CasesDocument = z
  .object({
    kipscope: z.literal("cases"),
    version: z.literal(1),
    origin: z
      .object({
        tool: z.string().max(64).optional(),
        /** Kept only when its origin is in KIPSCOPE_FINDER_ORIGINS (K4). */
        url: z.string().max(2_048).optional(),
        set: z.string().max(256).optional(),
      })
      .optional(),
    /** Default 0; < cases.length. */
    current: z.number().int().min(0).optional(),
    /** CLI duration (parseDuration), 0 … 1 d; default KIPSCOPE_CASE_PAD. */
    pad: z.string().optional(),
    /** Default {mode: "start"}. */
    align: CaseAlign.optional(),
    view: z.union([z.string().regex(VIEW_NAME), z.record(z.string(), z.unknown())]).optional(),
    cases: z.array(CaseEntryInput).min(1).max(MAX_CASES),
  })
  .superRefine((doc, ctx) => {
    // K4 step 5: the checks across fields, each naming its path.
    for (const [i, c] of doc.cases.entries()) {
      const from = BigInt(c.from);
      const to = BigInt(c.to);
      if (to - from < MIN_SPAN_NS)
        ctx.addIssue({ code: "custom", path: ["cases", i, "to"], message: "must be after from" });
      if (c.anchor !== undefined && (BigInt(c.anchor) < from || BigInt(c.anchor) > to))
        ctx.addIssue({
          code: "custom",
          path: ["cases", i, "anchor"],
          message: "must lie in from … to",
        });
      if (c.meta && Object.keys(c.meta).length > MAX_CASE_META)
        ctx.addIssue({
          code: "custom",
          path: ["cases", i, "meta"],
          message: `at most ${MAX_CASE_META} keys`,
        });
    }
    if (doc.current !== undefined && doc.current >= doc.cases.length)
      ctx.addIssue({
        code: "custom",
        path: ["current"],
        message: `must be less than the ${doc.cases.length} sessions`,
      });
    if (doc.pad !== undefined) {
      let pad: bigint | undefined;
      try {
        pad = parseDuration(doc.pad);
      } catch (error) {
        ctx.addIssue({ code: "custom", path: ["pad"], message: (error as Error).message });
      }
      if (pad !== undefined && (pad < 0n || pad > MAX_CASE_PAD_NS))
        ctx.addIssue({ code: "custom", path: ["pad"], message: "must lie in 0 … 1 d" });
    }
  });
export type CasesDocument = z.infer<typeof CasesDocument>;

/** One session after the server normalised it. Decimal ns. */
export interface CaseEntry {
  id: string;
  object: string;
  /** caseDataRef(template, object) */
  dataRef: string;
  kind?: string;
  from: string;
  to: string;
  title?: string;
  meta?: Record<string, string | number | boolean | null>;
  anchor?: string;
}

/** GET /api/case. Immutable for one catalogId. */
export interface CaseCatalog {
  /** 10 × [a-z0-9], random at open. */
  catalogId: string;
  origin?: { tool?: string; url?: string; set?: string };
  entries: CaseEntry[];
}

/** Workspace.case: small, pushed with every state; the entries stay in GET /api/case (K6). */
export interface WorkspaceCase {
  catalogId: string;
  count: number;
  /** 0-based index of the session shown; while unlinked, of the session left. */
  current: number;
  linked: boolean;
  /** Decimal ns. */
  pad: string;
  align: CaseAlign;
  /** Decimal ns: the current session's alignment point (K7). */
  alignAt: string;
  /** Unlinked only: each timeseries window's range at Unlink as offsets from alignAt (decimal ns, may be negative). */
  linkedRanges?: Record<string, { from: string; to: string }>;
  /** The current entry, so the session bar draws without GET /api/case. */
  entry: CaseEntry;
}

/** GET /api/case/preview?index=N (K10, K13). */
export interface CasePreview {
  index: number;
  /** caseScope(entry, pad) */
  scope: WorkspaceScope;
  alignAt: string;
  alignFallback?: true;
}

/** Part of the answer of POST /api/workspaces with open.cases (K10). */
export interface CaseOpenReport {
  count: number;
  current: number;
  /** Unique, catalog order: what the grant was widened by. */
  dataRefs: string[];
  /** Signals of the layout the current session's list lacks. */
  missing: string[];
  alignFallback?: true;
  /** Dropped origin.url, signals of other data refs left out, … */
  warnings: string[];
}

export const OpenCasesRequest = z.strictObject({
  cases: z.union([z.string().min(1).max(MAX_CASES_TEXT), z.record(z.string(), z.unknown())]),
});
export type OpenCasesRequest = z.infer<typeof OpenCasesRequest>;

/** Data ref of an object: the template with every "{object}" replaced (K5). */
export function caseDataRef(template: string, object: string): string {
  return template.replaceAll("{object}", object);
}

const maxBig = (a: bigint, b: bigint) => (a > b ? a : b);
const minBig = (a: bigint, b: bigint) => (a < b ? a : b);

/** {dataRef, from − pad, to + pad}, clamped to TIME_MIN … TIME_MAX. */
export function caseScope(entry: CaseEntry, pad: bigint): WorkspaceScope {
  return {
    dataRef: entry.dataRef,
    from: maxBig(BigInt(entry.from) - pad, TIME_MIN).toString(),
    to: minBig(BigInt(entry.to) + pad, TIME_MAX).toString(),
  };
}

/**
 * The alignment point of a session (K7): start → from, end → to, anchor → anchor (else from with
 * fallback); event mode gives {from, fallback: true}, since the server resolves events (K9).
 */
export function alignPoint(entry: CaseEntry, align: CaseAlign): { t: string; fallback: boolean } {
  switch (align.mode) {
    case "start":
      return { t: entry.from, fallback: false };
    case "end":
      return { t: entry.to, fallback: false };
    case "anchor":
      return entry.anchor !== undefined
        ? { t: entry.anchor, fallback: false }
        : { t: entry.from, fallback: true };
    case "event":
      return { t: entry.from, fallback: true };
  }
}

/** What "Align to this event" stores; text only for category "change" (K7). */
export function eventMatchOf(event: DiagEvent): EventMatch {
  return {
    kind: event.kind,
    source: event.source,
    name: event.name,
    ...(event.category === "change" && { text: event.text }),
  };
}

/** kind, source and name equal; text equal only when the match has one. */
export function matchesEvent(event: DiagEvent, match: EventMatch): boolean {
  return (
    event.kind === match.kind &&
    event.source === match.source &&
    event.name === match.name &&
    (match.text === undefined || event.text === match.text)
  );
}

/** The earliest matching event with t in [scope.from, scope.to). */
export function firstMatch(
  events: readonly DiagEvent[],
  match: EventMatch,
  scope: WorkspaceScope,
): DiagEvent | undefined {
  const from = BigInt(scope.from);
  const to = BigInt(scope.to);
  let first: DiagEvent | undefined;
  for (const event of events) {
    const t = BigInt(event.t);
    if (t < from || t >= to || !matchesEvent(event, match)) continue;
    if (first === undefined || t < BigInt(first.t)) first = event;
  }
  return first;
}

/** "<ref>/<name>" → "<toRef>/<name>"; an ID without a data ref stays as it is. */
export function rebindSignalId(signalId: string, toRef: string): string {
  const parsed = parseSignalId(signalId);
  return parsed ? `${toRef}/${parsed.name}` : signalId;
}

const floorDay = (t: bigint) => {
  const r = t % DAY_NS;
  return r < 0n ? t - r - DAY_NS : t - r;
};
const ceilDay = (t: bigint) => {
  const f = floorDay(t);
  return f === t ? t : f + DAY_NS;
};

/**
 * The work window of a view in an object scope (K11): one view span (at least a day, at most
 * WORK_HALF_MAX_NS) on each side; wider than WORK_SPAN_MAX_NS − 2 d → that width centred on the
 * view; on whole UTC days; inside the scope.
 */
export function workWindow(view: TimeRange, scope: WorkspaceScope): TimeRange {
  const vFrom = BigInt(view.from);
  const vTo = BigInt(view.to);
  const half = minBig(maxBig(vTo - vFrom, DAY_NS), WORK_HALF_MAX_NS);
  let from = vFrom - half;
  let to = vTo + half;
  const widest = WORK_SPAN_MAX_NS - 2n * DAY_NS;
  if (to - from > widest) {
    from = (vFrom + vTo) / 2n - widest / 2n;
    to = from + widest;
  }
  from = maxBig(floorDay(from), BigInt(scope.from));
  to = minBig(ceilDay(to), BigInt(scope.to));
  return { from: from.toString(), to: to.toString() };
}

/** base64url of deflate-raw of the document's JSON, as encodeViewLink. */
export async function encodeCasesLink(doc: CasesDocument): Promise<string> {
  return packCode(JSON.stringify(doc));
}

/** Inverse of encodeCasesLink up to JSON.parse; throws on bad input; inflates at most MAX_CASES_JSON bytes. */
export async function decodeCasesLink(code: string): Promise<unknown> {
  if (code.length > MAX_CASES_TEXT) throw new SyntaxError("not a catalog link code");
  return JSON.parse(await unpackCode(code, MAX_CASES_JSON, "catalog link"));
}

/** A JWS compact form; base64url has no ".". */
export const isSignedCases = (text: string): boolean => text.split(".").length === 3;

export const casesLinkUrl = (origin: string, code: string) => `${origin}/open#cases=${code}`;

/** A checked catalog document (K4 step 5) with its defaults applied. */
export interface ParsedCases {
  ok: true;
  entries: CaseEntry[];
  current: number;
  pad: bigint;
  align: CaseAlign;
  view?: string | Record<string, unknown>;
  origin?: { tool?: string; url?: string; set?: string };
}

/** zod path → "cases[3].to". */
const pathText = (path: readonly PropertyKey[]): string =>
  path.reduce<string>(
    (text, key) =>
      typeof key === "number" ? `${text}[${key}]` : text ? `${text}.${String(key)}` : String(key),
    "",
  ) || "catalog";

const isValidDataRef = (ref: string) => ref.length > 0 && ref.length <= 128 && !ref.includes("/");

/**
 * Checks a catalog document (K4 step 5): CasesDocument (which checks current < cases.length, each
 * to − from ≥ MIN_SPAN_NS, from ≤ anchor ≤ to, ≤ MAX_CASE_META meta keys, pad a duration in
 * 0 … 1 d) plus each caseDataRef a valid data ref. Defaults: current 0, pad `defaultPad` (ns,
 * DEFAULT_CASE_PAD), align start. A failure is `invalid_catalog` naming the first bad path.
 */
export function parseCasesDocument(
  data: unknown,
  options: { template?: string; defaultPad?: bigint } = {},
): ParsedCases | { ok: false; code: "invalid_catalog"; message: string } {
  const invalid = (path: string, message: string) => ({
    ok: false as const,
    code: "invalid_catalog" as const,
    message: `${path}: ${message}`,
  });
  const parsed = CasesDocument.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return invalid(pathText(issue?.path ?? []), issue?.message ?? "invalid");
  }
  const doc = parsed.data;
  const template = options.template ?? "{object}";
  const entries: CaseEntry[] = [];
  for (const [i, c] of doc.cases.entries()) {
    const dataRef = caseDataRef(template, c.object);
    if (!isValidDataRef(dataRef))
      return invalid(`cases[${i}].object`, `data ref ${JSON.stringify(dataRef)} is not valid`);
    entries.push({
      id: c.id,
      object: c.object,
      dataRef,
      ...(c.kind !== undefined && { kind: c.kind }),
      from: c.from,
      to: c.to,
      ...(c.title !== undefined && { title: c.title }),
      ...(c.meta !== undefined && { meta: c.meta }),
      ...(c.anchor !== undefined && { anchor: c.anchor }),
    });
  }
  const origin = doc.origin && {
    ...(doc.origin.tool !== undefined && { tool: doc.origin.tool }),
    ...(doc.origin.url !== undefined && { url: doc.origin.url }),
    ...(doc.origin.set !== undefined && { set: doc.origin.set }),
  };
  return {
    ok: true,
    entries,
    current: doc.current ?? 0,
    pad:
      doc.pad === undefined
        ? (options.defaultPad ?? parseDuration(DEFAULT_CASE_PAD))
        : parseDuration(doc.pad),
    align: doc.align ?? { mode: "start" },
    ...(doc.view !== undefined && { view: doc.view }),
    ...(origin !== undefined && { origin }),
  };
}
