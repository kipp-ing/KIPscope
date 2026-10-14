# letsview

Interactive workspace for exploring recorded time series. Requirements: [docs/concept.md](docs/concept.md) (German). Specs and changes: [openspec/](openspec/). Decisions: [docs/decisions.md](docs/decisions.md).

## Setup

Requires Node ≥ 22.18, pnpm 10, Docker.

```sh
pnpm install
cp .env.example .env   # then set CLICKHOUSE_PASSWORD (read-only user `letsview` on carserver)
```

## Data sources

**Real data (development):** ClickHouse `sdlog` on carserver, reachable only through an SSH tunnel:

```sh
ssh -f -N -L 18123:localhost:8123 jan@192.168.42.207
```

**Test database (automated tests):** local ClickHouse with synthetic data:

```sh
docker compose up -d
pnpm --filter @letsview/server seed:test
```

The seed script refuses to run if `TEST_CLICKHOUSE_URL` equals `CLICKHOUSE_URL`.

## Run

```sh
pnpm --filter @letsview/server dev   # server
pnpm --filter @letsview/web dev      # UI at http://localhost:5173, proxies /api to the server
```

## Check

```sh
pnpm build   # typecheck (+ web bundle)
pnpm test
pnpm lint    # pnpm format to fix
```
