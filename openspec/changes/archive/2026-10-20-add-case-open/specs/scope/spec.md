# Spec Delta

## ADDED Requirements

### Requirement: Scope commands while a catalog is open
While the workspace has an open catalog, `scope.set` and `scope.clear` SHALL be rejected with `case_open` and leave the workspace unchanged; the case commands (case-navigation) set the scope instead. Origin: Q-6 (a): Unlink and Link replace Widen and Clear in a case workspace (D-086).

#### Scenario: Refused while a catalog is open
- **WHEN** a workspace opened from C4 gets `scope.set {testcar, T1, T2}` and `scope.clear` through `applyCommand`, and `kipscope scope widen` runs against it
- **THEN** both commands fail `case_open` with the revision unchanged, and the CLI exits 1 with `error.code` `case_open`
- **Evidence:** `packages/shared/test/apply.test.ts` › "refuses scope commands while a catalog is open"; `apps/cli/test/cli.test.ts` › "opens, steps and unlinks a catalog"
