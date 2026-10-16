# Proposal

## Why

Jan (2026-10-16): „signals shall be grouped on left bar. user defined. here as example we use sending ECU" (D-053). The explorer today is one flat list of 428 real signals; the DBCs already name the sending ECU of every message (`BO_ 342 YRG_156h: 8 YRG`), which KIPscope does not parse yet.

And: „the live courser is 8px until highlight. should be double, its hard do see." (D-052): the near-curve distance of the live cursor goes from 8 px to 16 px.

## What Changes

- **Sender from the DBC:** the last token of a `BO_` line becomes `DbcInfo.sender` (absent for `Vector__XXX` or a line without it).
- **Group rules in `kipscope.yaml`:** a new optional `display.groups`, an ordered list of rules like `display.names` (D-035): an optional regex `match` on the full source name and a template `group` over its named groups and the DBC field `{sender}`. The first rule that matches and renders non-blank names the group; else the signal is in `Other`. Validated like the name rules; restart to change. The shipped `kipscope.yaml` and `kipscope.example.yaml` group by `{sender}`.
- **Computed on the server:** once per catalog load, delivered as optional `SignalInfo.group` (absent means `Other`), like `displayName`; the web never evaluates rules.
- **Explorer groups:** when any signal has a group, the list shows group headers (chevron, name, count), collapsible by click or Enter. Empty search: all groups collapsed, alphabetical, `Other` last. While searching: only groups with a hit, all open, ordered by their best hit, ranking kept inside each group, `Other` last. Keys, hover card, drag source and "Show N more" keep working; headers are items of the list. Without any group (no file, no rule) the list stays flat as today.
- **Live cursor:** near-curve distance 16 px (`NEAR_PX`).

**Out of scope:** remembering expanded groups across a search or a reload (D-053 fixes the state per query, design G6); searching by group name; nested groups; sticky headers; showing the sender or group in the hover card, legends, values window, CLI or workspace; group rules in the UI or hot reload of the file; other DBC fields as placeholders (`{message}`, `{file}`, bus); grouping outside the explorer; any other change to the live cursor.

## Capabilities

### New Capabilities

- `signal-groups`: the `display.groups` rules and their validation, the sender field, the group per catalog entry, the grouped explorer list (order, collapse, counts, keys, chunks) and the shipped files.

### Modified Capabilities

- `live-cursor`: "Near signal": 16 px (D-052).
- `signal-catalog`: "DBC details per signal" gains `sender`; "No hard cap on results" and "Explorer keys" describe the grouped list (headers as items, all collapsed on an empty search).
- `display-names`: "Display names come from the server": the no-file catalog tests pass with only `dbc.sender` added.

## Impact

- `packages/shared/src/signals.ts`: `DbcInfo.sender`, `SignalInfo.group`, `OTHER_GROUP`, `groupOf()`.
- `apps/server/src`: `dbc.ts` (sender), new `groups.ts` (rule type, `assignGroup`), `names.ts` (`DisplayRules.groups`), `project.ts` (`display.groups`), `catalog.ts` (sender into `dbcInfo`, group per entry).
- `apps/web/src`: new `explorer/groups.ts` (items helper), `explorer/SignalExplorer.tsx`, `styles.css`; `chart/live.ts` (`NEAR_PX`).
- Files: `kipscope.yaml`, `kipscope.example.yaml`, `README.md`; test fixture `apps/server/test/fixtures/kipscope.test.yaml`.
- Payloads only gain optional fields; no dependency, no stored data.
