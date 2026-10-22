## ADDED Requirements

### Requirement: Computed signals in a view
A view document SHALL carry the workspace's computed signals as `computed` entries (name, formula, inputs, unit) without IDs, and windows SHALL list a computed signal as `<dataRef>/=<name>`. Opening SHALL give each definition a fresh ID; an entry that fails validation SHALL be left out with a warning. `version` stays 1. Origin: D-102 („the definition lives in the workspace and the view"); no IDs: saved-views "No data, secrets or IDs in a view"; version: design C10.

#### Scenario: Round trip
- **WHEN** a workspace with computed `c3` ("Diff", `a - b` over `Fast_100h.SIG_A`, `Sna_800h.SPEED`, unit `A`) shown as `testcar/=c3` in a window is turned into a document with `workspaceToView` and opened with `view.open` on a workspace whose `nextId` is 40
- **THEN** the document has `computed: [{name: Diff, formula: a - b, a: Fast_100h.SIG_A, b: Sna_800h.SPEED, unit: A}]`, the window lists `testcar/=Diff` and no `c3` appears; the opened workspace has one definition with a new `c<n>` ID (n ≥ 40) and the window shows `testcar/=c<n>`
- **Evidence:** `packages/shared/test/views.test.ts` › "round-trips computed signals through a view document"

#### Scenario: Broken entry and missing reference
- **WHEN** `parseViewDoc` reads a document with a computed entry whose formula is `a - c`, and a window listing `testcar/=Nope`
- **THEN** it is ok with the warning `computed signal "<name>" left out: Unknown name "c": use a, b, numbers, + - * / ( ), abs, min, max`; on open `testcar/=Nope` is in `report.missing`
- **Evidence:** `packages/shared/test/views.test.ts` › "leaves out a broken computed entry with a warning"
