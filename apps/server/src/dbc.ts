import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { SnaSource, SnaValue } from "@kipscope/shared";

/** SNA codes of a signal (D-010, D-012, D-014, D-015) with the matching tolerance. */
export interface DbcSna {
  values: SnaValue[];
  /** |factor| / 2: half a raw step (design S2). */
  tolerance: number;
}

/** Metadata for one `<message>.<signal>` key (design D6). Absent fields stay absent. */
export interface DbcSignal {
  /** Basename of the DBC file, when `parseDbc` was given one. */
  file?: string;
  /** `BO_` message name and ID (as written, decimal). */
  message: string;
  messageId: number;
  /** `BO_` transmitter; absent for `Vector__XXX` or none written (design G2). */
  sender?: string;
  /** Scaling and `[min|max]` from the `SG_` line; absent when the line does not parse. */
  factor?: number;
  offset?: number;
  min?: number;
  max?: number;
  unit?: string;
  description?: string;
  /** Value table (`VAL_`): raw value (as written) → label. */
  values?: Map<number, string>;
  /** Physical value of each `values` key (D-012, add-events N1); the raw value without a layout. */
  physical?: Map<number, number>;
  /** Absent when the signal has no SNA code. */
  sna?: DbcSna;
  /** `GenMsgCycleTime` of the message in ms (own value, else the file's default); absent for 0 (D-062). */
  cycleMs?: number;
}

/** Bit layout and scaling of an `SG_` line, needed to derive SNA. */
interface Layout {
  length: number;
  signed: boolean;
  factor: number;
  offset: number;
}

const MESSAGE = /^BO_\s+(\d+)\s+(\w+)\s*:(?:\s*\d+\s+(\w+))?/;
const SIGNAL = /^\s*SG_\s+(\w+)\s*(?:[mM]\w*\s*)?:[^"]*"([^"]*)"/;
const NUMBER = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const LAYOUT = new RegExp(
  String.raw`:\s*\d+\s*\|\s*(\d+)\s*@\s*[01]\s*([+-])\s*\(\s*(${NUMBER})\s*,\s*(${NUMBER})\s*\)` +
    String.raw`(?:\s*\[\s*(${NUMBER})\s*\|\s*(${NUMBER})\s*\])?`,
);
const GEN_SIG_SNA = /BA_\s+"GenSigSNA"\s+SG_\s+(\d+)\s+(\w+)\s+"([^"]*)"\s*;/g;
const COMMENT = /CM_\s+SG_\s+(\d+)\s+(\w+)\s+"((?:[^"\\]|\\.)*)"\s*;/g;
const VALUES = /VAL_\s+(\d+)\s+(\w+)((?:\s+-?\d+\s+"(?:[^"\\]|\\.)*")*)\s*;/g;
const VALUE_PAIR = /(-?\d+)\s+"((?:[^"\\]|\\.)*)"/g;
/** The closing quote keeps `GenMsgCycleTimeActive` out (design G3). */
const CYCLE_TIME = /BA_\s+"GenMsgCycleTime"\s+BO_\s+(\d+)\s+(\d+)\s*;/g;
const CYCLE_TIME_DEFAULT = /BA_DEF_DEF_\s+"GenMsgCycleTime"\s+(\d+)\s*;/;

const unquote = (s: string) => s.replace(/\\(.)/g, "$1");
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

const HEX_CODE = /^([0-9A-Fa-f]+)h$/;
/** Checksum/CRC signals: `GenSigSNA` does not apply (D-014). */
const CHECKSUM = /^CRC_|(^|_)CHKSUM(_|$)/i;
/** `VAL_` labels that mean SNA (D-010). */
const SNA_LABEL = /^(SNA|SNV)$/i;
/** `VAL_` labels meaning "no value": they do not beat `GenSigSNA` (D-015). Exact match. */
const NO_VALUE_LABELS = new Set(["--", "NO_TEMP_SENSOR", "RES"]);

/**
 * SNA codes per design S1: the union of `GenSigSNA` (with the D-010/D-014/D-015 exemptions)
 * and `VAL_` labels `SNA`/`SNV`, converted to physical values (D-012).
 */
/** Written raw value → unsigned raw code of the signal's bit length. */
function unsignedOf(layout: Layout): (value: number) => bigint {
  const span = 1n << BigInt(layout.length);
  return (value) => ((BigInt(value) % span) + span) % span;
}

/** Unsigned raw code → physical value: two's complement if signed, then × factor + offset (D-012). */
function physicalOf(layout: Layout): (raw: bigint) => number {
  const span = 1n << BigInt(layout.length);
  const half = span >> 1n;
  return (raw) =>
    Number(layout.signed && raw >= half ? raw - span : raw) * layout.factor + layout.offset;
}

function deriveSna(
  name: string,
  layout: Layout,
  attribute: string | undefined,
  values: Map<number, string> | undefined,
): DbcSna | undefined {
  const span = 1n << BigInt(layout.length);
  const unsigned = unsignedOf(layout);
  const labels = new Map<bigint, string>();
  for (const [value, label] of values ?? []) labels.set(unsigned(value), label.trim());

  const codes = new Map<bigint, SnaSource[]>();
  const add = (raw: bigint, source: SnaSource) => {
    const sources = codes.get(raw) ?? [];
    if (!sources.includes(source)) sources.push(source);
    codes.set(raw, sources);
  };

  const hex = attribute === undefined ? undefined : HEX_CODE.exec(attribute)?.[1];
  if (hex !== undefined && layout.length > 1 && !CHECKSUM.test(name)) {
    const raw = BigInt(`0x${hex}`);
    const label = labels.get(raw);
    const labelValid = label !== undefined && !SNA_LABEL.test(label) && !NO_VALUE_LABELS.has(label);
    if (raw !== 0n && raw < span && !labelValid) add(raw, "GenSigSNA");
  }
  for (const [raw, label] of labels) {
    if (SNA_LABEL.test(label)) add(raw, "VAL_");
  }
  if (codes.size === 0) return undefined;

  const physical = physicalOf(layout);
  const sorted = [...codes].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    values: sorted.map(([raw, sources]) => ({
      raw: Number(raw),
      value: physical(raw),
      sources: sources.sort((a, b) => (a === b ? 0 : a === "GenSigSNA" ? -1 : 1)),
    })),
    tolerance: Math.abs(layout.factor) / 2,
  };
}

/**
 * Parses DBC text (already decoded) into metadata keyed by `<message>.<signal>`; `file` (a
 * basename) is set on every entry when given.
 */
export function parseDbc(text: string, file?: string): Map<string, DbcSignal> {
  const result = new Map<string, DbcSignal>();
  const messages = new Map<string, string>();
  const layouts = new Map<string, Layout>();
  let message: { name: string; id: number; sender: string | undefined } | undefined;

  for (const line of text.split(/\r?\n/)) {
    const bo = MESSAGE.exec(line);
    if (bo) {
      const [, id = "", name = "", sender] = bo;
      messages.set(id, name);
      message = { name, id: Number(id), sender: sender === "Vector__XXX" ? undefined : sender };
      continue;
    }
    const sg = SIGNAL.exec(line);
    if (sg && message) {
      const [, name = "", unit = ""] = sg;
      const key = `${message.name}.${name}`;
      const entry: DbcSignal = { message: message.name, messageId: message.id };
      if (message.sender !== undefined) entry.sender = message.sender;
      if (file !== undefined) entry.file = file;
      const layout = LAYOUT.exec(line);
      if (layout) {
        const [, length = "", sign = "", factor = "", offset = "", min, max] = layout;
        entry.factor = Number(factor);
        entry.offset = Number(offset);
        if (min !== undefined && max !== undefined) {
          entry.min = Number(min);
          entry.max = Number(max);
        }
        layouts.set(key, {
          length: Number(length),
          signed: sign === "-",
          factor: entry.factor,
          offset: entry.offset,
        });
      }
      if (unit.trim()) entry.unit = unit.trim();
      result.set(key, entry);
      continue;
    }
    if (line.trim() === "") message = undefined;
  }

  const keyFor = (id: string, name: string) => {
    const msg = messages.get(id);
    return msg === undefined ? undefined : `${msg}.${name}`;
  };
  const entryFor = (id: string, name: string) => {
    const key = keyFor(id, name);
    return key === undefined ? undefined : result.get(key);
  };

  for (const [, id = "", name = "", raw = ""] of text.matchAll(COMMENT)) {
    const entry = entryFor(id, name);
    const description = collapse(unquote(raw));
    if (entry && description) entry.description = description;
  }

  for (const [, id = "", name = "", pairs = ""] of text.matchAll(VALUES)) {
    const entry = entryFor(id, name);
    if (!entry) continue;
    const values = new Map<number, string>();
    for (const [, value = "", label = ""] of pairs.matchAll(VALUE_PAIR)) {
      values.set(Number(value), unquote(label));
    }
    entry.values = values;
  }

  const cycles = new Map<number, number>();
  for (const [, id = "", ms = ""] of text.matchAll(CYCLE_TIME)) cycles.set(Number(id), Number(ms));
  const cycleDefault = Number(CYCLE_TIME_DEFAULT.exec(text)?.[1] ?? 0);
  for (const entry of result.values()) {
    const cycle = cycles.get(entry.messageId) ?? cycleDefault;
    if (cycle > 0) entry.cycleMs = cycle;
  }

  const attributes = new Map<string, string>();
  for (const [, id = "", name = "", value = ""] of text.matchAll(GEN_SIG_SNA)) {
    const key = keyFor(id, name);
    if (key !== undefined) attributes.set(key, value);
  }
  for (const [key, entry] of result) {
    const layout = layouts.get(key);
    if (entry.values) {
      const values = [...entry.values.keys()];
      const toPhysical =
        layout && layout.length >= 1
          ? (v: number) => physicalOf(layout)(unsignedOf(layout)(v))
          : (v: number) => v;
      entry.physical = new Map(values.map((v) => [v, toPhysical(v)]));
    }
    if (!layout || layout.length < 1) continue;
    const name = key.slice(key.indexOf(".") + 1);
    const sna = deriveSna(name, layout, attributes.get(key), entry.values);
    if (sna) entry.sna = sna;
  }
  return result;
}

/**
 * Loads DBC files (ISO-8859-1) in priority order; for keys defined in several files the first
 * file wins. Unreadable files are reported via `onError` and skipped: missing metadata never
 * blocks data display.
 */
export async function loadDbcFiles(
  paths: readonly string[],
  onError: (path: string, error: unknown) => void = () => {},
): Promise<Map<string, DbcSignal>> {
  const merged = new Map<string, DbcSignal>();
  const decoder = new TextDecoder("latin1");
  for (const path of paths) {
    let parsed: Map<string, DbcSignal>;
    try {
      parsed = parseDbc(decoder.decode(await readFile(path)), basename(path));
    } catch (error) {
      onError(path, error);
      continue;
    }
    for (const [key, entry] of parsed) {
      if (!merged.has(key)) merged.set(key, entry);
    }
  }
  return merged;
}
