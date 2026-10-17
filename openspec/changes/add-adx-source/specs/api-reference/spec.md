# api-reference Specification

## Purpose

A lean, checked reference of KIPscope's HTTP API for people who build their own client or connect KIPscope to other tools, next to the CLI reference in the README.

## ADDED Requirements

### Requirement: HTTP route reference
The repo SHALL hold `docs/http-api.md` in English: one table row per server route (method, path, purpose, fields, the spec holding its payload and errors) and the rules all routes share (design C9). It SHALL NOT repeat payload schemas from the specs or `packages/shared`, nor the README's CLI reference. Origin: Jan (2026-10-17) „the interfaces shall be lean and documented"; no HTTP reference exists today (the README names only `/api/meta` and `/api/license`).

#### Scenario: Every route listed
- **WHEN** a test builds the app with stub dependencies, collects every registered route (method and path, the websocket `/api/live` included) and reads `docs/http-api.md`
- **THEN** every collected route appears in the document's table as `` `<METHOD> <path>` ``, and every route in the table is registered
- **Evidence:** `apps/server/test/docs.test.ts` › "documents every HTTP route"

#### Scenario: Linked from the README
- **WHEN** `grep -n "docs/http-api.md\|docs/data-sources.md" README.md` runs
- **THEN** it prints at least one line for each document
- **Evidence:** the `grep` command
