## MODIFIED Requirements

### Requirement: Computed signals in a view
A view document SHALL carry the workspace's computed signals as `computed` entries (name, canonical formula, unit) without IDs, a nested reference written as the other entry's name, and windows SHALL list a computed signal as `<dataRef>/=<name>`. Reading SHALL rewrite entries with `a`/`b` into the new form (computed-signals "Old definitions migrated"); an entry that fails validation, closes a cycle or exceeds a limit SHALL be left out with a warning. Opening SHALL give each definition a fresh ID. `version` stays 1. Origin: D-102 („the definition lives in the workspace and the view"); no IDs: saved-views "No data, secrets or IDs in a view"; nesting and migration: D-106 with D-105 Q-1; version: add-computed-signals C10.

#### Scenario: Round trip
- **WHEN** a workspace with computed `c3` ("Diff", `Fast_100h.SIG_A - Sna_800h.SPEED`, unit `A`) and `c4` ("AbsDiff", `abs(Diff)`), both shown in a window, is turned into a document with `workspaceToView` and opened with `view.open` on a workspace whose `nextId` is 40
- **THEN** the document has `computed: [{name: Diff, formula: "Fast_100h.SIG_A - Sna_800h.SPEED", unit: A}, {name: AbsDiff, formula: "abs(Diff)"}]`, the window lists `testcar/=Diff` and `testcar/=AbsDiff` and no `c3` or `c4` appears; the opened workspace has both definitions with new IDs (n ≥ 40), AbsDiff's formula still `abs(Diff)`, and the window shows both new IDs
- **Evidence:** `packages/shared/test/views.test.ts` › "round-trips computed signals through a view document"

#### Scenario: Broken entry and missing reference
- **WHEN** `parseViewDoc` reads a document with computed entries `{name: Bad, formula: "X.A %"}`, `{name: P, formula: "Q + 1"}`, `{name: Q, formula: "P + 1"}`, and a window listing `testcar/=Nope`
- **THEN** it is ok with the warnings `computed signal "Bad" left out: Unexpected "%" at 5` and, for P and Q, `computed signal "<name>" left out: Cycle: …`; on open `testcar/=Nope` is in `report.missing`
- **Evidence:** `packages/shared/test/views.test.ts` › "leaves out a broken computed entry with a warning"

#### Scenario: Old entry rewritten
- **WHEN** `parseViewDoc` reads an entry `{name: Diff, formula: "a - b", a: Fast_100h.SIG_A, b: Sna_800h.SPEED}`
- **THEN** it is ok without a warning and the entry reads `{name: Diff, formula: "Fast_100h.SIG_A - Sna_800h.SPEED"}`
- **Evidence:** `packages/shared/test/views.test.ts` › "rewrites computed entries with a and b"
