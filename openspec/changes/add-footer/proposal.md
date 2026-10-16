# Proposal

## Why

Jan (2026-10-16): „the KIPscope will get a footer permanently visible. it shall have useful meta info and the name of the tool, the license and a short link to my web page or so." He wants his attribution shown. KIPscope is under the Attribution Assurance License (D-049), whose clause 2 asks for "a prominent display … of the Author's attribution information" (name, professional identification, URL) each time the program runs; D-049: "The app shows the attribution itself (change `add-footer`)."

Then Jan: „meta info shall be cli settable or yaml definable. so like measurement name, measurement object, measurement meta". And on layout: the license and the kipp.ing link sit at the far right, small and subtle.

Today the bottom of the page is the status strip (`connected · revision n`, the last message, and the "+ New window" zone during a drag, spec `workspace-layout`). A second strip would cost height that D-025 wants for data, so the footer goes into that strip.

## What Changes

- **One bottom bar**, left to right: the status (connection, revision, message); the **measurement info** (name, object, `key: value` entries), shown only when set; a few **automatic meta items**; and at the far right, small (11 px) and muted, the **attribution** `KIPscope · © 2026 Jan Kipping, Agentic engineer · kipp.ing · AAL`. The bar stays visible while the window list scrolls, with the sidebar open or collapsed, and during a drag, where "+ New window" covers status and items while the attribution stays.
- **Links:** `kipp.ing` opens https://kipp.ing in a new tab; `AAL` opens the license text, served by the server as `GET /api/license` from the repo's `LICENSE`. Both `rel="noopener noreferrer"`.
- **Measurement info** (new capability `measurement-info`): part of the workspace (`workspace.measurement`), so `kipscope state` reports it and revisions, live push and `--wait` apply. Start value from a new optional `measurement` section in `kipscope.yaml` (read once at start, like the display rules); changed at runtime by three commands `measurement.set {name?, object?}`, `measurement.setMeta {key, value}` and `measurement.clear`, which win until the server restarts. CLI: `measurement name TEXT`, `measurement object TEXT`, `measurement meta KEY VALUE`, `measurement clear`. Limits: name and object 120 characters, at most 8 meta entries with keys of 40 and values of 200 characters, one line each.
- **Automatic meta items**, small and separate from Jan's fields, from a new `GET /api/meta` unless noted: data source `ClickHouse sdlog` coloured by a ping of the source; catalog `1234 signals` (or loading / unavailable); the browser's time zone `Europe/Berlin`; the server's short git commit at start (`7c1e2a9`, `*` when dirty).
- **Fitting:** one line of at most 32 px at 1440×900 and 1000×557. When space runs short, whole items drop out in a fixed order (build, time zone, catalog, measurement meta entries, source, object, name), measurement texts are cut at 40 characters, status and attribution are never cut; below the width they need, the attribution moves to a right-aligned second line.
- **Attribution outside the UI** (pending Jan, design Q4): the last line of `kipscope --help` and one log line at server start.

**Out of scope:** editing measurement info in the UI (design Q8); persisting measurement info across restarts or writing it back to the YAML (comes with persistence); a time zone selector (concept §8, its own change); a semantic version or release process; serving `LICENSE.asc` or `KEYS.asc`; a link to the GitHub repository (design Q2); an about dialog; data references, uptime, query load or any other automatic item beyond the four above; the footer in the sidebar column; changing the "+ New window" drop behaviour; any change to `server-access` (the new routes pass its guard like every route).

## Capabilities

### New Capabilities

- `app-footer`: the footer part of the bottom bar: attribution and license link, the served license text, how measurement info and the automatic meta items are shown, their server endpoint, how the bar fits narrow widths, and the attribution at server start.
- `measurement-info`: measurement name, object and meta entries in the workspace, their commands and limits, the start value from the project file and its validation.

### Modified Capabilities

- `workspace-layout`: "Top row and status strip": the strip also carries the footer; during a drag the attribution stays next to "+ New window".
- `cli`: `--help` ends with the attribution line (pending Jan, design Q4); new `measurement` forms.

## Impact

- `packages/shared`: new `meta.ts` (`ATTRIBUTION`, `attributionText`, `ServerMeta`); `workspace.ts` (`Measurement`, limits, three commands, `measurement_limit`); `apply.ts`; `index.ts`.
- `apps/server/src`: new `meta.ts` (build info, `/api/meta`, `/api/license`); `project.ts` (`measurement` section); `workspace.ts` (start measurement); `app.ts`; `main.ts`.
- `apps/cli/src/args.ts`: forms and help line.
- `apps/web/src`: new `footer/` (`items.ts`, `fit.ts`, `useMeta.ts`, `StatusBar.tsx`); `api.ts`; `App.tsx`; `styles.css`.
- Docs: `kipscope.example.yaml`, `README.md`.
- Tests in all four packages. No dependency, no stored data; existing payloads only gain the optional `workspace.measurement`. Archive after `harden-robustness` (its `server-access` guard covers the new routes).
