# Design

## Context

- **Jan's decisions:** D-078 („Kipview soll nicht datenabschnitte finden. es soll gefundene Datenabschnitte effizient darstellen … im finder gibt es immer "benachbarte" sessions. wäre toll man kann die mit einem klick wählen. das nachladen muss für die nächste halt auch noch klappen"). D-081 (query classes; `preload` is the lowest, „D-078 neighbours"). D-082 (scope conventions: every source query bounded, the signal list per scope, clamp at the edge). D-084 (identity adapters, one guard). D-085 („wir können das rechtemanagement in kiping packen … die liste kann beliebig sortiert sein beliebige VINs"). D-086 („unlink ist aktuelles fahrzeug. unlink ist für den user unbegrenzt, rechte haben keinen zeit bezug des objekts. der ist ja"), which accepts the exploration's recommendations 1, 2, 4, 6–11 and 13 and changes 5 and 12.
- **Exploration:** [docs/explore/2026-10-20-sessions-and-handoff.md](../../../docs/explore/2026-10-20-sessions-and-handoff.md) (payload, commands, UX sketch, caching plan, Security). D-086 overrides it on the Unlink horizon (no 31-day default, no 1-year cap, no `KIPSCOPE_HORIZON_MAX`) and on rights (no `grant.objects` windows).
- **Concept:** §9 „Untersuchung direkt öffnen: Datensatz, Zeitpunkt, Vor-/Nachlauf und Template oder Signalauswahl gemeinsam über CLI beziehungsweise Link übergeben"; §9 „Templates neu binden: Vorhandene Ansicht auf eine andere Messung anwenden; fehlende oder mehrdeutige Signalzuordnungen melden"; §7 (one command model for UI and CLI).
- **KI.ping data facts** (exploration, KI.ping `8fc8457`): a session id is `<VIN>|<kind>|<t_start ISO>`; the object is the VIN; kinds `driving`, `charging`, `idle`; windows `[t_start, t_end)` UTC; KI.ping pads plots by 60 s (`pad_s`); about 1.6 sessions and 5 logged hours per vehicle and day; the longest charge was 16.5 h; KI.ping keeps 12 months. Measured link sizes (unsigned, deflate-raw, base64url): 50 sessions 1.9 k characters, 200 sessions 5.8 k.
- **Prerequisite (`add-multiuser` after its revision, pinned there, used here unchanged):** the server state is a *workspace*: UI `/w/<id>`, API prefix `/api/w/<id>/…`, `POST /api/workspaces`, header `X-KIPscope-Workspace`, CLI `--workspace`. Each workspace has `grant: {objects: "all"} | {objects: string[]}` (data refs), enforced by the one guard on every data route; `grantObjects(workspaceId, dataRefs)` widens it; identity `none` has `all`. Where this design names a route or type of that change, its final name wins; the behaviour here does not depend on the spelling.
- **Code today:** `enterScope` (`apps/web/src/chart/rescope.ts`) clears every tile, extent and gap info on a scope change (add-scope Z12). Tile IDs are `<signalId>|<level>|<index>`, and a signal ID starts with its data ref, so the key holds no scope. Raw tiles carry `before`/`after` edge points, which a scope cuts („as if the source held only the scope's rows"). Density, gaps and events of a scope are computed over the whole scope (add-scope Z9) and cached per `scopeKey`. HTTP requests run `interactive`; only server-side prefetches and polls run `background`. `scope.set` and `view.open` load the scope's list before they apply (scope "A scope's signal list loads first"). The strip head shows `SCOPE <ref> · <from> – <to>` with Widen and Clear (`apps/web/src/time/scope.ts`). Keys `[` and `]` are free (`apps/web/src/keys.ts`).

## Goals / Non-Goals

**Goals:** one handoff document for link, file, CLI and API; KI.ping's signature as the only source of rights on a server; stepping through any catalog without a page load and with the dashboard kept; Unlink to a whole vehicle with no user-visible bound and no unbounded query; a switch back to a seen session drawn from memory; neighbours ready before the user steps; every interface two areas share pinned here, so shared, server, web, CLI, docs and tests build in parallel.

**Non-goals:** the proposal's "Out of scope". At design level also: no change to the source contract (no new adapter method; every query below uses the 15 methods with a scope); no new identity code; no change to view documents (`version: 1` stays).

## Decisions

### K1: Words

| Word | Meaning | In code |
|---|---|---|
| Session | one entry of a catalog: one object, `[from, to)`, kind, meta (KI.ping's meaning, D-086 Q1) | `CaseEntry` |
| Catalog | the ordered list handed over; its order alone defines previous and next (D-085) | `CaseCatalog`, `cases` |
| Case | the open catalog in a workspace: which entry, linked or not, alignment | `Workspace.case` |
| Object scope | the scope after Unlink: one vehicle's full extent | `WorkspaceScope.object: true` |
| Work window | the part of an object scope that gaps, events and strip drives cover, around the view (K11) | `workWindow()` |

The UI says "session", "vehicle" (for an object) and "catalog"; the word "case" stays in code and the CLI (`kipscope case …`), one word per meaning.

### K2: Shared DTOs (pinned, new `packages/shared/src/case.ts`, exported from `index.ts`)

```ts
export const CASES_KIND = "cases";
export const CASES_VERSION = 1;
export const MAX_CASES = 2_000;                 // sessions per catalog (file, API, link)
export const MAX_CASES_TEXT = 4_000_000;         // characters of a `cases` string in a request body
export const MAX_CASES_JSON = 4_194_304;         // bytes of the catalog JSON after inflating
export const MAX_CASE_META = 16;                 // meta keys per session
export const DEFAULT_CASE_PAD = "60s";           // KIPSCOPE_CASE_PAD default (KI.ping pad_s)
export const MAX_CASE_PAD_NS = 86_400_000_000_000n; // 1 d
export const CASE_LIST_ROWS = 500;               // rows the catalog list renders before "type to filter"
export const CLASS_HEADER = "x-kipscope-class";  // request header; the only accepted value is "preload"
export const DAY_NS = 86_400_000_000_000n;
export const WORK_HALF_MAX_NS = 15n * DAY_NS;    // K11
export const WORK_SPAN_MAX_NS = 32n * DAY_NS;    // route limit for a work window (K11)

/** Object name as the finder sends it (a VIN): 1–128 characters, no control characters. */
export const CaseObject = z.string().min(1).max(128).regex(/^[^\p{Cc}]+$/u);
export const CaseMetaValue = z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()]);

/** What "Align to this event" stores (K7). text only for state changes (category "change"). */
export const EventMatch = z.strictObject({
  kind: z.string().min(1).max(64),
  source: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  text: z.string().max(200).optional(),
});
export type EventMatch = z.infer<typeof EventMatch>;

export const CaseAlign = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("start") }),
  z.strictObject({ mode: z.literal("end") }),
  z.strictObject({ mode: z.literal("anchor") }),
  z.strictObject({ mode: z.literal("event"), event: EventMatch }),
]);
export type CaseAlign = z.infer<typeof CaseAlign>;

/** One session as sent. Times as TimeInput accepts them (ISO UTC with Z or offset, or decimal ns). Unknown keys are ignored. */
export const CaseEntryInput = z.object({
  id: z.string().min(1).max(256),             // opaque, shown and sent back unchanged
  object: CaseObject,
  kind: z.string().min(1).max(32).optional(), // display only
  from: TimeInput,
  to: TimeInput,                              // to − from ≥ MIN_SPAN_NS
  title: z.string().max(120).optional(),      // display only (KI.ping: fleet number)
  meta: z.record(z.string().min(1).max(64), CaseMetaValue).optional(), // ≤ MAX_CASE_META keys, display only
  anchor: TimeInput.optional(),               // from ≤ anchor ≤ to
});

/** The catalog document (D-078 one command for link, file, CLI). Unknown keys are ignored. */
export const CasesDocument = z.object({
  kipscope: z.literal("cases"),
  version: z.literal(1),
  origin: z.object({
    tool: z.string().max(64).optional(),
    url: z.string().max(2_048).optional(),    // kept only when its origin is in KIPSCOPE_FINDER_ORIGINS (K4)
    set: z.string().max(256).optional(),
  }).optional(),
  current: z.number().int().min(0).optional(), // default 0; < cases.length
  pad: z.string().optional(),                  // CLI duration (parseDuration), 0 … 1 d; default KIPSCOPE_CASE_PAD
  align: CaseAlign.optional(),                 // default {mode: "start"}
  view: z.union([z.string().regex(VIEW_NAME), z.record(z.string(), z.unknown())]).optional(),
  cases: z.array(CaseEntryInput).min(1).max(MAX_CASES),
});
export type CasesDocument = z.infer<typeof CasesDocument>;

/** One session after the server normalised it. Decimal ns. */
export interface CaseEntry {
  id: string;
  object: string;
  dataRef: string;            // caseDataRef(template, object)
  kind?: string;
  from: string;
  to: string;
  title?: string;
  meta?: Record<string, string | number | boolean | null>;
  anchor?: string;
}

/** GET /api/case. Immutable for one catalogId. */
export interface CaseCatalog {
  catalogId: string;          // 10 × [a-z0-9], random at open
  origin?: { tool?: string; url?: string; set?: string };
  entries: CaseEntry[];
}

/** Workspace.case: small, pushed with every state; the entries stay in GET /api/case (K6). */
export interface WorkspaceCase {
  catalogId: string;
  count: number;
  /** 0-based index of the session shown; while unlinked, of the session left. */
  current: number;
  linked: boolean;
  pad: string;                // decimal ns
  align: CaseAlign;
  /** Decimal ns: the current session's alignment point (K7). */
  alignAt: string;
  /** Unlinked only: each timeseries window's range at Unlink as offsets from alignAt (decimal ns, may be negative). */
  linkedRanges?: Record<string, { from: string; to: string }>;
  /** The current entry, so the session bar draws without GET /api/case. */
  entry: CaseEntry;
}

/** GET /api/case/preview?index=N (K10, K13). */
export interface CasePreview {
  index: number;
  scope: WorkspaceScope;      // caseScope(entry, pad)
  alignAt: string;
  alignFallback?: true;
}

/** Part of the answer of POST /api/workspaces with open.cases (K10). */
export interface CaseOpenReport {
  count: number;
  current: number;
  dataRefs: string[];         // unique, catalog order: what the grant was widened by
  missing: string[];          // signals of the layout the current session's list lacks
  alignFallback?: true;
  warnings: string[];         // dropped origin.url, signals of other data refs left out, …
}

export const OpenCasesRequest = z.strictObject({
  cases: z.union([z.string().min(1).max(MAX_CASES_TEXT), z.record(z.string(), z.unknown())]),
});

// Pure helpers (K3, K5, K7, K8, K11)
export function caseDataRef(template: string, object: string): string;  // replaces every "{object}"
export function caseScope(entry: CaseEntry, pad: bigint): WorkspaceScope; // {dataRef, from − pad, to + pad}, clamped to TIME_MIN … TIME_MAX
export function alignPoint(entry: CaseEntry, align: CaseAlign): { t: string; fallback: boolean }; // event mode: {from, fallback: true} (the server resolves events, K9)
export function eventMatchOf(event: DiagEvent): EventMatch;              // text only for category "change"
export function matchesEvent(event: DiagEvent, match: EventMatch): boolean;
export function firstMatch(events: readonly DiagEvent[], match: EventMatch, scope: WorkspaceScope): DiagEvent | undefined; // time order, t in [scope.from, scope.to)
export function rebindSignalId(signalId: string, toRef: string): string; // "<ref>/<name>" → "<toRef>/<name>"
/** In packages/shared/src/caseApply.ts (task 1.2), exported from index.ts: the timeseries windows' ranges after a step to a session with point `targetAlignAt` and scope `targetScope` (K6); used by case.go and the preload. */
export function caseRanges(workspace: Workspace, targetAlignAt: string, targetScope: WorkspaceScope): Record<string, { range: TimeRange; clamped: boolean }>;
export function workWindow(view: TimeRange, scope: WorkspaceScope): TimeRange; // K11
export async function encodeCasesLink(doc: CasesDocument): Promise<string>;   // deflate-raw + base64url, as encodeViewLink
export async function decodeCasesLink(code: string): Promise<unknown>;        // inverse; throws on bad input; inflates at most MAX_CASES_JSON bytes
export const isSignedCases = (text: string): boolean => text.split(".").length === 3; // a JWS compact form; base64url has no "."
export const casesLinkUrl = (origin: string, code: string) => `${origin}/open#cases=${code}`;
```

Changes to existing shared files (pinned):

```ts
// workspace.ts
export interface WorkspaceScope { dataRef: string; from: string; to: string; /** The vehicle's full extent after Unlink (K11). */ object?: true }
export interface Workspace { /* … */ case?: WorkspaceCase }

// Command union additions (accepted on POST /api/commands)
{ type: "case.go"; index: number }                       // int ≥ 0; also links (K6)
{ type: "case.step"; by: -1 | 1 }
{ type: "case.unlink" }
{ type: "case.align"; align: CaseAlign; at?: TimeInput }  // at: the chosen event's time (UI); absent: server resolves (K9)

export type CommandErrorCode = /* … */
  | "no_case"            // a case command in a workspace without a catalog
  | "case_end"           // case.step past the first or last session, case.go with index ≥ count
  | "case_unlinked"      // case.step, case.align or case.unlink while unlinked
  | "case_open"          // scope.set or scope.clear while a catalog is open (Q-6 (a))
  | "no_matching_event"; // case.align event without `at` and no match in the current session

// CommandResult ok branch additions
missing?: string[];      // case.go/step: signals the target session's list lacks (after rebinding), unique, sorted
alignFallback?: true;    // case.go/step/align: the mode could not be resolved; aligned to the session start

export interface ApplyContext {
  /* … as today … */
  case?: {
    entry(index: number): CaseEntry | undefined;
    /** case.go/step/align: the target's alignment point, resolved by the server (K9). */
    alignAt?: string;
    alignFallback?: boolean;
    /** case.unlink: the vehicle's extent [from, to), resolved by the server (K9). */
    extent?: { from: string; to: string };
  };
}

// scope.ts
scopeKey(s) // `${dataRef}|${from}|${to}` as today, plus "|object" when s.object

// signals.ts: CatalogSnapshot gains
/** Object scope only: the list is the last linked session's while the vehicle's own list loads (K11). */
partial?: true;

// series.ts: Density gains
/** Object scope without from/to: bars only, no grid buckets, drives [] (K11). */
coarse?: true;

// the open union of add-multiuser's create request
CreateWorkspaceRequest = z.strictObject({ open: z.union([OpenViewRequest, OpenCasesRequest]).optional() });
CreateWorkspaceAnswer gains: case?: CaseOpenReport;
```

### K3: Link and signature format (pinned; `docs/handoff.md` repeats it for KI.ping)

- **Signed (any identity):** `cases` is a JWS in compact form. Protected header `{"alg": "EdDSA" | "ES256", "kid": "<key id>", "typ": "kipscope-cases"}`. The payload bytes are **deflate-raw of the UTF-8 JSON** of the claims (so the link is base64url once, not twice):

  ```json
  { "iss": "https://kiping.example", "aud": "https://kipscope.example", "sub": "<Ping user>",
    "iat": 1792488000, "exp": 1792488600, "cases": { "kipscope": "cases", "version": 1, "cases": [ … ] } }
  ```
- **Unsigned (identity `none` only):** `cases` is `encodeCasesLink(doc)`, the same encoding as `#view=` (D-070).
- **Link:** `<kipscope origin>/open#cases=<cases>`, at most `MAX_LINK_CHARS` (8,192) characters in all. The fragment never reaches a server log; the web posts it in a body (K10).
- **File and API:** the same string (signed or unsigned), or, in `none` mode, the plain JSON document. The CLI also accepts a CLI output whose `data` is a catalog document, so `kipscope case drives smart451 | kipscope case open -` works (K15).
- Telling the forms apart: three `.`-separated parts is a JWS (`isSignedCases`); a JSON object is a plain document; anything else is unsigned.

### K4: Verification and variables (pinned, `apps/server/src/caseSignature.ts`, `config.ts`, `.env.example`)

| Variable | Default | Rule |
|---|---|---|
| `KIPSCOPE_FINDER_JWKS` | unset | A JWKS file path, or an `https` URL (`http` only for a loopback host). Unset with identity ≠ `none`: every catalog open answers 503 `finder_not_configured`. |
| `KIPSCOPE_FINDER_ISSUER` | — | Required with `KIPSCOPE_FINDER_JWKS`; compared with `iss` exactly. |
| `KIPSCOPE_FINDER_AUDIENCE` | — | Required with `KIPSCOPE_FINDER_JWKS`; must be in `aud` (string or array). |
| `KIPSCOPE_FINDER_ALGS` | `EdDSA,ES256` | Subset of `EdDSA ES256 ES384 PS256 RS256`; `none` and `HS*` stop the server. |
| `KIPSCOPE_FINDER_USER_CLAIM` | `sub` | The claim compared with the signed-in user. |
| `KIPSCOPE_FINDER_MAX_AGE` | `1h` | CLI duration, 1 min … 1 d: the largest `exp − iat` accepted. |
| `KIPSCOPE_FINDER_ORIGINS` | empty | Comma list of `http(s)://host[:port]`; `origin.url` is kept only when its origin is listed. |
| `KIPSCOPE_CASE_DATAREF` | `{object}` | Template; must contain `{object}`. Any other value stops the server naming the variable. |
| `KIPSCOPE_CASE_PAD` | `60s` | CLI duration, 0 … 1 d: the pad when the catalog has none. |

A bad value of any of these stops the server with a message naming the variable (as every other variable does).

**Verification order** (`verifyCases(text, config, user)`; any failure refuses the whole catalog):

1. Length ≤ `MAX_CASES_TEXT`, else 400 `invalid_catalog`.
2. Form (K3). Identity ≠ `none` and not a JWS: 403 `signature_required`.
3. JWS (any identity when `KIPSCOPE_FINDER_JWKS` is set; in `none` mode without it the payload is inflated unverified): `jose.compactVerify` with the JWKS (local set from the file; for a URL a remote set that refetches on an unknown `kid` at most every 30 s) and `algorithms = KIPSCOPE_FINDER_ALGS`. Then inflate with `maxOutputLength = MAX_CASES_JSON`, JSON-parse, and check: `iss` exact, `aud` contains the audience, `iat` and `exp` numbers, `exp > now − 30 s`, `iat < now + 30 s`, `exp − iat ≤ KIPSCOPE_FINDER_MAX_AGE`. A failure answers 403 `invalid_signature` with `reason` one of `bad_signature`, `unknown_key`, `algorithm`, `expired`, `not_yet_valid`, `lifetime`, `issuer`, `audience`, `malformed`. A JWKS that cannot be fetched and has never loaded answers 503 `finder_keys_unavailable`.
4. User (identity ≠ `none`): the claim `KIPSCOPE_FINDER_USER_CLAIM` must equal `userOf(request).identity.user`, else 403 `wrong_user`. In `none` mode this check is skipped (there is one user).
5. Document: `CasesDocument` (K2) plus `current < cases.length`, each `to − from ≥ MIN_SPAN_NS`, `from ≤ anchor ≤ to`, at most `MAX_CASE_META` meta keys, `pad` a duration in 0 … 1 d, each `caseDataRef` a valid data ref (non-empty, no `/`, ≤ 128 characters). A failure answers 400 `invalid_catalog` whose message names the first bad path (`cases[3].to: must be after from`).

The token-like string is never logged; a refusal is logged at debug level with its reason and the `kid`.

### K5: Grant and mapping

- Each entry's data ref is `caseDataRef(KIPSCOPE_CASE_DATAREF, object)` (Jan Q7 „ja": the VIN as KI.ping sends it, configurable by a template).
- After a successful check the server creates the workspace (add-multiuser's store), calls `grantObjects(workspaceId, dataRefs)` with the catalog's unique data refs, and only then builds the workspace content (K9). In `none` mode the grant is already `all`; the call is still made (it changes nothing), so one code path serves both.
- The route declares no `dataRefs` for `open.cases` (the signature is the access decision for those objects); data refs of a `view` or of the user's layout outside the catalog's are left out of the new workspace (warning), so the new workspace never names a data ref its grant lacks.
- Rights have no time part (D-086 Q12): the grant names vehicles, so stepping, preload and Unlink need no further check than the guard's.

### K6: Case state and commands (pinned semantics, `packages/shared/src/apply.ts`)

The catalog's entries live in the server's catalog file (K10) and in `GET /api/case`, not in `Workspace`: 2,000 entries are about 600 KB, and every state push carries the whole workspace. `Workspace.case` holds the K2 `WorkspaceCase` (about 1 KB).

| Command | Needs | Effect | Refused |
|---|---|---|---|
| `case.go {index}` | `ctx.case.alignAt` | Target entry `E = ctx.case.entry(index)`. Offsets: linked: each timeseries window's range − `alignAt`; unlinked: `linkedRanges` (a window without one gets the target's whole scope). If `E.dataRef` differs from the scope's data ref, signals move (K8). Each range = offset + new `alignAt`, clamped into `caseScope(E, pad)` (`clamped` when moved). Cursors: `t − alignAt + newAlignAt`; one outside the new scope is dropped. Then `scope = caseScope(E, pad)`, `current = index`, `linked = true`, `alignAt` = the new point, `linkedRanges` and `scope.object` removed, `entry = E`. Result `missing` and `alignFallback` as resolved. | `no_case`; `case_end` (index ≥ count) |
| `case.step {by}` | as `case.go` | `case.go {index: current + by}` | `no_case`; `case_unlinked`; `case_end` (no previous or next) |
| `case.unlink` | `ctx.case.extent` | `scope = {dataRef, from: min(extent.from, scope.from), to: max(extent.to, scope.to), object: true}`; `linkedRanges` = each timeseries window's offsets from `alignAt`; windows and cursors unchanged; `linked = false`. | `no_case`; `case_unlinked` |
| `case.align {align, at?}` | `ctx.case.alignAt` unless `at` | `align` stored; `alignAt` = `at` (must lie in the scope, else `out_of_scope`), else the server's point. Windows and cursors unchanged. | `no_case`; `case_unlinked`; `no_matching_event` (event mode, no `at`, no match) |
| `scope.set`, `scope.clear` | — | — | `case_open` while `workspace.case` exists (Q-6 (a)) |

All other commands work as today inside the case's scope (the clamp rule of D-082 included). Every accepted case command is one revision. `view.open` from the Views menu in a case workspace keeps `workspace.case` and opens the view rebound to the current session's data ref with the session's scope (K8), so a view is a layout for the catalog.

### K7: Alignment (pinned)

- **Point of a session:** `start` → `from`; `end` → `to`; `anchor` → `anchor`, else `from` with fallback; `event` → the first event matching `align.event` in the session's padded scope (`firstMatch`), else `from` with fallback (Q-1 (a)).
- **Matching:** `kind`, `source` and `name` equal; `text` equal only when the match has one. `eventMatchOf` sets `text` only for category `change` (a state change to `KEYON` matches only changes to `KEYON`).
- **What moves on a step:** every timeseries window range and cursor keeps its offset from the alignment point; spans are kept; the clamp rule applies at the new scope's edge. Windows, signals, heights, display modes, Diff, the event filter, the events line and `linkTime` stay. A values window has no range and stays as it is.
- **"Align to this event"** (UI): sends `case.align {align: {mode: "event", event: eventMatchOf(e)}, at: e.t}`, so the event clicked is the point in this session; later steps use the first match.
- **Zoom history** (web, `apps/web/src/chart/zoom.ts`): kept per catalog index in memory; a step does not push an entry; stepping back to a session restores its history. Lost on reload.

### K8: Signals on another vehicle (Q-3 (a))

- The scope's data ref before the step is `from`, the target's is `to`. Every window assignment, every `colors` key and every events-line signal whose data ref is `from` becomes `rebindSignalId(id, to)`; assignment IDs and colour indexes stay. Signals of other data refs stay as they are (they already showed `out_of_scope`).
- The target's signal list is loaded before the step applies (K9), so `missing` lists the rebound IDs it lacks. These stay in their windows; their series answer 404 `unknown_signal`, which the window shows as `not in this session` (K14). Stepping back to a vehicle that has them draws them again.
- The same rule opens a `view` or the user's layout onto the current session's data ref: the source's data ref is the view's `viewScope` data ref (first timeseries window's first signal), or the layout workspace's scope data ref; signals of any other data ref are left out with a warning.

### K9: Server flow (pinned, `apps/server/src/case.ts`, `routes/case.ts`, the workspaces route, `routes/workspace.ts`)

**Open** (`POST /api/workspaces {open: {cases}}`, level `user`):

1. `verifyCases` (K4) → entries normalised (K2), `catalogId` drawn.
2. Create the workspace for the requester (limits as add-multiuser), `grantObjects(id, dataRefs)` (K5).
3. Layout: `view` given → the requester's saved view by name, or the inline document, rebound (K8); its windows show the current session's whole scope (`caseScope`), since a view holds no alignment point. No `view` → the requester's most recently active own workspace with at least one window (Q-2 (a)), rebound (K8); each timeseries window keeps its offset from that workspace's `case.alignAt` when it had a case, else shows the whole scope. Neither → empty.
4. Load the current session's scope list (`catalogs.load`), resolve its alignment point (events of that scope for event mode), and build the workspace with the pure `openCase(input)` (below). A list that fails answers 503 `catalog_unavailable`, and the new workspace is deleted.
5. Write the catalog file `<stateDir>/workspaces/<id>.cases.json` (`{kipscope: "case-catalog", version: 1, catalog: CaseCatalog}`, atomic, once; deleted with the workspace; a bad file at start drops `workspace.case` with one warning).
6. Answer `CreateWorkspaceAnswer` with `case: CaseOpenReport`.

```ts
export interface OpenCaseInput {
  catalog: CaseCatalog; current: number; pad: bigint; align: CaseAlign;
  alignAt: string; alignFallback?: boolean;
  layout?: Workspace;              // already rebound (K8)
  layoutAlignAt?: string;          // set when the layout workspace had a case
  known: (signalId: string) => boolean;
}
export function openCase(input: OpenCaseInput): { workspace: Workspace; missing: string[] }; // packages/shared/src/caseApply.ts (task 1.2)
```

**Case commands** on `POST /api/commands`, before `execute`:

- `case.go`, `case.step`: target `E` (refuse `no_case` / `case_end` without loading); `catalogs.load(caseScope(E, pad))` (503 `catalog_unavailable` leaves the workspace unchanged, as `scope.set`); the alignment point of `E` (event mode: the events of that scope through the events cache, unfiltered, events-line signals rebound); then execute with that list's context and `ctx.case`.
- `case.align` without `at`: the point in the current session, as above.
- `case.unlink`: the vehicle's extent from `objectExtent(dataRef)` (K11); a source failure answers 502 `source_error` with the workspace unchanged. No list is loaded first (K11, lazy).
- `dataRefsOfCommand` for the guard: `case.go`/`case.step` the target's data ref; `case.unlink` and `case.align` the scope's. All lie in the grant.

Server interfaces between the server tasks (pinned):

```ts
// apps/server/src/case.ts (task 2.1)
export interface FinderConfig { jwks?: string; issuer?: string; audience?: string; algs: string[]; userClaim: string;
  maxAgeNs: bigint; origins: string[]; dataRefTemplate: string; padNs: bigint }
export class CaseOpenError extends Error { constructor(readonly code: string, readonly status: number, message: string, readonly reason?: string) }
/** K4 steps 1–5; throws CaseOpenError. `user` undefined in none mode. */
export function readCases(input: string | Record<string, unknown>, config: FinderConfig, identity: "none" | "other",
  user: string | undefined, now?: () => number): Promise<{ catalog: CaseCatalog; current: number; pad: bigint;
  align: CaseAlign; view?: string | Record<string, unknown>; warnings: string[] }>;

// apps/server/src/objectScope.ts (task 2.3)
export class ObjectExtents {
  constructor(source: DataSource, options?: { ttlMs?: number; max?: number; now?: () => number }); // 5 min, 64
  /** [first row, last row + 1 ns) of the data ref; one refExtent with {dataRef, TIME_MIN, TIME_MAX}; single-flight. */
  get(dataRef: string, abort?: AbortSignal): Promise<{ from: bigint; to: bigint }>;
}
/** Parses and checks a work window for an object scope (400 invalid_request texts of K10/K11); undefined outside one. */
export function workWindowOf(query: { from?: bigint; to?: bigint }, scope: WorkspaceScope | undefined): { from: bigint; to: bigint } | undefined;
```

### K10: Routes and payloads (pinned)

| Route | Level | Query or body | Answer |
|---|---|---|---|
| `POST /api/workspaces` | user | `{open: {cases}}` (K2) | 200 `CreateWorkspaceAnswer` + `case`; 400 `invalid_catalog`; 403 `signature_required`, `invalid_signature` (`reason`), `wrong_user`; 503 `finder_not_configured`, `finder_keys_unavailable`, `catalog_unavailable`; add-multiuser's limit code |
| `GET /api/case` | workspace (open right) | — | `CaseCatalog`; 404 `no_case` |
| `GET /api/case/preview` | workspace | `index` (int ≥ 0) | `CasePreview`; 404 `no_case`; 400 `invalid_request` (index ≥ count). Also warms that session's list, density, gap info (the workspace's window and events-line signals, rebound) and events, in the request's class, one after another; warm work of an aborted request that has not started is dropped, running queries finish (D-081: no preemption). |
| `GET /api/series`, `GET /api/extent` | workspace | new optional `case` (int ≥ 0) | bounded by `caseScope(entry, pad)` of that entry instead of the workspace scope; a signal of another data ref answers 409 `out_of_scope`; 404 `no_case`; 400 `invalid_request` (index ≥ count) |
| `GET /api/density` | workspace | new optional `from`, `to` (both or neither) | with them: density over `[from, to) ∩ scope` (bars, grid, drives by today's rules over that span); in an object scope without them: coarse (K11) |
| `GET /api/gaps`, `GET /api/events` | workspace | `from`, `to` | required in an object scope (K11); `/api/gaps` refuses them outside one (400 `invalid_request`, one meaning per parameter) |

`X-KIPscope-Class: preload` (`CLASS_HEADER`) on `/api/series`, `/api/extent` and `/api/case/preview` runs the request's source work under `withPriority("preload")`; any other value, or the header on another route, is ignored (the request stays `interactive`). New `ApiError` codes: `invalid_catalog` (400), `signature_required`, `invalid_signature`, `wrong_user` (403), `no_case` (404), `finder_not_configured`, `finder_keys_unavailable` (503). `commandStatus` maps `no_case`, `case_end`, `case_unlinked`, `case_open`, `no_matching_event` to 422.

### K11: Unlink without a bound for the user, and without an unbounded query (D-086)

The object scope is `[first row, last row + 1 ns)` of the vehicle (widened to keep the session left inside it). It is a normal scope for every rule of D-082: ranges and cursors are clamped into it, every source call carries it. What changes is the work that today covers "the whole scope" (add-scope Z9), because on a vehicle with a year of rows that would be a year-long scan for every page view. In an object scope each route covers only what is shown:

| Work | Linked or plain scope (today) | Object scope |
|---|---|---|
| Extent | — | `objectExtent(dataRef)`: one `refExtent(dataRef, {dataRef, TIME_MIN, TIME_MAX})` at Unlink, cached per data ref for 5 min (the D-068 recount period), LRU 64. The only call bounded by data ref alone; measured as M1. |
| Series (`/api/series`) | range ∩ scope, bucketed by zoom | unchanged: the asked range ∩ scope at 1,024–2,048 buckets, raw only when zoomed in. A whole-vehicle view costs as many points as an hour's. |
| Strip bars (`/api/density` without `from`/`to`) | one `refBuckets` on the drive grid over the scope | **coarse:** one `refBuckets(dataRef, width, false, scope)` at the bar width (≤ 120 buckets), no grid query, `drives: []`, `coarse: true`; cached per scope key. Measured as M2. |
| Strip drives (`/api/density?from&to`) | — | **detail:** density over the work window: bars, grid and drives by today's rules; cached per (scope key, window), LRU 8. Measured as M3. |
| Gap info (`/api/gaps?from&to`) | whole scope | the work window only: `loggerGaps` and periods with the window as their scope; cached per (scope key, window), LRU 8; the 5-min poll counts only the held windows' rows. Measured as M6. |
| Events (`/api/events?from&to`) | whole scope, then `from`/`to` | the work window only, the first row a `snapshot` as for a scope; cached per (scope key, window), LRU 8. Measured as M7. |
| Value (`/api/value?t`) | gap info of the scope | gap info of `workWindow([t, t + 1 ns), scope)`. |
| Signal list (`/api/catalog`, command checks) | the scope's list, loaded before the command | **lazy:** the last linked session's list at once, `partial: true`; the vehicle's own `listSignals(objectScope)` loads in the `background` class and replaces it when done. Measured as M4. |

**Work window** (pinned, `workWindow(view, scope)` in `case.ts`): `half = max(view.to − view.from, DAY_NS)`, capped at `WORK_HALF_MAX_NS`; `[view.from − half, view.to + half)`; if wider than `WORK_SPAN_MAX_NS − 2 · DAY_NS`, the window of that width centred on the view; `from` floored and `to` ceiled to whole UTC days; intersected with the scope. So a 10-minute view asks for 3 days, a 3-day view for 9 days, any longer view for at most 32 days. The web uses the bar target's range as `view` and asks again only when that range is no longer inside the window it holds; day edges keep the key stable while panning. The routes refuse a window wider than `WORK_SPAN_MAX_NS` (400 `invalid_request`).

**What the user sees** (K14): the strip spans the whole vehicle with coarse bars, the drive row shows the work window's drives and the catalog's sessions of this vehicle as marks, the events list and pins show the work window's events (`nearby`), and charts draw whatever range they are zoomed to. Nothing in the UI stops at a time limit.

**Measurement and fallbacks** (task 7.6, K17): if a query misses its goal by more than 2× on the emulator, the lead reports it to Jan with the named fallback; none is built in this change.

| # | Query | Goal (median of 3, after one warm-up) | Fallback if too slow |
|---|---|---|---|
| M1 | object extent | ≤ 2 s | F1: the object scope is `[now − KIPSCOPE_OBJECT_RETENTION, now)` with no extent query (Q-5 (a)), or the finder sends the extent (Q-5 (b)) |
| M2 | coarse density, ≤ 120 bars | ≤ 5 s | F2: no bars for an object scope; the strip shows marks and the work window's drives only |
| M3 | detail density, 32 d | ≤ 3 s | F3: `WORK_HALF_MAX_NS` 15 d → 4 d (window ≤ 10 d) |
| M4 | vehicle signal list | ≤ 10 s (background) | F4: no vehicle list; the list stays the union of the visited sessions' lists (`partial`) |
| M5 | series, 2,048 buckets over the whole extent, one signal | ≤ 5 s | F5: a window wider than 31 d shows `Zoom in to draw curves` and sends no series query; navigation stays unbounded |
| M6 | gap info, 32 d | ≤ 5 s | F3 |
| M7 | events, 32 d | ≤ 2 s | F3 |

Every fallback keeps D-086: the user can still go anywhere in the vehicle.

### K12: Web cache across scopes (`apps/web/src/chart/cache.ts`, `rescope.ts`, `overview.ts`, `gaps.ts`)

- **No clear on a scope change.** `enterScope` keeps the tiles; it only switches which per-scope stores answer.
- **Store rule:** a tile fetched under scope `S` is stored only when `[tile.from, tile.to) ⊆ S` (no scope: always). A raw tile without `before` records `cutFrom = S.from`, without `after` `cutTo = S.to`.
- **Use rule:** under scope `S'` a stored tile answers only when it lies inside `S'`, and, for a cut raw tile, when `S'.from ≥ cutFrom` (and `S'.to ≤ cutTo`): a wider scope may hold an earlier or later point. Otherwise it is fetched again.
- **In flight:** runs are keyed by tile ID and scope key, so a run under one scope never answers another.
- **Per-scope stores:** signal extents (`overview.ts`) and gap info (`gaps.ts`, keyed in an object scope by data ref and work window) are kept for the 4 most recent scope keys, least recently used dropped (the server keeps 4 scope lists too, add-scope Z10).
- The weight limit (`CACHE_LIMIT` 4 M), LRU, fresh-margin and failed-tile rules are unchanged. "Windows load again on a scope change" (time-navigation) still holds: every window asks again, and the cache answers what it may.

### K13: Neighbour preload (`apps/web/src/preload/`, server K10)

- **When:** the workspace has a linked case; the tab's last render acknowledgement for the current revision was `complete`; no visible load is in flight; then 500 ms without a gesture (`PRELOAD_DELAY_MS`).
- **What, in order:** the next entry, then the previous one (catalog order, D-085). For each: `GET /api/case/preview?index=j` with `X-KIPscope-Class: preload` (the server warms list, density, gaps, events, K10); then, with `caseRanges` (the same pure function `case.go` uses: offsets from `alignAt` onto the preview's `alignAt`, clamped to its scope) and `rebindSignalId`, the tiles each timeseries window will request at the level it will draw, fetched through the cache with `case=j` and the class header, cache priority `preload`.
- **Queue:** `preload` ranks below `prefetch` in the cache and shares its `PREFETCH_IN_FLIGHT` (2) slots; a visible load never waits for either and takes over a waiting preload run for the same tile.
- **Budget:** at most `PRELOAD_BUDGET` = 25 % of `CACHE_LIMIT` (1,000,000 weight units) preloaded since the last step; the preload stops before a run that would pass it. Preloaded tiles are ordinary LRU tiles.
- **Cancel:** any pointer down, wheel, or key press (other than a lone modifier) in the page, any command this tab sends, and any state push with a new revision abort every preload request (fetch abort) and the preview; tiles already stored stay. The preload starts again after the next settle.
- **Not preloaded:** overview tiles and extents (small, loaded after the step); the neighbours of neighbours.

### K14: Web UI (`apps/web/src/case/`, `time/*`, `events/*`, `explorer/*`, `keys.ts`, `App.tsx`, start-up, `filedrop.ts`)

- **Start-up:** `/open#cases=<code>` → `POST /api/workspaces {open: {cases: code}}` → `history.replaceState` to `/w/<id>` (no second load). A failure shows the gate page `Could not open the sessions` with the server's code and message and the button "My latest workspace". The web server serves `index.html` for `/open` (add-multiuser's fallback). A dropped file holding a catalog document or a JWS does the same `POST`, then `location.assign("/w/<id>")`.
- **Session bar** (strip head, replaces `SCOPE … Widen Clear` while `workspace.case` exists; one line; the strip stays ≤ 56 px):
  - Linked: `SESSION ‹ <title or object> · <kind> · <local from> – <local to> (<duration>) · <up to 3 meta "key value"> › <k> / <n> ▾ Unlink Align: <mode> ▾`. Meta numbers use the number format (3 significant digits). The tooltip of the text lists every meta entry, the id and the origin tool; `origin.url` (kept only for a listed origin) is a link `Back to <tool>`.
  - `‹` and `›` take their space always and show on hover and focus within the bar; disabled at the first and last entry; tooltip `Previous: <title or object> · <local from> ([)` / `Next: … (])`. A click sends `case.step`.
  - Unlinked: `VEHICLE ‹ › <title or object> · whole series · <local from> – <local to> (<span>) Link`, the arrows greyed and disabled (`Link first`). **Link** sends `case.go {index: current}`.
  - **Catalog list** `k / n ▾`: a popover with a filter field (focused on open), one row per entry: `<k> · <kind> · <title or object> · <local from> · <duration> · <first 2 meta>`, the current row marked; at most `CASE_LIST_ROWS` rows, then `… <m> more: type to filter`. The filter matches, case-insensitively, a substring of title, object, kind, id, local start text or a meta value. Enter goes to the first match, a click to that row (`case.go`), Escape closes.
  - **Align menu:** `Session start`, `Session end`, `Anchor from the finder` (disabled with the tooltip `No session in this catalog has an anchor` when none has one), and, in event mode, the checked item `Event: <source> <name> <text>`.
  - Messages (the existing message line) after a case command result: `clamped` → `Stopped at the session edge. Unlink shows the whole vehicle.` (linked) or `Stopped at the end of the vehicle's data.` (object scope); `alignFallback` → `No <name> in this session; aligned to its start.` (event) or `No anchor in this session; aligned to its start.`; `missing` → `<n> signal(s) not in this session: <first 3 shown names>` (`1 signal`, `2 signals`; `, …` when more). A refusal shows its code and message as today.
- **Keys:** outside text fields and selects, without Ctrl, Meta or Alt: `[` sends `case.step {by: -1}`, `]` `{by: 1}`, only while linked and not at that end (nothing sent otherwise). Listed in the Keys tab (`shortcuts.ts`).
- **Strip in an object scope:** coarse bars over the scope; the label `<shown> of <span> recorded · 1 bar = <width>`; the drive row shows the work window's drives (detail density) and the catalog entries whose data ref is the scope's as marks: accent (`--accent`) segments ≥ 4 px wide, hit width ≥ 8 px, drawn over drives and hit first, the session left with Unlink outlined; tooltip `Session <k> of <n> · <kind> · <local from> – <local to> · <title>`; a click sends `case.go {index: k − 1}`. Drive keys `,` `.` step through the work window's drives. Pins show the work window's events.
- **Events panel in an object scope:** asks `/api/events` with the work window; the switch reads `In view | Nearby`; the strip head count reads `<shown> of <total> events nearby`, tooltip `Events within <span of the work window> around the view`.
- **Align to this event:** a context menu on a strip pin (one item `Align sessions to this event`) and a row action `Align` (shown on hover and focus) in the events list, both only while linked; for a pin of several events the first one.
- **Explorer:** while the catalog answer has `partial`, a note `Signals of session <k>; the vehicle's full list is loading` above the list, and a reload every 10 s until it is not partial.
- **Window error line:** a signal answering 404 `unknown_signal` in a case workspace reads `not in this session`.

Web API functions (pinned, `apps/web/src/api.ts`, task 3.1; other web tasks import them):

```ts
export function fetchSeries(r: SeriesRequest & { case?: number; preload?: boolean }, abort: AbortSignal): Promise<SeriesResult>;
export function fetchExtent(signalId: string, options?: { case?: number; preload?: boolean; abort?: AbortSignal }): Promise<Extent>;
export function fetchDensity(dataRef: string, signal?: AbortSignal, range?: TimeRange): Promise<Density>;
export function fetchGaps(dataRef: string, signals: readonly string[], abort?: AbortSignal, window?: TimeRange): Promise<GapInfo>;
export function fetchEvents(dataRef: string, signals: readonly string[], abort?: AbortSignal, window?: TimeRange): Promise<EventList>;
export function fetchCase(abort?: AbortSignal): Promise<CaseCatalog>;
export function fetchCasePreview(index: number, abort: AbortSignal): Promise<CasePreview>; // always with the preload header
export function openCases(cases: string | Record<string, unknown>): Promise<CreateWorkspaceAnswer>;
```

`preload: true` adds `X-KIPscope-Class: preload`; `case` adds `case=<n>`. Existing callers keep their current arguments.

### K15: CLI (`apps/cli/src`)

| Form | Sends | Prints |
|---|---|---|
| `case open FILE` \| `case open -` | `POST /api/workspaces {open: {cases}}`: the file's text trimmed; a JSON object is sent as the document, a CLI output's `data` as the document, anything else as the string | `data: CreateWorkspaceAnswer`, `local.url` `<server>/w/<id>` |
| `case show` | `GET /api/workspace` | `data: WorkspaceCase`, `local: {position: "<k> / <n>", from, to}` (local times); without a case exit 1 `no_case` |
| `case next` \| `case prev` | `case.step {by: 1 \| -1}` | the command result (`--wait` as for every command) |
| `case go N` | `case.go {index: N − 1}`; N an integer ≥ 1, else exit 2 `usage` | the command result |
| `case link [N]` | `case.go {index: N − 1}`, without N the workspace's `case.current` | the command result |
| `case unlink` | `case.unlink` | the command result |
| `case align start\|end\|anchor` | `case.align {align: {mode}}` | the command result |
| `case align event KIND SOURCE NAME [TEXT]` | `case.align {align: {mode: "event", event}}` | the command result |
| `case url FILE` \| `-` | nothing | `local.url` `<server>/open#cases=<code>`: a JWS as it is, a document via `encodeCasesLink`; longer than 8,192 characters: exit 2, `error.code` `link_too_long` |
| `case drives REF` | `GET /api/density?dataRef=REF` | `data: CasesDocument` with one entry per drive: `id` `<REF>\|drive\|<from ISO>`, `object` REF, `kind` `driving`, `from`, `to`, `title` `Drive <k>`, `meta {rows}`; no drive: exit 1 `no_data` |

Positions are 1-based in the CLI and the UI (`3 / 17`), `index` and `current` 0-based in JSON. `case drives` is a dev aid (D-086 Q8): it reads the strip's drives (D-057) under the call's workspace scope, so it needs full mode or a workspace whose scope is on REF; its objects map to REF only with the default template.

### K16: Documents

- **`docs/handoff.md` (new, for KI.ping's implementers):** the payload (every key of K2 with type and meaning), the KI.ping field mapping (`session_id` → `id`, `device_id` → `object`, `session_type` → `kind`, `t_start`/`t_end` → `from`/`to`, `finas_id` → `title`, `a_<name>` → `meta`), the order rule (D-085), the signature (K3: header, deflate-raw payload, claims, lifetime ≤ `KIPSCOPE_FINDER_MAX_AGE`, 10 min recommended), a Node example with `jose` (`CompactSign` over `deflateRawSync(JSON)`), publishing the JWKS (file or URL, rotation by `kid`), the link and its 8,192-character limit (trim the catalog around `current`, keep the order; more sessions: file or API), opening it with `target="kipscope"`, and the errors a user may see.
- **`docs/http-api.md`:** the K10 routes, parameters, header and codes (the route-documentation test covers them).
- **`docs/manual.md`:** "Sessions from KI.ping": the bar, stepping, keys, Align, Unlink and Link, marks, the catalog list.
- **README:** the variables of K4 and the `case` forms.

### K17: Measurement (task 7.6)

- **Data:** `apps/server/scripts/seed-long.ts` (`pnpm --filter @kipscope/server seed:long`, flag `--adx` for the emulator) writes the data ref `longcar`: 400 days ending 2026-10-01T00:00:00Z, one drive a day 08:00–10:00 UTC, 20 signals `Long_900h.S00` … `S19` at 1 Hz (57.6 M rows), one DTC a day at 09:00 in the events table; generated inside the database (`INSERT … SELECT … FROM numbers()`; `.set-or-append … <| range`), so no rows cross the network. `--days`, `--signals`, `--hz` scale it down when the emulator cannot hold it; the script prints the rows written.
- **Run:** `apps/server/scripts/measure-object.ts` (`pnpm --filter @kipscope/server measure:object -- --source clickhouse|adx --ref longcar`) runs M1–M7 through the server's own source and query code (not raw SQL), one warm-up then three timed runs each, and prints one line per query `M<n> <name> <median ms> goal <ms> <ok|over|2x over>` plus the row count. It always exits 0: goals are reported, not gates. The pacer copies the two tables into `rounds.md`.

## Test fixtures (pinned for the tester)

- **Catalog C4** (times 2026-10-01 UTC, test DB; pad 60 s):

| index | object | kind | from | to | extra |
|---|---|---|---|---|---|
| 0 | `testcar` | `driving` | 01:00:00 (`1790816400000000000`) | 01:10:00 (`1790817000000000000`) | `meta {distance_km: 6.2}` |
| 1 | `othercar` | `driving` | 00:00:00 (`1790812800000000000`) | 00:00:01 (`1790812801000000000`) | — |
| 2 | `testcar` | `charging` | 04:50:00 (`1790830200000000000`) | 05:10:00 (`1790831400000000000`) | `anchor` 04:55:00 (`1790830500000000000`) |
| 3 | `testcar` | `idle` | 04:58:00 (`1790830680000000000`) | 05:02:00 (`1790830920000000000`) | — |

  The 9 DTCs at 05:00:00 (`sdlog.events`, device `test-diag`) lie in entries 2 and 3, not in 0. `othercar` holds only `Fast_100h.SIG_A`.
- **Keys:** an Ed25519 and a P-256 key pair made in the test, served as a JWKS file and by a local JWKS server (reuse `apps/server/test/jwks.ts`); identity by the example forward-header module with users `alice` and `bob`.

## Questions for Jan

In proposal.md "Open questions for Jan" (Q-1 … Q-6), each with a recommended answer; specs and tasks are written for the recommended answers.

## Spec owner's defaults (Jan can veto)

- JWS payload compressed (deflate-raw) inside the signature, so the link is base64url once (K3).
- `exp − iat` at most 1 h (`KIPSCOPE_FINDER_MAX_AGE`), clock tolerance 30 s, as add-multiuser's tokens.
- In `none` mode a JWS is verified when keys are configured and read unverified otherwise; the `sub` check is skipped (one user).
- Each open is a new workspace; the catalog cannot be changed after the open.
- A view in the payload opens at the whole session; offsets carry over only from a workspace that had a case.
- `case.step` never wraps around; the arrows and keys do nothing at the ends.
- Work window: ±1 view span, at least ±1 day, at most 32 days, on whole UTC days.
- `scope.object` is part of the scope key.
- Preload: 500 ms after settle, next before previous, 25 % of the cache, any gesture cancels.
- CLI and UI positions 1-based, JSON indexes 0-based.
- `case drives` prints a document instead of opening it, so it can be piped, saved or edited.

## Numbers: what if off by a factor of two

| Number | Value | At ×½ | At ×2 |
|---|---|---|---|
| Sessions per catalog | 2,000 | 1,000: a long KI.ping result list needs two files | 4,000: a 1.2 MB catalog file per workspace; the list popover still renders 500 rows |
| Link length | 8,192 chars (D-070) | about 100 sessions per link | some browsers and proxies cut URLs near 16 k; the fragment is not sent to servers, so only the browser limit matters |
| JWS lifetime | ≤ 1 h | 30 min: a link left in a tab over lunch fails sooner; the user clicks again in KI.ping | 2 h: a leaked link works longer, but only for its `sub` |
| Pad | 60 s (KI.ping `pad_s`) | 30 s: less context at the edges | 2 min: a 10-min drive's scope grows by 20 % |
| Work window | 3 × view, ≥ 3 d, ≤ 32 d | more requests while panning; drives and events cover less around the view | 64 d of gaps and events on ADX per page view; M3, M6, M7 decide |
| Object extent cache | 5 min | more extent queries on repeated Unlink | new rows show up later in the extent |
| Server LRUs (detail, gaps, events) | 8 windows each | panning back and forth refetches sooner | a few MB more memory |
| Web per-scope stores | 4 scopes | stepping 3 back refetches extents and gap info | negligible memory |
| Preload budget | 25 % of 4 M | two neighbours of 8 windows may not fit | preloads could push out tiles of the current session |
| Preload delay | 500 ms | preloads start during a short pause between gestures and are cancelled more often | the user may step before the next session is ready |
| Catalog list rows | 500 | more typing to find a row | a slower popover on old laptops |
| Partial-list reload | 10 s | twice the requests while the vehicle's list loads | the full list shows up to 10 s later |
| Measurement goals | M1 2 s … M5 5 s | stricter: more fallbacks reported | looser: a slow Unlink goes unreported; the 2× rule still flags it |
| `longcar` | 57.6 M rows | still above every real session; may hide a scan cost | the emulator may not hold it; scale flags |

## Security

- **Only KI.ping grants:** on a server, an unsigned catalog is refused (`signature_required`); a signed one widens the grant only by its own objects (K5). A `view` or layout never adds a data ref the grant lacks.
- **Signature checks:** an allow-list of algorithms (never `none`, never `HS*`, so a public key cannot serve as an HMAC secret), the issuer exactly, the audience, `exp`, `iat` and the lifetime, keys from a file or `https` only.
- **Bound to the user:** the claim must equal the signed-in user; a forwarded link fails with `wrong_user`. A replay by the same user only opens another workspace with the same rights.
- **Inflate bomb:** inflating stops at `MAX_CASES_JSON`; the string length is checked before.
- **No leaks:** the JWS is never logged or echoed; refusals name a reason, not the token. `origin.url` is kept only for a listed origin, so a link cannot place an arbitrary "Back to" target.
- **Origin check** (add-multiuser M10) stops a cross-site page from posting a catalog with the user's proxy cookie.
- **Grant lifetime:** the grant lives as long as the workspace (D-086 Q12: no time part); sharing never widens it (add-multiuser).
- **Not covered:** revoking a grant after KI.ping withdraws a right (the workspace keeps it until it is deleted or idles out); an IdP round trip that drops the fragment (the user clicks again).

## Risks / Trade-offs

- [The extent query (M1) scans a vehicle on ADX] → measured first; fallback F1 needs no extent query (Q-5).
- [The vehicle's signal list never finishes on ADX] → it runs `background` and the session's list serves meanwhile; fallback F4.
- [A whole-vehicle series view is slow] → it is what the user asked to see and runs as one bucket query per signal; fallback F5 keeps navigation unbounded.
- [Rebinding by name meets a vehicle with other signal names] → reported as `missing`, kept in place; signal books (`add-signal-books`) map names later.
- [Many workspaces from many KI.ping clicks] → add-multiuser's per-user limit and idle cleanup; each is cheap (the catalog file is small for ordinary lists).
- [Kept tiles of an old scope use memory] → the 4 M weight LRU drops them first.
- [Preload competes with the user's own queries] → `preload` is the lowest class, one slot stays for `interactive` (D-081), and any gesture cancels it in the tab.
- [The catalog file and the workspace file can drift on a crash] → the catalog file is written before the workspace's first state; a workspace whose catalog file is missing or bad loses `case` with a warning, and its windows stay.

## Migration Plan

No data migration: workspaces without `case` behave as today. Rollback: a server without this change drops the unknown `case` field of a restored workspace (tolerant reading) and ignores the catalog files.

## Fit with later changes

- `add-tile-store`: the K12 store and use rules become the rules of the IndexedDB level; its key is the K12 key plus user and server.
- `add-signal-books`: the payload gains `book`; K8's rebinding by name becomes book-driven.
- A live channel to KI.ping (`postMessage`) would send `case.go` for the clicked entry; the commands stay.

## Manual checks (lead)

- M1–M7 on ClickHouse and the Kusto emulator (task 7.6); any "2x over" goes to Jan with its fallback.
- A real KI.ping link once KI.ping signs (after `docs/handoff.md`); not testable here.

## Ledger entry on archive (proposed; the lead assigns the number)

"Case open conventions: signed catalog (JWS, deflate-raw payload, `sub` bound), grant by objects; `case.*` commands with alignment offsets and rebinding by name; object scope with work windows (≤ 32 d) for gaps, events and drives, coarse strip, lazy list; tiles kept across scopes; neighbour preload at 25 %; measurements M1–M7 and fallbacks F1–F5."
