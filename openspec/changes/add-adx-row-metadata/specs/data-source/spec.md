## ADDED Requirements

### Requirement: Listed units
`listSignals` MAY report a non-empty unit per listed signal from the source's own rows (with a scope: the scope's rows); an adapter without units SHALL report no field. The `text` flag SHALL count only text that is not an SNA text. The adapter guide SHALL document both and the ADX variables `KIPSCOPE_COLUMN_UNIT` and `KIPSCOPE_SNA_TEXTS` with their rules. Origin: D-100; guide: data-source "Adapter guide" (Jan, 2026-10-17 „documented").

#### Scenario: Guide documents the row metadata
- **WHEN** the docs test reads `docs/data-sources.md`
- **THEN** the interface table's `listSignals` row names `unit`; the text mentions `take_anyif`, `KIPSCOPE_COLUMN_UNIT` and `KIPSCOPE_SNA_TEXTS` with "ADX only"; and "documents every source variable" passes with both new variables in the variables table and in `.env.example`
- **Evidence:** `apps/server/test/docs.test.ts` › "documents the row metadata", "documents every source variable"

#### Scenario: No unit without a unit column
- **WHEN** the conformance suite's "lists signals with their text flag" runs on ClickHouse and on the emulator (adapters built without a unit column, as today)
- **THEN** besides the unchanged text flags, no listed signal has a `unit` key, on either source
- **Evidence:** conformance suite › "lists signals with their text flag" (one added assertion: `listed.every((s) => !("unit" in s))`)
