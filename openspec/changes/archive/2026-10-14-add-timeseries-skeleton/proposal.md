# Proposal

## Why

KIPscope starts from an empty repo. Before cursors, CLI control and persistence can be built, the core path from the concept ([docs/concept.md](../../../docs/concept.md)) must work end to end: pick signals from ClickHouse, show them in a time-series window, and zoom from a ten-hour overview down to raw milliseconds without loading millions of points. This change builds that walking skeleton and fixes the architecture the later features rely on (D-004, D-005, D-006).

## What Changes

- Set up the project: server, browser UI, shared types, local ClickHouse with synthetic data for automated tests.
- Connect to the existing ClickHouse database `sdlog` on carserver (smart451 vehicle data, table `signals`) through an SSH tunnel with a read-only user.
- Add a ClickHouse data adapter with a signal catalog searchable by name, description, alias and unit; units and descriptions come from the vehicle's DBC files, since the database stores none.
- Add resolution-aware series queries: aggregated buckets (mean, min, max) for overviews, unmodified raw points with original timestamps for detail, including one neighbor point outside each edge of the range.
- Add a server-held workspace: windows, their signals and time ranges, changed only through commands. Each accepted command yields a new revision; the browser reports which revision it has rendered.
- Add a time-series window in the browser: line, step and marker modes, optional min/max envelope, independent zoom and pan per window, reloading finer data on zoom, visible loading/error states, stale responses discarded.
- Preserve original timestamp precision (down to nanoseconds) through query, transport, state and display.

Out of scope here (later changes): cursors A/B and differences, CLI, undo, save/load/snapshots/templates, single-value windows, playback, ADX adapter, non-numeric signal types, derived signals, timezone selection (display uses local time only for now).

## Capabilities

### New Capabilities
- `signal-catalog`: discovering available signals and their metadata (name, description, alias, unit) from a data source.
- `series-query`: fetching a signal's data for a time range at a target resolution, as aggregated buckets or raw points, with original timestamp precision.
- `workspace-state`: the server-held state of the open workspace (windows, assigned signals, time ranges, display options), changed only through commands, with revisions and render acknowledgement.
- `timeseries-window`: displaying one or more signals over time in a window, including display modes, envelope, zoom/pan and loading behavior.

### Modified Capabilities
- None (no existing specs).

## Impact

- New code: server, browser UI, shared package; new dependencies (ClickHouse client, charting library, web framework — chosen in design.md).
- carserver (serverzoo): new read-only ClickHouse user `letsview`; ClickHouse stays bound to localhost. The machine is small (2 GB RAM, 512 MiB and 8 concurrent queries max), so KIPscope must keep its query load bounded.
- Reads DBC files from the CarController repo (`vehicles/smart451/dbc/`).
- Requires Docker for the local test database.
