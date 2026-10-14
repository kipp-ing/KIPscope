# Design

## Context

See proposal.md for the why. Jan's rules, quoted:

- **D-010:** "A value the DBC marks as "signal not available" (SNA) must never be displayed, aggregated or evaluated as a valid measurement. SNA comes from the union of the `GenSigSNA` attribute (raw hex) and `VAL_` labels `SNA`/`SNV`; on conflict both count as SNA. `GenSigSNA "0h"` means "no SNA defined" unless a `VAL_` label marks 0 as SNA/SNV. Display: the curve breaks at SNA (never interpolated through), SNA periods are marked; aggregates exclude SNA and show its share."
- **D-012:** "SNA raw values from the DBC are converted with factor and offset (two's complement for signed signals) before comparing with stored values, since the decoder stores physical values (`scaling=True`)."
- **D-014:** "A `VAL_` label with a valid meaning (anything other than `SNA`/`SNV`) beats `GenSigSNA` for that raw value: the value is valid. This supersedes D-010's "on conflict both count as SNA". `GenSigSNA` does not apply to 1-bit signals and to checksum/CRC signals. SNA periods are marked as a thin strip per signal at the bottom of the plot, not as full-height shading. In aggregated views a bucket is marked as SNA from a single SNA point; mean/min/max contain valid points only."

Current code: `dbc.ts` reads only unit, comment and `VAL_`; `SignalInfo` has no SNA; `clickhouse.ts` returns every stored value; `RawSeries.v` and bucket `mean/min/max` are `number[]`; the chart joins tables with uPlot null mode 0 and `spanGaps: true`, so any null would be bridged today.

### Data facts (checked 2026-10-14)

DBCs from `config.ts` defaults: `../CarController/vehicles/smart451/dbc/h-can.dbc` (first) and `hybrid-can.dbc`.

| Fact | h-can.dbc | hybrid-can.dbc |
|---|---|---|
| `SG_` signals | 568 | 1036 |
| `GenSigSNA` entries | 447, all `"<hex>h"` | 475, all `"<hex>h"` |
| of which `"0h"` | 260 (237 without `VAL_`) | 0 |
| `VAL_` labels `SNV` / `SNA` | 120 / 33 (exact upper case) | 0 |
| `"0h"` signal with `VAL_` SNA/SNV on 0 | 0 | 0 |
| attribute ≠ label (union gives 2 codes) | 3 under D-010; 1 under D-014: `BS_328h.ESP_DSPL` {30, 31} (`CLU_TYPE` → {15}, `OC_P_Fast_SRS` → {0}) | 0 |
| signals with ≥ 1 SNA code: D-010 only / with D-014 | 187 / 171 | 475 / 475 |
| signed signals with SNA, `SIG_VALTYPE_`, multiplexed, negative `VAL_`, exponent in factor | none | none |

Examples: `COMBI_412h.V_ANZ` 9 bit (1,0), `"1FFh"` + `511 "SNV"` → 511 km/h. `BS_200h.DVL` 14 bit (0.5,0), `"3FFFh"` + `16383 "SNV"` → 8191.5 1/min. `MS_312h.DNMOT` 8 bit (1,−127), `"FFh"` → 128; data is constant −127 (raw 0, valid).

carserver `sdlog.signals`, vehicle `smart451`: 428 signals, 176 of them have SNA codes, 95 contain SNA values, 15 are 100 % SNA. All 95 (signal, code) pairs with hits match the physical SNA value exactly (no tolerance needed today). `COMBI_412h.V_ANZ`: 4,411 SNA of 51,498 points in 4 runs; `BS_200h.DVL`: 56 of 232,644 in 4 runs of 14. Window 2026-10-13T09:56:59Z–09:57:01Z: V_ANZ 20 points (3 SNA at .837/.937/09:57:00.037, else 0); DVL 61 points (14 SNA 09:56:59.791–09:57:00.052, next point 09:57:00.072, else 0). Highest valid values: V_ANZ 71, DVL 638.5.

## Goals / Non-Goals

**Goals:** pin every interface shared by `packages/shared`, `apps/server` and `apps/web` so server and web build in parallel; one place each for SNA derivation (`dbc.ts`), SNA matching (ClickHouse predicate) and SNA display (`build.ts`).

**Non-Goals:**
- Display of other value-table labels as states (proposal: later change).
- A switch to show SNA values anyway.
- SNA for float-typed signals (`SIG_VALTYPE_`); none exist in the DBCs.
- Changes to `GET /api/extent` (first/last timestamp still include SNA points) and to the raw-vs-buckets decision (the count still includes SNA points, since SNA points are returned).
- Detecting non-finite stored values (NaN); see Risks.

## Decisions

### S1: SNA derivation in the DBC parser

`parseDbc` additionally reads from each `SG_` line: bit length, sign (`+`/`-`), factor, offset (`SG_ <name> [mux] : <start>|<len>@<order><sign> (<factor>,<offset>)`), and every `BA_ "GenSigSNA" SG_ <id> <name> "<hex>h";`.

Per signal, the set of raw codes is the union of:
- `GenSigSNA` parsed as hex, **unless** it is 0 (`"0h"`, D-010) or empty (the `BA_DEF_DEF_` default `""`), or not matching `^[0-9A-Fa-f]+h$`, or ≥ 2^len (ignored), **or** (D-014) the signal has bit length 1, or its `SG_` name matches `/^CRC_|(^|_)CHKSUM(_|$)/i` (checksum/CRC), or its `VAL_` table labels that code with anything other than `SNA`/`SNV` **and** other than the fixed no-value list `--`, `NO_TEMP_SENSOR`, `RES` (D-015; trimmed, exact match; those labels keep the code SNA);
- every `VAL_` value whose label, trimmed, equals `SNA` or `SNV` (case-insensitive). A negative `VAL_` value is normalised to its unsigned bit pattern (`value mod 2^len`).

Raw → physical: `(signed && raw ≥ 2^(len−1) ? raw − 2^len : raw) × factor + offset`, using `BigInt` for the bit arithmetic, then `Number`. Codes are sorted by raw ascending; `sources` lists `"GenSigSNA"` before `"VAL_"`. A signal without codes gets no `sna` field. First-file-wins applies to the whole entry, SNA included (42 message names exist in both files; h-can wins).

*Alternative:* derive SNA in the catalog from parsed raw fields. Rejected: the parser already owns DBC semantics, and keeping factor/length out of `DbcSignal` keeps existing `toEqual` tests for signals without SNA valid.

### S2: Matching with half a raw step, in the database

A stored value is SNA if `value ∈ [phys − |factor|/2, phys + |factor|/2]` for one of its codes. The server builds these closed intervals (`SnaRange`) once per catalog load. Matching happens in ClickHouse so that aggregates exclude SNA at the source (no raw transfer).

*Factor of two:* a full step (×2) would swallow the neighbouring valid code (DVL 8191.0 would become SNA); a quarter step (÷2) still exceeds float error (~1e−12 relative) by far. Real data matches exactly (all 95 pairs), so the tolerance is a guard, not a dependency.

*Alternative:* exact equality. Rejected: the decoder's float result and ours may differ in the last bit for scaled signals with offsets (e.g. `YRG_151h.AX1`, factor 0.00012742, offset −4.1752).

### S3: ClickHouse query shape (pinned)

Predicate, with `{value}` the mapped value column and two parameters of equal length:

```sql
arrayExists((lo, hi) -> {value} >= lo AND {value} <= hi,
            {snaLo:Array(Float64)}, {snaHi:Array(Float64)})
```

When the signal has no ranges, the adapter uses the constant `0` instead and binds no SNA parameters. Call the expression `isSna` below.

- `raw`, `before`, `after`: `SELECT toString(toUnixTimestamp64Nano({time})), if(isSna, NULL, {value}) FROM …` (WHERE, ORDER BY, LIMIT unchanged). A null value means SNA.
- `buckets`:
  ```sql
  WITH isSna AS s
  SELECT toString(intDiv(toUnixTimestamp64Nano({time}), {w:Int64}) * {w:Int64}) AS b,
         countIf(NOT s), countIf(s),
         avgIfOrNull({value}, NOT s), minIfOrNull({value}, NOT s), maxIfOrNull({value}, NOT s)
  FROM {table} WHERE <signal filter> AND <time range>
  GROUP BY b ORDER BY toInt64(b)
  ```
  An all-SNA bucket returns `[b, 0, n, null, null, null]`.
- `count`, `extent`, `listSignals`: unchanged.

Checked on the test DB (ClickHouse 26.8.26) and carserver (26.8.23): the predicate, `-IfOrNull` returning null for all-SNA buckets, `if(…, NULL, value)` emitting `null` in `JSONCompactEachRow`, and array parameters such as `[8191.25,1e-7]`. Cost on the 7.2 M-row `Fast_100h.SIG_A` 10 h bucket query: 0.05 s → 0.08 s.

### S4: Shared types (pinned, `packages/shared/src`)

`signals.ts`:

```ts
/** Where an SNA code is defined (D-010). */
export type SnaSource = "GenSigSNA" | "VAL_";

/** One "signal not available" code of a signal (D-010, D-012). */
export interface SnaValue {
  /** Raw code as unsigned bit pattern, e.g. 511 for "1FFh". */
  raw: number;
  /** Physical value as stored: raw (two's complement if signed) × factor + offset. */
  value: number;
  /** Definitions naming this code; "GenSigSNA" before "VAL_". Never empty. */
  sources: SnaSource[];
}

export interface SignalInfo {
  // … existing fields unchanged …
  /** SNA codes sorted by raw ascending; absent (never empty) when none is defined. */
  sna?: SnaValue[];
}
```

`series.ts` (`null` means SNA and nothing else, everywhere):

```ts
export interface EdgePoint {
  t: string;
  /** null: the neighbor is an SNA point. */
  v: number | null;
}

export interface RawSeries {
  // … kind, signalId, from, to, t, before?, after? unchanged …
  /** One entry per timestamp in `t`; null where the point is SNA. */
  v: (number | null)[];
}

export interface BucketSeries {
  // … kind, signalId, from, to, width, t unchanged …
  /** Valid (non-SNA) points per bucket. */
  count: number[];
  /** SNA points per bucket. count[i] + sna[i] ≥ 1 (buckets without points are omitted). */
  sna: number[];
  /** Over valid points only; null exactly when count[i] === 0. */
  mean: (number | null)[];
  min: (number | null)[];
  max: (number | null)[];
}
```

Note the meaning change: `count` was "all points", it is now "valid points".

### S5: HTTP (pinned)

- `GET /api/signals`: items are `SignalInfo` with the optional `sna`. Example item: `{"id":"smart451/COMBI_412h.V_ANZ","dataRef":"smart451","name":"COMBI_412h.V_ANZ","unit":"km/h","description":"…","sna":[{"raw":511,"value":511,"sources":["GenSigSNA","VAL_"]}]}`.
- `GET /api/series`: payloads per S4. New error before any query when the catalog has never loaded: `503 {"error":{"code":"catalog_unavailable","message":…,"signalId":…,"from":…,"to":…}}`. All other errors unchanged.
- `GET /api/extent`: unchanged.

### S6: Server internals (pinned for server engineer and tester)

`apps/server/src/datasource.ts`:

```ts
/** Closed interval of stored values that mean SNA. */
export interface SnaRange { lo: number; hi: number }

/** A signal plus its SNA ranges, for value-returning queries. Empty `sna`: no SNA. */
export interface SeriesRef extends SignalRef { sna: readonly SnaRange[] }

export interface RawPoint { t: Timestamp; v: number | null }          // null: SNA
export interface Bucket {
  start: Timestamp;
  count: number;                 // valid points
  sna: number;                   // SNA points
  mean: number | null; min: number | null; max: number | null;   // null iff count === 0
}
// DataSource: raw, before, after, buckets take `SeriesRef`; listSignals, extent, count keep `SignalRef`.
```

`apps/server/src/dbc.ts`:

```ts
export interface DbcSna { values: SnaValue[]; /** |factor| / 2 */ tolerance: number }
export interface DbcSignal { unit?: string; description?: string; values?: Map<number, string>; sna?: DbcSna }
```

`apps/server/src/catalog.ts`: `SignalInfo.sna` is copied from `DbcSignal.sna.values`; new method `snaRanges(id: string): SnaRange[]` (`[]` for unknown signals or no SNA), built at refresh as `{lo: value − tolerance, hi: value + tolerance}`.

`apps/server/src/series.ts`: `querySeries(source, ref: SeriesRef, signalId, from, to, target, abort?)`; maps `RawPoint`/`Bucket` 1:1 onto S4. The route answers 503 if `catalog.loadedAt` is unset, else calls `querySeries` with `{...parseSignalId(id), sna: catalog.snaRanges(id)}`. `queue.ts` passes the new ref through unchanged.

### S7: Chart model and drawing (`apps/web/src/chart`)

Pure functions in `build.ts` (the tester tests these; signatures pinned):

```ts
export interface SignalPoints {
  xs: number[];
  ys: (number | null)[];          // null: SNA point or all-SNA bucket, edge neighbors included
  min?: (number | null)[];
  max?: (number | null)[];
}
export function toPoints(result: SeriesResult, origin: Timestamp): SignalPoints;

/** SNA periods as [start, end] x offsets, sorted and merged; end may equal start. */
export function snaPeriods(result: SeriesResult, origin: Timestamp): [number, number][];
/** SNA points / all points inside [from, to) (edge neighbors excluded); undefined if no points. */
export function snaShare(result: SeriesResult): number | undefined;
/** undefined for undefined or 0; "SNA < 0.1 %" for (0, 0.001); "SNA > 99.9 %" for (0.999, 1);
 *  "SNA 100 %" for 1; else `SNA ${(share * 100).toFixed(1)} %`. */
export function formatSnaShare(share: number | undefined): string | undefined;
/** Indices i in a joined column where ys[i] is a number, the nearest non-undefined entry on each
 *  side is null or missing, and at least one of them is null. */
export function isolatedPoints(ys: readonly (number | null | undefined)[]): number[];

export interface ChartModel {
  // … existing fields; tables now hold (number | null)[] columns …
  /** One lane per loaded signal, in input order. */
  sna: { color: string; periods: [number, number][] }[];
}
```

Rules:
- **Periods.** Raw: each SNA point (edge neighbors included) opens a period from its x to the x of the next point (in range or `after`); a last SNA point without successor gives `[x, x]`. Buckets: `[start, start + width]` (offsets) for each bucket with `sna > 0`. Touching periods merge.
- **Join and gaps.** `uPlot.join` with null mode 2 (`NULL_EXPAND`) for every y column, `spanGaps: false` on every series. Expansion turns alignment artifacts next to an SNA null into nulls, so a curve can never be bridged across SNA by another signal's timestamps; consecutive valid points still connect across artifacts (undefined).
- **Step hold.** For raw data in step mode, `buildModel` inserts for every valid point followed by an SNA point a hold point at the SNA point's x with the valid value, and moves that SNA null to x + 1 ns (skipped if the next point is at x + 1). With `stepped({align: 1})` and default `alignGaps`, the hold then ends exactly at the SNA timestamp.
- **y range.** `yRange` skips null and undefined.
- **Isolated points.** Line-path series (raw line mode, bucket means) get `points.filter` = `isolatedPoints(u.data[i])`; markers mode is unchanged (SNA nulls have no marker).
- **Marks.** A uPlot `draw` hook paints each lane as a 6 CSS px high strip at the bottom of the plot area, lane 0 lowest, in the signal's color at 60 % opacity, each period at least 2 CSS px wide. *Factor of two:* height 3–12 px and width 1–4 px are all visible and cosmetic.
- **Share.** The signal list shows `formatSnaShare(snaShare(result))` next to the status, for the result currently drawn.
- **Explorer.** A result with `sna` shows a line `SNA <values> <unit>` (values joined by `, `, number as `formatSnaValue(value)` = `String(Number(value.toPrecision(12)))`, which drops float noise such as `8191.500000000001`), title tooltip with raw hex, e.g. `raw 1FFh`. *Share thresholds (0.1 %):* chosen so DVL's 0.024 % reads `< 0.1 %` instead of `0.0 %`.

### S8: Test data (pinned for tester; engineers may use it)

`apps/server/test/fixtures/test-a.dbc` gains message `BO_ 2048 Sna_800h: 8 TEST`:

| Signal | `SG_` | `GenSigSNA` | `VAL_` | SNA physical |
|---|---|---|---|---|
| `SPEED` | `0\|9@1+ (1,0)` "km/h" | `"1FFh"` | `511 "SNV"` | 511 |
| `RPM` | `9\|14@1+ (0.5,0)` "1/min" | `"3FFFh"` | — | 8191.5 (±0.25) |
| `TEMP` | `23\|8@1- (1,0)` "degC" | `"80h"` | — | −128 |
| `COUNTER` | `31\|4@1+ (1,0)` | `"0h"` | — | none |
| `STATE` | `35\|2@1+ (1,0)` | `"0h"` | `0 "SNA" 1 "ON" 2 "OFF"` | 0 |
| `MODE` | `37\|3@1+ (1,0)` | `"7h"` | `6 "SNV" 1 "ON"` | 6 and 7 |
| `FLAG` | `40\|1@1+ (1,0)` | `"1h"` | — | none (1-bit, D-014) |
| `LEVEL` | `41\|3@1+ (1,0)` | `"1h"` | `1 "OK" 7 "SNV"` | 7 (label beats attribute, D-014) |
| `CRC_800h` | `48\|8@1+ (1,0)` | `"FFh"` | — | none (checksum, D-014) |

plus `BA_DEF_ SG_ "GenSigSNA" STRING ;` and `BA_DEF_DEF_ "GenSigSNA" "";`.

`FLAG`, `LEVEL` and `CRC_800h` exist only in the DBC (parser tests); they get no seeded series, so the seed counts below stay.

`apps/server/scripts/seed-test-db.ts`, vehicle `testcar`, start 2026-10-01T02:00:00Z, index `n`:

| Signal | Points | Spacing | Value |
|---|---|---|---|
| `Sna_800h.SPEED` | 1000 | 100 ms | 511 for n ∈ [300, 499] ∪ {600, 602, 999}; 42 for n = 601; else n % 100 → 203 SNA |
| `Sna_800h.RPM` | 100 | 1 s | 8191.0 for n = 50; 8191.500000001 for n = 51; 8191.5 for n % 10 = 9; else n × 10 → 11 SNA |
| `Sna_800h.TEMP` | 10 | 1 s | −128 for n % 5 = 0; else n × 10 − 40 → 2 SNA |
| `Sna_800h.COUNTER` | 16 | 1 s | n → 0 SNA (0 is valid) |
| `Sna_800h.STATE` | 10 | 1 s | n % 3 → 4 SNA |
| `Sna_800h.MODE` | 10 | 1 s | n % 8 → 2 SNA |

Seed spot checks change: total rows 21,613,857 (+1,146), distinct timestamped signals 1,013 (+6), `countIf(value = 511)` for `Sna_800h.SPEED` = 203. Useful ranges: SPEED buckets over 02:00:00–02:01:40 with target 10 (width ≈ 11.1 s, so at least one bucket lies fully inside the 20 s SNA run 02:00:30–02:00:49.9); SNA neighbors in [02:00:40.050, 02:00:40.051).

## Risks / Trade-offs

- [D-014's "anything other than `SNA`/`SNV`" would count `--`, `NO_TEMP_SENSOR` and `RES` as valid (`TPM_A1.TirePress_*`, `COMBI_408h.T_AUSSEN(_RAW)`, `AC_A1.T_SOLL`, `AC_A1.T_INNEN`, `MS_608h.FCOD_MOT` 63)] → resolved by D-015: these labels do not beat `GenSigSNA`; the list is fixed and grows only by decision.
- [`null` also results from NaN in JSON (`JSON.stringify(NaN)`)] → would be shown as SNA. None found in the checked signals; detecting NaN is out of scope.
- [Catalog not loaded → series 503] → previously series worked without catalog. In practice the explorer and `window.addSignal` already need the catalog; `POST /api/catalog/refresh` recovers.
- [Step hold inserts a drawing point at the SNA timestamp] → it repeats a measured value at the end of its own hold, which step mode draws anyway; covered by a unit test.
- [`count` changes meaning] → server and web ship together from one repo; the tester updates assertions that read `count` as all points.
- [Bucket marks are coarse: one SNA point marks the whole bucket] → decided by D-014; honest about where SNA occurs.

## Migration Plan

None for data. Server and web change the payload together (one repo, one deploy). Rollback: revert the change.

## Resolved by D-014

Jan answered the former open questions (2026-10-14); only the derivation in S1 changed, no interface or task boundary.

1. **Valid `VAL_` label vs. `GenSigSNA`:** the label wins. In h-can 16 signals lose their `GenSigSNA` code this way, 14 of them all SNA codes (e.g. `BS_208h.SZS` 1 `OK`, `SRS_1E1h.SRS_IL` 1 `ON`, `SAS_0C2h.LWS_Status` 3 `PER_ERR`); `YRG_156h.CLU_TYPE` keeps {15}, `SRS_1E1h.OC_P_Fast_SRS` keeps {0}. Not counted here: 1-bit signals with a label (`EPS_2F1h.EPS_KL`, `MS_308h.CREEPING_OFF`), exempt by rule 2 anyway.
2. **1-bit signals:** no `GenSigSNA` (7 in h-can: `BS_328h.BS`, `BS_300h.MPAR_ESP`, `GS_218h.MPAR_EGS`, `SRS_1E1h.PARITY_SRS`, `MS_608h.FCOD_MOT6`, `EPS_2F1h.EPS_KL`, `MS_308h.CREEPING_OFF`). **Checksum/CRC signals:** no `GenSigSNA`; detected by the `SG_` name pattern `/^CRC_|(^|_)CHKSUM(_|$)/i`. Checked with one grep over both DBCs (2026-10-14). Matches in h-can.dbc: `SAS_0C2h.LWS_CHKSUM` `"1h"`, `BS_119h.CRC_0`, `YRG_149h.CRC_1`, `YRG_151h.CRC_2`, `EWM_230h.CRC_230h` (all `"FFh"`), plus `YRG_156h.CRC_7` (`"0h"`) and `MS_212h.CRC_MS_212h` (no attribute), which have no SNA anyway. Matches in hybrid-can.dbc: 14 `CRC_*` signals (`CRC_EIS_A1`, `CRC_ENG_RQ_SBC`, `CRC_EM2_RS1`–`RS3`, `CRC_ENG_RQ2_TCM`, `CRC_HVAC_RS1`, `CRC_ENG_RS3_PT`, `CRC_EM2_RQ2_ENG`, `CRC_EM1_RQ_ENG`, `CRC_EM2_RQ_ENG`, `CRC_CVI`, `CRC_AVI2`, `CRC_EMM_STAT`), none with `GenSigSNA`. Not matched, by intent: `SSA_Enbl_Rq_CRCM`, `*_ErrChk_Stat*`, `V_MAX_SUM`, parity bits (1-bit rule covers them).
3. **Look of SNA marks:** thin strip per signal at the bottom of the plot (S7), as designed.
4. **Bucket marks:** a bucket is marked from a single SNA point (S7), as designed.

Effect on h-can: 187 → 171 signals with SNA codes (D-014 alone gave 161; D-015 keeps 10 of them, recounted with the real h-can.dbc); hybrid-can unchanged at 475. The carserver counts above (176 signals with SNA codes, 95 with hits) were measured under D-010 only.
