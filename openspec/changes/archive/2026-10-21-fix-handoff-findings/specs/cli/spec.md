## MODIFIED Requirements

### Requirement: Catalog link from the CLI
`case url FILE|- [--trim]` SHALL print `local.url` `<server>/open#cases=<code>`, a JWS passed as it is and a document encoded unsigned like `#view=`, and SHALL exit 2 with `link_too_long` when the link exceeds 8,192 characters. With `--trim` a document or an unsigned code SHALL be trimmed by the balanced trim (case-handoff "Balanced trim") to a link of at most 8,192 characters, printing also `local.dropped` `{before, after}` and `local.position` `<k> / <n>` of `current` in the trimmed catalog; it SHALL exit 2 with `link_too_long` when `current` alone does not fit, and 2 `usage` for a JWS (a signed catalog is trimmed before signing) or a document without a valid `current` for its `cases`. `--trim` on any other form SHALL be a usage error. Origin: exploration "Commands and routes" (`kipscope case link file.json` prints the link; renamed `case url` because `case link` returns to a session); D-070 (link limit); `--trim`: finder finding (the ADX feedback, comment 2026-10-21; today the CLI only refuses).

#### Scenario: Link of a catalog
- **WHEN** `case url c4.json` runs with C4, then `case url` with a file holding a JWS, then with a 2,000-session catalog
- **THEN** the first prints a url whose code `decodeCasesLink` turns back into C4; the second prints `<server>/open#cases=<the JWS>`; the third exits 2 with `link_too_long`
- **Evidence:** `apps/cli/test/cli.test.ts` › "prints a catalog link"

#### Scenario: Trimmed link
- **WHEN** `case url many.json --trim` runs with the 2,000-session catalog of "Link of a catalog" and `current` 2; then `case url c4.json --trim` with C4; then `case url signed.txt --trim` with a JWS
- **THEN** the first exits 0 with a `local.url` of at most 8,192 characters whose decoded catalog holds `cases.slice(0, k)` of the input for some k ≥ 3 with `current` 2, `local.dropped` `{before: 0, after: 2000 − k}` and `local.position` `3 / <k>`; the second exits 0 with the same url as without `--trim` and `local.dropped` `{before: 0, after: 0}`; the third exits 2 with `error.code` `usage`
- **Evidence:** `apps/cli/test/cli.test.ts` › "trims a catalog link"

#### Scenario: Trim flag parsed
- **WHEN** the argument lists `case url f.json --trim`, `case url f.json` and `case open f.json --trim` are parsed
- **THEN** the first gives `{kind: "case", action: "url", file: "f.json", trim: true}`, the second the same without `trim`, the third a usage error
- **Evidence:** `apps/cli/test/args.test.ts` › "maps the case forms"
