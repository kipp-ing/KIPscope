# Design

## Context

See proposal.md (Why). Facts that shape the approach:

- **Metadata today:** `loadDbcFiles(config.dbcFiles)` (`apps/server/src/dbc.ts`) returns `Map<"<message>.<signal>", DbcSignal>`; `Catalog.load()` (`catalog.ts`) looks each source name up and copies `description`, `unit`, `dbc`, `sna`. `config.ts` resolves `KIPSCOPE_DBC_FILES` (comma list, relative to the repo root, default the two smart451 DBCs). `main.ts` passes `(warn) => loadDbcFiles(…)` to `new Catalog(source, loadMetadata, rules, log)`; 30 tests construct `Catalog` with two arguments.
- **Units drive axes and the unit limit:** `layoutAxes` (`apps/web/src/chart/axes.ts`) keys a scale `u:<unit>` or, without unit, `s:<signal>`; `windowUnits` (`packages/shared/src/workspace.ts`) counts units the same way for `MAX_UNITS = 4`. A unit on `SignalInfo` is all the web needs.
- **Manifest** (`uds-catalog-manifest/1`, 254 KB): `ecu.name` `BMS`; 28 `groups[]` with `name`, `did`, `services[]`, `fields[]`; a field has `name`, `unit` (66 of 100 blank), `enum`, `ascii`, `hexdump`, `scales[]` (`low`, `high`, `factor`, `offset`, `text`, `invalid`), and for the 2 arrays `element_count` 200. Units: V 11, °C 7, % 5, As 5, s 3, A 1, kOhm 1, km 1 fields.
- **Names file** (`bms-live.names.toml`, 49 entries under `[fields]`): keys a field name or `"0x0208/PRES_Cell_Voltage_Div_1024_2Byte"`; the decoder (ESPCars `script/sdlog_uds.py`, `_resolve_field`/`_names`) resolves `<service>` as a DID (`0[xX][0-9A-Fa-f]{1,4}`) or a group or service name, rejects ambiguous keys, bad names, names given twice and fields named twice, and pads array indices to `len(str(repeat_count))`.
- **Data** (carserver, read-only): 125 `BMS.*` signals, all matched by the rule (checked by script against `/api/signals`): 93 `BMS.cell_voltage.001`–`.093`, 116 with unit (`V` 103, `°C` 7, `%` 4, `A` 1, `kOhm` 1), 7 enums (`contactor`, `clamp15`, `voltage_state`, 4 `isolation_*`), 2 text (`vin`, `hardware_part_number`). Enum rows store `value` 0 and the state in `text` (`BMS.contactor` 0 `closed` ×267, 0 `open` ×108); every enum text row has factor 0, offset 0. No stored row carries an invalid text (0 of 494,084), no NaN without text; 48 rows `BMS.current` = 0.
- **No TOML parser** in the workspace (`pnpm-lock.yaml`); the server has `yaml` and `zod`.
- **No DBC message is named `BMS`** in either smart451 DBC, so no name is defined twice today.

## Goals / Non-Goals

**Goals:** the scenarios of the delta spec with the smallest addition: one server module, one config key, one optional field on `SignalInfo`, no web code; every shared interface pinned below so shared, server and tests build in one round; `add-events` can read `diag` without waiting for this change's implementation.

**Non-Goals:** using `diag` anywhere in the UI or CLI; SNA matching for diag signals; descriptions; reading `.dcat`; per-data-ref metadata.

## Decisions

### M1: Shared types (pinned, `packages/shared/src/signals.ts`)

```ts
/** One scale row of a diagnostic catalog field (raw bounds inclusive), D-061. */
export interface DiagScaleRow {
  low: number;
  high: number;
  text: string;
}

/** Diagnostic catalog metadata of a signal (D-061, design M1). */
export interface DiagInfo {
  /** Basename of the manifest, e.g. `bms-live.manifest.json`. */
  file: string;
  /** `ecu.name`, the signal's prefix, e.g. `BMS`. */
  ecu: string;
  /** Group (canonical name) and its DID, e.g. `DT_Contactor_Contactor_State`, 53248. */
  group: string;
  did: number;
  /** Field name in the catalog, e.g. `PRES_Contactor_State`. */
  field: string;
  /** Array fields only: 1-based element, as in the name suffix. */
  element?: number;
  /** `enum` field; `text` for ASCII or hexdump (value NaN, text in the row); else `number`. */
  kind: "number" | "enum" | "text";
  /**
   * Enum fields: the valid rows with a text, table order; absent when none. The decoder stores
   * value 0 for these rows (factor 0) and the state in the row's text: match by text, not value.
   */
  states?: DiagScaleRow[];
  /** Rows marked invalid, table order; absent when none. Never stored (the decoder drops them), not SNA codes. */
  invalid?: DiagScaleRow[];
}

export interface SignalInfo {
  // … existing fields …
  /** Absent when the signal has no diagnostic catalog field, or a DBC entry won (design M5). */
  diag?: DiagInfo;
}
```

`unit` keeps its meaning; for a diag signal it is the field's `unit`, trimmed, absent when blank. `GET /api/catalog` and `/api/signals` carry `diag` through `SignalInfo`; nothing else in the payloads changes. `add-events` reads `diag.kind` / `diag.states` (its design N1).

### M2: Config (pinned, `apps/server/src/config.ts`)

`Config.diagCatalogs: string[]`: absolute manifest paths in priority order. `KIPSCOPE_DIAG_CATALOGS` is a comma list, trimmed, blanks dropped, relative paths against the repo root, exactly as `KIPSCOPE_DBC_FILES`; unset or empty → `DEFAULT_DIAG_CATALOGS = ["../CarController/vehicles/smart451/uds/bms-live.manifest.json"]`. `.env.example` gets the commented line next to `KIPSCOPE_DBC_FILES`. The names file is derived, not configured: the path with its trailing `.manifest.json` replaced by `.names.toml` (a path not ending in `.manifest.json` → `<path>.names.toml`).

Why env and not `kipscope.yaml`: the DBC paths, the other metadata source, live there (D-011 D6), and the decoder pairs manifest and names file by place as well. Alternative: a `metadata:` block in `kipscope.yaml` with both lists; rejected for now, since it would move the DBC config too and needs a project-file schema change.

### M3: Reading a catalog (pinned, new `apps/server/src/diag.ts`)

```ts
/** Metadata for one signal name from a diagnostic catalog (design M3). */
export interface DiagSignal {
  unit?: string;
  diag: DiagInfo;
}

/** One manifest with its names file text (undefined: no names file). Problems go to `warn`. */
export function parseDiagCatalog(
  manifestText: string,
  namesText: string | undefined,
  file: string,                      // manifest basename, for DiagInfo.file
  warn: (message: string) => void,
  namesPath?: string,                // for warning texts
): Map<string, DiagSignal>;          // throws on a manifest that fails M3's shape check

/** Reads the manifests in order; never rejects. First catalog wins per name (M5). */
export function loadDiagCatalogs(
  paths: readonly string[],
  warn: (message: string) => void,
): Promise<Map<string, DiagSignal>>;
```

Manifest shape, checked with zod (`passthrough`, only these keys): `format === "uds-catalog-manifest/1"`; `ecu.name` non-empty string; `groups[]` of `{ name: string; did: number; services?: string[]; fields: Field[] }`; `Field = { name: string; unit?: string; enum?: boolean; ascii?: boolean; hexdump?: boolean; element_count?: number; scales?: { low: number; high: number; text?: string; invalid?: boolean }[] }`. A failed check throws (`loadDiagCatalogs` turns it into "skipped"). Manifests are UTF-8 (`°C`), names files UTF-8, parsed with `smol-toml`; only the `[fields]` table is read (other top-level keys: ignored).

Names (decoder §7.2, `_resolve_field`): for each `[fields]` entry in file order, key `k`, value `v`:
1. `v` must match `^[A-Za-z][A-Za-z0-9_]*$`, else "not a name".
2. Split `k` at its last `/`. With a service part: `0[xX][0-9A-Fa-f]{1,4}` → the first group with that `did`; else the first group whose `name` equals it or whose `services` contain it; none → "no group"; then the field of that name in that group, none → "no such field in <group>". Without: all fields of that name in all groups; none → "no such field"; more than one → "ambiguous, write <service>/<field> (groups: …)".
3. `v` already given → "name already given"; field already named → "field already named".
Each problem: `warn(\`${namesPath}: ${k}: ${problem}; entry ignored\`)`, entry skipped. Then per group and field in manifest order: `base = named ? \`${ecu}.${v}\` : \`${ecu}.${group.name}.${field.name}\``; `element_count > 1` → names `${base}.${String(n).padStart(String(count).length, "0")}` for n = 1…count, each with `element: n`; else `base`. A name produced twice within one manifest: the first wins, one warning `two fields end up as signal <name>`.

Row lists: `states` = rows with `!invalid && text` (non-blank) when `field.enum`; `invalid` = rows with `invalid`, any kind; each mapped to `{low, high, text}` (`text ?? ""`); empty → absent. `kind`: `enum` if `field.enum`, else `text` if `ascii || hexdump`, else `number`. No factor, offset or physical values are carried: no consumer needs them, and enum rows' physical value is 0 for every state.

`loadDiagCatalogs`, per path in order: read the manifest (error → `warn(\`${path} skipped: ${error}\`)`, next); read the names file (ENOENT or other error → `warn(\`${namesPath}: ${error}; fields keep their catalog names\`)`, parse with `namesText` undefined; a TOML syntax error is reported the same way); parse (throw → "skipped"). The names-file warning and the per-entry warnings of `parseDiagCatalog` are held back and logged only once the manifest has parsed, so a skipped manifest yields exactly one warning (its "skipped"); this is what makes the scenario "Missing names file, broken manifest" count exactly four. Merge into the result: names already present stay; if any were, one `warn(\`${path}: ${n} signals already named by an earlier catalog, the earlier wins: ${first 10}\`)`.

### M4: Catalog (pinned, `apps/server/src/catalog.ts`, `main.ts`)

```ts
type LoadDiag = (warn: (message: string) => void) => Promise<Map<string, DiagSignal>>;

constructor(
  source: DataSource,
  loadMetadata: LoadMetadata,
  rules: DisplayRules = NO_RULES,
  log?: CatalogLog,
  loadDiag: LoadDiag = async () => new Map(),
)
```

`load()` runs `listSignals()`, `loadMetadata(warnDbc)` and `loadDiag(warnDiag)` in one `Promise.all`, where `warnDiag = (m) => this.log?.warn(\`diag catalog: ${m}\`)`. Per entry: a DBC entry → as today, and the name goes to a `both` set if the diag map has it too; else a diag entry → `if (d.unit) info.unit = d.unit; info.diag = d.diag;` (no `description`, no `sna`, no SNA ranges). After the entries: if `both` is not empty, `warnDiag(\`${both.size} signals also in a DBC, the DBC wins: ${first 10, sorted}\`)`. Group rules see no new field (`sender` stays DBC-only), so `BMS (diag)` grouping is unchanged. `main.ts` passes `(warn) => loadDiagCatalogs(config.diagCatalogs, warn)` as the fifth argument. Warnings follow the load like the DBC ones (once per load, never accumulated).

### M5: Precedence

DBC files first, then diag catalogs in list order; the first source wins the whole entry. Why: DBC entries carry Jan's SNA rules (D-010, D-014, D-015), diag entries none, and today no name is in both. A merged entry (DBC unit, diag states) was rejected: two half-sources per signal, and no case needs it.

### M6: Test fixture (pinned, `apps/server/test/fixtures/`)

`test-diag.manifest.json` (only the keys M3 reads, plus `format`):

| group | did | field | kind | unit | scales (low–high text, ⊘ = invalid) |
|---|---|---|---|---|---|
| `DT_Cell` (services `["DT_Cell_Voltage_Cell"]`) | 520 (0x0208) | `PRES_Cell_2Byte`, `element_count` 12 | number | `V` | 0–65534 factor 0.001; 65535 `Signal not available` ⊘ |
| `DT_Pack` | 516 (0x0204) | `DT_Pack_Current` | number | `A` | −19200–19200; −32768 `SNA` ⊘ |
| | | `PRES_Temp_2Byte` | number | `" °C "` | −2560–5760 |
| | | `PRES_Flag` | number | `""` | 0–1 |
| `DT_Contactor` | 53248 (0xD000) | `PRES_Contactor_State`, `enum` | enum | `""` | 0 `open`, 1 `precharge`, 2 `closed`, 3 `signal not available` ⊘, 255 `Signal not available` ⊘ |
| `DT_Ident_A` | 61840 (0xF190) | `PRES_VIN_17Byte`, `ascii` | text | `""` | none |
| `DT_Ident_B` | 61856 (0xF1A0) | `PRES_VIN_17Byte`, `ascii` | text | `""` | none |

`ecu.name` `TBMS`. `test-diag.names.toml`:

```toml
[fields]
"0x0208/PRES_Cell_2Byte" = "cell_voltage"
DT_Pack_Current = "current"
PRES_Contactor_State = "contactor"
"0xf190/PRES_VIN_17Byte" = "vin"   # lower-case hex DID
```

→ 18 names (spec "Fixture names"). `testdb.ts` exports `testDiagCatalogs = [fixture("test-diag.manifest.json")]`. The HTTP and catalog tests use stub sources, so the seed DB and its counts (1,017 signals, changed by `add-events`) stay untouched.

### M7: TOML parser

`smol-toml` as a server dependency, exact version (current at implementation; 1.9.1 today, BSD-3-Clause, no dependencies). Alternative: a hand parser for `[fields]`; rejected because quoted keys, escapes and comments are TOML's corner cases and the decoder uses a full parser (`tomllib`).

## Risks / Trade-offs

- **Shared `V` axis with DBC voltages:** a window holding a cell voltage (~4 V) and an HV voltage (~350 V, unit `V`) draws both on one scale; the cell curve looks flat. That is "One y-axis per unit" (D-018) as decided; not changed here.
- **Names file out of step with the decoder:** if the names file changes but carserver has not re-decoded, signals keep old names and simply have no metadata; nothing breaks.
- **Off by a factor of two:** no tuned numbers here. The warning lists 10 names (5 or 20 changes only log length). Manifest size ×2 (500 KB) parses in milliseconds per catalog load.

## Open Questions

None for Jan. For the lead: D-061 says KIPscope reads the "invalid sentinels"; this design carries them as `diag.invalid` and does not turn them into SNA codes (proposal, data facts above: they are never stored, and as SNA they would hide valid zeros). `add-events` (design N1, "those sentinels as SNA, as that change defines") gets no SNA codes from diag signals.

## Ledger entry (copy to `docs/decisions.md` on archive)

**D-0xx: Diagnostic metadata conventions (date of archive).** From the archived change `add-diag-metadata`; details there. `KIPSCOPE_DIAG_CATALOGS` lists manifest paths (default smart451 `bms-live.manifest.json`), names file next to each (`.names.toml`), read every catalog load; signal names as the decoder (`<ECU>.<name>`, else `<ECU>.<group>.<field>`, arrays `.<n>` padded to the element count's digits). `SignalInfo.unit` from the field, `SignalInfo.diag` {file, ecu, group, did, field, element, kind, states, invalid}; invalid rows are not SNA (never stored; physical 0). DBC first, then catalogs in order, first source wins whole, warned once per load. Problems warn and never block.
