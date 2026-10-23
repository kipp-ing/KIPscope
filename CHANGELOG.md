# Changelog

## v0.1.0 (2026-10-23)

The first tagged version. Built 2026-10-14 … 2026-10-23 in spec-driven rounds; each capability has its spec in [openspec/specs/](openspec/specs/), the history of each change is in [openspec/changes/archive/](openspec/changes/archive/).

**Look at signals**

- Signal catalog from the DBC and the decoder's diagnostic catalogs: ranked search, groups by sending ECU, favourites, a hover card with message, CAN ID, scaling, range, SNA codes and states; short display names from `kipscope.yaml`.
- Chart windows: drag and drop, up to four units per window, linked time axes, line, step or markers, min/mean/max envelope.
- Fast zoom: raw samples or buckets by zoom level, tiles cached in the tab, prefetch while idle; tested on 10 h at 5 ms.
- Cursors A and B with exact values, Δ and Δt; a live cursor L that follows the pointer; a values window without a plot.
- Computed signals: formulas over up to eight signals with `+ - * / abs min max`, computed in the database where the adapter supports it.
- Honest data: SNA values are never drawn, logger gaps break the lines and show as grey bands.

**Find your way**

- TIME strip with data density and drives; range picker with a calendar of the data per day and "Go to" with times, ranges and durations.
- Events: fault memory reads, state changes and logger notes as pins and lines, an Events tab with one filter string, `n`/`p` stepping.
- Sessions from a search tool: a signed catalog by link, file or CLI; `[` `]` step with the layout kept, Align, Unlink to the whole vehicle, neighbours preloaded.
- Help panel with the [manual](docs/manual.md) and all keys.

**Script and share**

- Every UI action is a workspace command; the `kipscope` CLI drives the open workspace, `--wait` until the UI rendered it.
- Saved views, YAML export and import, `#view=` links; a workspace per tab with Share… (own copy, read or write).
- HTTP API documented route by route in [docs/http-api.md](docs/http-api.md).

**Run it anywhere**

- Data sources behind a lean adapter contract with a conformance suite: ClickHouse and Azure Data Explorer ship.
- Team server: enterprise SSO (OIDC) or an own identity adapter, rights only from a signed handoff, one guard on every route, bounded queries on large tables.
- Demo: two days of a simulated smart fortwo electric drive (451) on public OVMS signals, `scripts/demo.sh`.
