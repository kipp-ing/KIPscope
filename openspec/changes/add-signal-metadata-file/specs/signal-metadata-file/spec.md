## Purpose

Lets another tool (the search tool) hand KIPscope the metadata of signals it cannot get from DBC files or diagnostic catalogs: plain JSON files keyed by the source signal name, in a format KIPscope defines, documents and reads robustly.

## ADDED Requirements

### Requirement: Metadata file format
A metadata file SHALL be a JSON object with `kipscope` `"signal-metadata"`, `version` 1 and a list `signals`; each entry SHALL have a `name` (the signal's source name) and MAY have unit, description, factor, offset, min, max, cycleMs, message, messageId, a value table and SNA values as physical values (fields and rules: design F1). A field that is absent or `null` SHALL stay absent. Origin: D-099 („KIPscope defines and documents the format").

#### Scenario: Fixture entries
- **WHEN** `parseMetadataFile` reads `apps/server/test/fixtures/test-metadata.json` (design F9)
- **THEN** it yields 6 entries and no warning; `META.SPEED` has unit `km/h`, description `Indicated speed`, `meta` `{file: "test-metadata.json", message: "ICL_3A2h", messageId: 930, factor: 1, offset: 0, min: 0, max: 510, cycleMs: 100, values: [{raw: 511, label: "SNV", value: 511}]}` and sna `[{raw: 511, value: 511, sources: ["metadata"]}]`; `META.WSPD` has sna `[{value: 8191.5, sources: ["metadata"]}]` without `raw`; `META.MODE` has values `[{0, off, 0}, {1, on, 1}]` (sorted by raw) and no unit, no sna; `META.TEMP` has unit `°C` (trimmed) and values `[{raw: 0, label: "COLD", value: -40}]`
- **Evidence:** `apps/server/test/metadata.test.ts` › "reads the fixture entries"

#### Scenario: Null and empty fields
- **WHEN** an entry is `{"name": "A.B", "unit": null, "description": "  ", "values": [], "sna": []}`
- **THEN** it yields an entry with `meta` `{file}` only and no unit, description, values or sna, and no warning
- **Evidence:** `apps/server/test/metadata.test.ts` › "treats null, blank and empty fields as absent"

### Requirement: Metadata files configuration
The server SHALL read the files of `KIPSCOPE_METADATA_FILES` (comma list, relative to the repo root, priority order; default none) on every catalog load, for start-up, background, scoped and manual (`POST /api/catalog/refresh`) loads alike. Origin: D-099; reading per load as DBC files and diagnostic catalogs ("Diagnostic catalog names").

#### Scenario: Config
- **WHEN** `loadConfig` runs without `KIPSCOPE_METADATA_FILES`, and with `KIPSCOPE_METADATA_FILES=a.json, /abs/b.json`
- **THEN** `metadataFiles` is `[]`, then `[<root>/a.json, /abs/b.json]`
- **Evidence:** `apps/server/test/config.test.ts` › "defaults to the carserver sdlog mapping", "applies overrides" (both extended)

#### Scenario: Documented variable
- **WHEN** the docs test collects every `KIPSCOPE_*` key `config.ts` reads
- **THEN** `KIPSCOPE_METADATA_FILES` appears in `docs/data-sources.md` and `.env.example`
- **Evidence:** `apps/server/test/docs.test.ts` › "documents every source variable" (unchanged)

### Requirement: Changed files are read again
A catalog load SHALL use a file's current content: a file that changed since the last load SHALL be read again, and a file that did not change MAY be reused without reading it, with its warnings reported again. Origin: necessary consequence: a scoped catalog loads on every case step (D-078), and an ADX file of all signals may be tens of MB (design F5).

#### Scenario: Unchanged, then changed
- **WHEN** a loader over one temp file with entry `A.B` unit `V` runs twice, then the file is rewritten with unit `mV` (new mtime) and the loader runs again
- **THEN** the first two runs give unit `V` and the file was parsed once; the third gives unit `mV`
- **Evidence:** `apps/server/test/metadata.test.ts` › "reads a file again only when it changed"

### Requirement: Metadata file problems per load
A metadata file problem SHALL never stop the server or a catalog load: an unusable file SHALL be skipped, a bad entry ignored whole, an unknown field ignored; a name given twice in a file, or already in an earlier file, SHALL keep the first entry. Each problem kind SHALL be logged once per load and file, naming at most 10 entries (texts: design F5). Origin: necessary consequence: missing metadata never blocks data display ("Diagnostic catalog problems per load", design H5).

#### Scenario: Bad entries
- **WHEN** `parseMetadataFile` reads a version-1 text whose signals are, in this order: `{"name": "OK.A", "unit": "V"}`, `{"unit": "V"}`, `{"name": "BAD.F", "factor": 0}`, `{"name": "BAD.V", "values": [{"raw": 1, "label": "a"}, {"raw": 1, "label": "b"}]}`, `{"name": "BAD.S", "sna": [{"value": "x"}]}`, `{"name": "BAD.R", "min": 5, "max": 1}`, `{"name": "OK.A", "unit": "mV"}`, `{"name": "OK.B", "unti": "V"}`, `{"name": "OK.C", "sna": [{"value": 0.5}]}`
- **THEN** it yields `OK.A` (unit `V`), `OK.B` (no unit) and `OK.C` (sna value 0.5); exactly four warnings: `5 entries ignored` naming `#1` (the entry without name, by its 0-based index), `BAD.F`, `BAD.V`, `BAD.S`, `BAD.R` with field and problem; `1 names given twice, the first wins: OK.A`; `unknown fields ignored: unti (1)`; `1 SNA values without factor are compared within 0.5: OK.C`
- **Evidence:** `apps/server/test/metadata.test.ts` › "ignores bad entries with one warning per kind"

#### Scenario: Unusable files and the earlier file wins
- **WHEN** a loader reads, in this order: the fixture, a missing path, a file `not json`, a JSON file with `kipscope` `"cases"`, a JSON file with `version` 2, and a copy of the fixture in a temp dir
- **THEN** the result has the fixture's 6 entries with `meta.file` `test-metadata.json`; exactly five warnings: the missing path skipped, `not JSON`, `not a signal metadata file`, `version 2 not supported`, and the copy's `6 signals already in an earlier metadata file, the earlier wins: …`
- **Evidence:** `apps/server/test/metadata.test.ts` › "skips unusable files, the earlier file wins"

#### Scenario: Server starts without the file
- **WHEN** a catalog whose metadata-file loader reports one problem per load is refreshed twice
- **THEN** both loads succeed and the warning is logged exactly twice, once per load, prefixed `metadata file: `
- **Evidence:** `apps/server/test/catalog.test.ts` › "logs metadata file warnings once per load"

### Requirement: Format documented for the writer
The repo SHALL hold `docs/signal-metadata.md` in English for the file's writer: fields, how KIPscope uses them, the SNA tolerance, precedence, when the file is read, the warnings, and an example file `docs/signal-metadata.example.json` that reads without warning. It SHALL be linked from `docs/handoff.md` and the README. Origin: D-099 („KIPscope defines and documents the format"; „The search tool writes the file").

#### Scenario: Example reads cleanly
- **WHEN** `parseMetadataFile` reads `docs/signal-metadata.example.json`
- **THEN** it yields `ICL_3A2h.SPEED_DISP`, `BRK_1A0h.WSPD_FL` and `ENG_5E0h.T_ENG` with the values of design F8 and no warning
- **Evidence:** `apps/server/test/metadata.test.ts` › "reads the documented example without warnings"

#### Scenario: Linked and complete
- **WHEN** the docs test reads `docs/signal-metadata.md`, `docs/handoff.md` and `README.md`
- **THEN** the guide names every entry field of design F1 (`name`, `unit`, `description`, `factor`, `offset`, `min`, `max`, `cycleMs`, `message`, `messageId`, `values`, `sna`), `"signal-metadata"`, `KIPSCOPE_METADATA_FILES` and `signal-metadata.example.json`; handoff.md and README.md each contain `signal-metadata.md`
- **Evidence:** `apps/server/test/docs.test.ts` › "documents the signal metadata file"
