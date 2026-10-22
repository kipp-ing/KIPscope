# Design

## Context

See proposal.md for the why. Today (`apps/server/src/catalog.ts` `load`): the catalog loads the listed signals, the DBC metadata (`loadDbcFiles`, keyed `<message>.<signal>`) and the diagnostic catalogs (`loadDiagCatalogs`) in parallel; per listed name the DBC entry wins whole, else the diag field; SNA ranges are `value ± |factor| / 2` from the DBC (design S2 of `add-sna-handling`, D-012) and go to the adapter, which turns a stored value in a range into `null` (ADX: `iff(isSna, real(null), v_)` in `adx.ts`, closed ranges, physical values). The web reads the details from `info.dbc` (`labelTolerance`, `isSnaValue`, `valueLabels` in `packages/shared/src/states.ts`, `staticPeriod` in `gaps.ts`, `SignalCard.tsx`), and `formatSource` prints `<dataRef> · no DBC entry` when neither `dbc` nor `diag` exists.

D-099 (quoted): "KIPscope reads a third metadata source: plain metadata files keyed by the source (ADX) signal name, one entry per name (unit, description, value table, SNA values as physical values, optional range and cycle). KIPscope defines and documents the format; it does not parse ARXML and knows no aliases. The search tool writes the file from the metadata it already computes. A signal without any metadata reads `no metadata` instead of `no DBC entry`." Jan: "one ADX name never has different metadata in different variants." Consequence: "Per-name metadata stays global (no per-session or per-vehicle metadata)."

## Goals / Non-Goals

**Goals:** ADX signals get unit, description, value table, SNA, range and cycle from a file the search tool writes; the rest of KIPscope (SNA gaps, state names, shared axes, periods, hover card) uses them exactly as it uses DBC metadata; problems in the file never stop the server.

**Non-Goals:** see proposal ("Non-goals").

## Decisions

### F1: File format (version 1)

A UTF-8 JSON file (BOM allowed):

```json
{
  "kipscope": "signal-metadata",
  "version": 1,
  "signals": [
    {
      "name": "ICL_3A2h.SPEED_DISP",
      "unit": "km/h",
      "description": "Indicated speed",
      "factor": 1,
      "offset": 0,
      "min": 0,
      "max": 510,
      "cycleMs": 100,
      "message": "ICL_3A2h",
      "messageId": 930,
      "values": [{ "raw": 511, "label": "SNV" }],
      "sna": [{ "value": 511, "raw": 511 }]
    }
  ]
}
```

Top level: `kipscope` must be `"signal-metadata"`, `version` must be `1`, `signals` must be an array. Other top-level keys (e.g. `generatedAt`, `generator`) are ignored without warning: room for the writer's provenance.

Entry fields (only `name` is required; `null` counts as absent; absent stays absent):

| Field | Type and rule | Becomes |
|---|---|---|
| `name` | non-empty string; the signal's name as stored in the source (on ADX the raw ADX name), compared exactly | key |
| `unit` | string; trimmed, blank = absent | `SignalInfo.unit` |
| `description` | string; trimmed, blank = absent | `SignalInfo.description` |
| `factor` | finite number ≠ 0 | `meta.factor`; SNA and label tolerance (F3) |
| `offset` | finite number | `meta.offset` |
| `min`, `max` | finite numbers, physical; `min ≤ max` when both | `meta.min`, `meta.max` |
| `cycleMs` | finite number > 0 | `meta.cycleMs`, the signal's period (data-gaps) |
| `message` | non-empty string | `meta.message` (card) |
| `messageId` | integer 0 … 4294967295 (bit 31 = extended, as a DBC writes it) | `meta.messageId` (card) |
| `values` | array of `{raw, label, value?}`: `raw` a safe integer, unique in the entry; `label` a non-empty string; `value` a finite number, the physical value, default `raw`; empty array = absent | `meta.values`, sorted by `raw` |
| `sna` | array of `{value, raw?}`: `value` a finite number, the physical value as stored in the source; `raw` a non-negative safe integer, the raw code (shown on the card only); equal `value`s reported once; empty array = absent | `SignalInfo.sna`, sorted by `value`, `sources: ["metadata"]` |

There is no SNA label: a label for an SNA code goes into `values` (as a DBC's `VAL_ ... "SNV"` does); `valueLabels` already drops value-table entries whose raw or value is an SNA code (state names, D-059). No `alias`, `sender`, `dataRef` or variant field (D-099).

Why a list and not an object keyed by name: `JSON.parse` keeps the last of two equal keys without a trace; a list lets KIPscope see a name given twice and warn (F5). Why JSON: the case catalog and the view are JSON with the same `kipscope`/`version` header (handoff.md); the writer already speaks it.

**Numbers, if off by two:** the format has none of its own; `factor` is the writer's. A `factor` twice too large makes the tolerance a full raw step, so the valid neighbour of an SNA code is hidden too (closed ranges); half as large still covers float noise. That is today's DBC rule (D-012); the doc tells the writer to give the exact factor.

### F2: Configuration

`KIPSCOPE_METADATA_FILES`: comma list of paths, relative to the repo root, in priority order; default empty (no file). `Config.metadataFiles: string[]` (absolute paths, `pathList` as `KIPSCOPE_DBC_FILES`). A set path that is missing warns on every load (as a set DBC path); there is no default to skip. Documented in `docs/data-sources.md` (env table) and `.env.example` (the docs test "documents every source variable" checks both).

### F3: SNA tolerance

A metadata-file SNA value `v` becomes the SNA range `[v − t, v + t]` with `t = labelTolerance(info)` computed on the finished catalog entry: `|meta.factor| / 2` when the entry gives `factor`, else 0.5. The server's ranges and the web's `isSnaValue`/`stateLabel` then use one function and cannot disagree. This is "SNA compared as physical value" (D-012) with the physical value given instead of computed: the writer computes raw × factor + offset (two's complement for signed signals).

Without `factor`, 0.5 is right for integer-valued signals (raw step 1) and wrong for scaled ones (a 0.1 step would hide 5 valid values on each side). So an SNA value that is not an integer in an entry without `factor` keeps the entry and adds a warning (F5) — **lead to confirm with Jan** (Q2).

### F4: Shared types (`packages/shared/src/signals.ts`) — pinned

```ts
/** Where an SNA code is defined (D-010); "metadata": a metadata file (D-099). */
export type SnaSource = "GenSigSNA" | "VAL_" | "metadata";

export interface SnaValue {
  /** Raw code as unsigned bit pattern, e.g. 511 for "1FFh"; absent for a metadata-file value without `raw`. */
  raw?: number;
  /** Physical value as stored: raw (two's complement if signed) × factor + offset; as given in a metadata file. */
  value: number;
  /** Definitions naming this code; "GenSigSNA" before "VAL_"; ["metadata"] from a metadata file. Never empty. */
  sources: SnaSource[];
}

/** Message-level details of a signal, from a DBC (`dbc`) or a metadata file (`meta`). Absent fields stay absent. */
export interface SignalDetails {
  file?: string;
  message?: string;
  messageId?: number;
  factor?: number;
  offset?: number;
  min?: number;
  max?: number;
  values?: DbcValueLabel[];
  cycleMs?: number;
}

/** Details of a signal from a metadata file (D-099, design F1). */
export interface MetaInfo extends SignalDetails {
  /** Basename of the metadata file the entry came from (earlier file wins), e.g. `adx.metadata.json`. */
  file: string;
}

// SignalInfo gains:
  /** Absent when the signal has no metadata-file entry, or a DBC entry won (design F6). */
  meta?: MetaInfo;

/** `dbc`, else `meta`; a signal never has both (design F6). */
export function detailsOf(info: Pick<SignalInfo, "dbc" | "meta">): SignalDetails | undefined;
```

`DbcInfo` is unchanged (its `message`/`messageId` stay required; it is assignable to `SignalDetails`). The `SnaValue` comment "SNA codes sorted by raw ascending" on `SignalInfo.sna` becomes "sorted by raw ascending (DBC) or value ascending (metadata file)".

`packages/shared/src/states.ts`: `labelTolerance(info: Pick<SignalInfo, "dbc" | "meta">)` and `isSnaValue(info: Pick<SignalInfo, "dbc" | "meta" | "sna">, …)` read `detailsOf(info)?.factor`; `valueLabels` reads `detailsOf(info)?.values`. Behaviour for DBC signals unchanged (existing `states.test.ts` stays green).

`packages/shared/src/gaps.ts`: `PeriodSource = "dbc" | "metadata" | "diag" | "measured"`; `staticPeriod` returns `{source: "dbc"}` for `dbc.cycleMs`, `{source: "metadata"}` for `meta.cycleMs`, then diag as today.

HTTP payloads: `/api/signals` and `/api/catalog` items are `SignalInfo` (now with `meta`); `/api/gaps` `periods[*].source` may be `"metadata"`. No new route, no new parameter.

### F5: Reading and problems (`apps/server/src/metadata.ts`, new) — pinned

```ts
/** One metadata-file entry, ready for the catalog (design F1). */
export interface MetadataSignal {
  unit?: string;
  description?: string;
  meta: MetaInfo;
  /** Sorted by value, sources ["metadata"]; absent (never empty) when none. */
  sna?: SnaValue[];
}

/** Parses one file's text; `file` is the basename set as `meta.file`. Throws an Error whose message is the skip reason for an unusable file; reports entry problems through `warn` (one line per kind, below). */
export function parseMetadataFile(text: string, file: string, warn: (message: string) => void): Map<string, MetadataSignal>;

/** A loader over `paths` (priority order) with its own cache: a file whose mtimeMs and size did not change since its last read is not read or parsed again; its warnings are reported again. */
export function metadataLoader(paths: readonly string[]): (warn: (message: string) => void) => Promise<Map<string, MetadataSignal>>;
```

`Catalog` gains a seventh constructor parameter `loadFiles: (warn) => Promise<Map<string, MetadataSignal>> = async () => new Map()`, run in the same `Promise.all` as the other loaders; the catalog prefixes its warnings with `metadata file: `. `main.ts` builds one `metadataLoader(config.metadataFiles)` and passes it to the full and every scoped catalog, so the cache spans scopes.

Warnings, each once per load, after the prefix (`<path>` absolute as configured; at most 10 names per line, then nothing more):

| Problem | Warning | Effect |
|---|---|---|
| unreadable or missing | `<path> skipped: <error message>` | file skipped |
| not JSON | `<path> skipped: not JSON: <parser message>` | file skipped |
| wrong header | `<path> skipped: not a signal metadata file` (no `kipscope: "signal-metadata"`), `<path> skipped: version <v> not supported` (version ≠ 1), `<path> skipped: signals is not a list` | file skipped |
| bad entries | `<path>: <n> entries ignored: <name or #index>: <field>: <problem>, …` | those entries dropped whole |
| name twice in a file | `<path>: <n> names given twice, the first wins: <names>` | later entries dropped |
| name in an earlier file | `<path>: <n> signals already in an earlier metadata file, the earlier wins: <names>` | later file's entries dropped |
| unknown entry fields | `<path>: unknown fields ignored: <field> (<count>), …` | field ignored, entry kept |
| SNA without factor (F3) | `<path>: <n> SNA values without factor are compared within 0.5: <names>` | entry kept |

A bad entry is dropped whole rather than field by field: "first wins whole" elsewhere, and half an entry (unit without its SNA) would look complete. Entry problems are aggregated per file because a file of 10,000 entries with one systematic writer bug must not log 10,000 lines per load.

**File size, if off by two:** no limit. The size of an ADX file is not known yet (no data fact); at about 300 bytes per entry, 100,000 entries are 30 MB and roughly 0.3 s of `JSON.parse`. Without the cache every scoped load (each case step, D-078) would pay it; with it only a changed file does. Twice or half the size changes only the first load.

### F6: Precedence (`catalog.ts`)

Per listed name: DBC entry, else metadata-file entry, else diag field; the first wins whole (no field merging). A signal therefore has at most one of `dbc`, `meta`, `diag`. Warnings per load, names with data only, sorted, at most 10:

- `metadata file: <n> signals also in a DBC, the DBC wins: …`
- `diag catalog: <n> signals also in a DBC, the DBC wins: …` (unchanged text)
- `diag catalog: <n> signals also in a metadata file, the metadata file wins: …` (names not in a DBC)

DBC first: the SNA rules (D-010, D-014, D-015) exist only for DBC entries, and "Metadata source precedence" already puts the DBC first. Metadata files before diag catalogs: a file is written for the source's own names and carries SNA; a diag catalog never yields SNA. On today's deployments they do not meet (carserver configures no file; ADX has no diag catalog), so the order only matters for a collision — **lead to confirm with Jan** (Q1).

A metadata-file entry applies to its name under every data ref (D-099: one ADX name, one metadata, all variants). The group (`{sender}`) stays DBC-only: a metadata-file signal has no sender and falls through to the later group rules.

### F7: Hover card (`apps/web/src/explorer/format.ts`, `SignalCard.tsx`) — pinned

The card reads `const details = detailsOf(signal)` where it read `dbc`. New pure functions in `format.ts`, used by the card:

```ts
/** `ICL_3A2h · 0x3A2`; `ICL_3A2h` without ID; `0x3A2` without name; undefined without both (no Message line). */
export function formatMessage(details: SignalDetails | undefined): string | undefined;
/** `511 km/h (raw 1FFh)`; `8.19 k1/min` without raw (number-format, digits). */
export function formatSnaLine(sna: SnaValue, unit: string | undefined, digits: Digits): string;
```

`formatSource`: `dbc` → `<dataRef> · <file>` or `<dataRef> · DBC` (unchanged); else `meta` → `<dataRef> · <meta.file>`; else `diag` → unchanged; else `<dataRef> · no metadata`. Scaling, raw step, range and value lines read `details` with today's rules (a `[0|0]` range reads `not set`; the doc tells the writer to omit an unknown range).

### F8: Documentation for the writer

`docs/signal-metadata.md` (English, for the search tool's implementers): purpose, the F1 table, how KIPscope uses each field (SNA → gaps, values → state names, unit → axes, cycleMs → gap splitting), the tolerance rule (F3) with the advice to always give `factor` for scaled signals, precedence (F6), when the file is read (every catalog load; `POST /api/catalog/refresh` re-reads a changed file), the warnings (F5) and a link to `docs/signal-metadata.example.json`. The example holds three smart451 signals whose values the DBC scenarios already pin: `ICL_3A2h.SPEED_DISP` (as in F1), `BRK_1A0h.WSPD_FL` (unit `1/min`, factor 0.5, offset 0, max 8191, SNA value 8191.5 raw 16383, values `[{16383, SNV, 8191.5}]`) and `ENG_5E0h.T_ENG` (unit `°C`, factor 1, offset −40, min −40, max 214). Linked from `docs/handoff.md` (a short section "Signal metadata"), the README's metadata paragraph and `docs/data-sources.md`. `docs/http-api.md`'s refresh row reads "reload signals from the source and the metadata (DBC files, metadata files, diagnostic catalogs)".

### F9: Test fixture — pinned

`apps/server/test/fixtures/test-metadata.json` (tester), version 1, entries in this order:

| name | fields |
|---|---|
| `META.SPEED` | unit `km/h`, description `Indicated speed`, factor 1, offset 0, min 0, max 510, cycleMs 100, message `ICL_3A2h`, messageId 930, values `[{raw 511, label SNV}]`, sna `[{value 511, raw 511}]` |
| `META.WSPD` | unit `1/min`, factor 0.5, offset 0, sna `[{value 8191.5}]` |
| `META.MODE` | description `Drive mode`, values `[{raw 1, label on}, {raw 0, label off}]` (unsorted on purpose) |
| `META.TEMP` | unit `" °C "`, factor 1, offset −40, values `[{raw 0, label COLD, value -40}]` |
| `Fast_100h.SIG_C` | unit `rpm` (the test DBC defines it: DBC wins) |
| `TBMS.current` | unit `mA` (the test diag catalog defines it: the file wins) |

The top level also carries `"generator": "fixture"` (ignored). The fixture gives no warning of its own. Bad files and entries are inline texts or temp files in the tests.

Scenario evidence on real data uses `apps/server/test/fixtures/ui-metadata.json` (tester): one entry `BMS.soc` with unit `%`, description `State of charge (metadata file)`, min 0, max 100, cycleMs 30000, and the lead restarts the dev server with `KIPSCOPE_METADATA_FILES=apps/server/test/fixtures/ui-metadata.json` for the UI check, then without it.

## Risks / Trade-offs

- `SnaValue.raw` becomes optional: every reader must cope (card via `formatSnaLine`; `valueLabels` compares `s.raw === l.raw`, which is false for an absent raw and then falls back to `s.value === l.value`). Type checking finds the rest (`pnpm build`).
- `meta` next to `dbc` doubles the places that look for details; `detailsOf` is the one accessor, and the web never reads `meta` directly except `formatSource`.
- The mtime cache can miss a rewrite within the file system's timestamp resolution that keeps the size; the next change or a restart applies it. The search tool should write to a temp file and rename (documented).

## Open questions (lead to confirm with Jan)

- **Q1** Precedence DBC → metadata files → diag catalogs (F6). Recommendation: as written.
- **Q2** Without `factor`, SNA values are compared within 0.5, with a warning for a non-integer SNA value (F3). Alternative: exact match (tolerance 0) without `factor`, which can miss values with float noise. Recommendation: 0.5 with the warning.
- **Q3** A bad entry is dropped whole (F5) rather than keeping its good fields. Recommendation: whole.
