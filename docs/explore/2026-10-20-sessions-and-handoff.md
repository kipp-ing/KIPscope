# Sessions and the handoff from a search tool (2026-10-20)

Exploration only. No app code was changed. It comes before `add-case-open`, and it asks Jan to decide how `add-multiuser` is cut before that change is archived.

## The problem, in Jan's words

> „ein externes tool wie [Suchtool] schickt einen session katalog, oder eine und die benachbarten sessions. die kann wie gewohnt genutzt werden. mit einem pfeil rechts links bei session metainfo bei hover hüpfe ich zur nächsten. … idealerweise wird auch der cache im browser sehr lange gehalten … dann gibt es noch eine "unlinked" session. einfach die zeitreihe für ein objekt. … mit "unlink" wird session rechts links grau und man bleibt im objekt.“

Read this way:

1. **Session.** A search tool (finder) hands over a catalog of sessions, or one session with its neighbours. A session is a section of recorded data of one object, such as a drive or a charge.
2. **Stepping.** KIPscope shows one session at a time. The top row carries the session's meta info, and on hover it shows ← and →, which step to the previous or next session in the catalog.
3. **Kept layout.** When stepping, the dashboard the user tuned stays as it is: windows, signals, and the alignment to an event. So every session shows the same moment.
4. **Caching.** Switching back and forth must not reload. The browser keeps data for a long time.
5. **Unlink.** "Unlink" leaves the session and keeps the user on the object's whole time series. The arrows turn grey.

## Root cause: "session" means two things

| | Jan, the search tool, D-078 | `add-multiuser` (code, UI, CLI) |
|---|---|---|
| A session is | a found section of data: one object, a time window, a kind, meta | a server-side workspace: owner, share level, `/s/<id>`, a state file |
| Created by | the finder (the search tool) | every new tab on `/`, "New session", every `#view=` link |
| User action | look at it, step to the next one | create, switch, share, delete it in a "Sessions" menu |

D-083 („jedes sesseion braucht rechte") meant the first kind: an opened case. `add-multiuser` built the second kind and named it "session" all the way from the UI down to the CLI (`session list|new|share|delete`, `--session`). The UI now shows a menu called "Sessions". Its entries are named after views or data sections, so they look like the finder's data sessions, but they are workspaces.

## What the app does today (smart451, 2026-10-20, dev server 7310/5173)

Pictures are in [2026-10-20-sessions/](2026-10-20-sessions/). They are cropped to the top rows, so no real signal names appear (D-077).

| # | Seen | Why it confuses |
|---|---|---|
| 1 | The Sessions menu is an unlabelled icon at 1000 px width ([1](2026-10-20-sessions/1-sessions-menu.png)). Its entries are "smart451 2026-10-13 14:30", "Before last open", "New session", "Speeds", "Before last open". | The entries look like data sessions but are workspaces. Two entries share a title. "New session" is both an entry and an action. |
| 2 | After a view is opened in a new workspace, the list holds two "Speeds" and two "Before last open" ([2](2026-10-20-sessions/2-sessions-menu-titles.png)). | A title comes from the view, not from the data, so the list cannot tell the entries apart. |
| 3 | The Views menu has "Copy link" ([3](2026-10-20-sessions/3-views-menu.png)); the Sessions menu has "Copy session link". | One link gives the receiver their own copy (`#view=`). The other puts them in the same live workspace. Nothing on screen says which is which. |
| 4 | Two tabs opened on `/` land in the same workspace (`/s/f006vy0ili` in both). A change in one tab shows up in the other. | Jan expects one tab per case. `/` and the CLI without `--session` serve the most recently active workspace, and that changes with every click. |
| 5 | Switching through the Sessions menu is a full page load (new document, 23 API calls, 11 series requests). | The tab's tile cache, overview and gap info are lost on every switch. |
| 6 | The scope row reads "SCOPE smart451 · 2026-10-12 01:00 – …", with Widen and Clear ([4](2026-10-20-sessions/4-scope-row.png)). After Clear the label turns to "TIME" and the strip shows 8.3 d ([5](2026-10-20-sessions/5-after-clear.png)). Back restores the range but not the scope ([6](2026-10-20-sessions/6-back-keeps-no-scope.png)). | Clear is one-way: no UI sets a scope again; only a view or `kipscope scope set` does. This is Jan's "unlink" with no way back. |
| 7 | `,` and `.` step through KIPscope's own drives, and only the bar target moves (Link axes off). | Today this is the only way to switch between data sections. It is KIPscope's own detection (D-060), it is per window, and it cannot step past the scope edge. |
| 8 | Every scope change clears the whole tile cache (`apps/web/src/chart/rescope.ts`, `enterScope`). | Even with no reload, going back to the previous session fetches everything again. |
| 9 | Widen multiplies the span by 3 per click, with no cap (`widenScope`). | On ADX a few clicks reach months, and D-082 wants every query bounded. |

**Not tested:**
- Share levels between two users (`Read-only` pill, 4403). This needs the example identity module on a second port.
- `#view=` links by clipboard.
- A real OIDC provider.
- The 1440 × 900 window: the browser stayed at 1000 × 470 in one tab and 1440 × 648 in the other.

To clean up, I deleted my own test workspace. Opening `/` also touched Jan's `4u5z1wl3vo` workspace, which only changed its last-active time.

## What a search tool provides

The search tool (finder) that finds sessions is a separate tool and out of scope of KIPscope. KIPscope relies only on what any such tool can hand over:

- **A session** has an opaque id, a vehicle (the object, usually a VIN, perhaps shown by a fleet number), a kind (such as a drive, a charge or idle time), a half-open window `[from, to)` in UTC, and meta values (attributes such as distance or energy).
- **The search tool decides** which sessions are in a list, in which order, and which vehicles a user may see. Per D-085 a catalog is any list, in any order, of any vehicles; neighbours are the previous and next list entries, nothing else.
- **The interface is all KIPscope defines:** the catalog document, its signature and the link ([handoff.md](../handoff.md)). How the search tool finds, stores, secures or deploys anything is its own business.
- **Signal names** of a search tool are not KIPscope signal IDs; mapping them belongs to `add-signal-books`.

## Terms (proposal)

| Term | Meaning | Where users see it |
|---|---|---|
| **Object** | One vehicle (VIN, shown by its fleet number) | session bar |
| **Session** | A section of one object's data, `[from, to)`, with kind and meta; the finder's meaning | session bar, ← →, `3 / 17` |
| **Catalog** | The ordered list of sessions handed over (for example the search tool's result list or a saved set) | the `3 / 17` menu |
| **Scope** | What KIPscope may query: data ref and `[from, to)`. Linked: session ± pad. Unlinked: the object's horizon | technical term (CLI, API); the UI shows the session bar instead |
| **Workspace** | The server-held state of one tab: windows, cursors, scope, catalog, owner, share level | the address `/w/<id>` and "Share" only |
| **View** | A saved layout (unchanged) | Views menu |

"Session" goes back to Jan's and the search tool's meaning, because that is how both tools and their users already speak. The server state becomes "workspace": the code already calls it `WorkspaceStore`, and the user never has to manage it. The word "case" (D-078) is not needed in the UI. In code it can stay for the handoff unit (`case.*` commands below would then be `session.*`; either way, one word per meaning).

## Recommended interface

### Push by link, no live control channel

The search tool sends the catalog itself, inside the link. KIPscope never calls the search tool.

```
https://kipscope.example/open#cases=<deflate-raw, base64url JSON>
```

**Why push by link:**
- The fragment never reaches a server or a proxy log. It travels as a single click and needs no CORS, no token and no shared host.
- After the handoff, KIPscope does not depend on the search tool at all. If the search tool is down, open workspaces keep working, ← → included.
- It is the same compression as `#view=` (D-070).
- Measured with realistic entries: 50 sessions take 1.9 k characters, 200 sessions 5.8 k. So up to 200 sessions fit the existing 8,192-character link limit. The search tool sends at most 200 rows around the clicked one; for more, it uses a file.

**One command for link, file and CLI** (D-078). The same JSON is `POST /api/workspaces {open: {cases}}`, which answers with the new workspace's address. The same document also works as a file (`kipscope case open cases.json`, or dropped on the window) and on the CLI (`kipscope case link cases.json` prints the link).

**No "active link" for now.** The search tool does not keep controlling an open KIPscope, and KIPscope does not ask the search tool for more sessions:
- With D-085 the search tool vouches for the user by signing the catalog (see Security), so no server-to-server channel acting as the user is needed.
- The catalog in the link already gives KIPscope what it needs to step.
- The search tool opens the link with `target="kipscope"`, so later clicks reuse the same KIPscope tab. That covers "click another session in the search tool, the KIPscope tab follows" without a channel. Each such click is one page load, which the persistent cache makes cheap.
- **Later, if wanted:** browser-side `postMessage` between the two tabs of the same user would give a switch without a reload, and highlighting of the current session in the search tool. No server would be involved; KIPscope accepts messages only from `KIPSCOPE_FINDER_ORIGINS`. A pull variant, `/open?set=<set id>&at=<n>` fetched by KIPscope's server, needs a read route for saved sets in the search tool and an authenticated route between the two hosts. That is only worth it when both run behind the same Ping proxy.

### Security

**Revised after D-085 (rights live in the search tool).** A plain link can be written by anyone, so KIPscope can only grant what the search tool signed:

- **Signed catalog.** The search tool's server signs the catalog as a JWS (EdDSA or ES256, its own key pair); the link carries `#cases=<JWS>`. KIPscope verifies it with the search tool's public key (`KIPSCOPE_FINDER_JWKS`, a file or URL). The signature adds about 100 characters; the 200-session estimate still fits.
- **Claims.** `iss` (the search tool), `aud` (this KIPscope), `sub` (the Ping user the search tool saw), `exp` (short, e.g. 10 min to open the link), and the catalog. The grant is exactly the sessions listed, plus, if the search tool allows it, each object's unlink horizon (`grant.objects: {VIN: {from, to}}`).
- **Bound to the user.** KIPscope accepts the link only if `sub` matches the signed-in user (same identity provider). A forwarded link does not open for someone else.
- **The grant lives in the workspace.** Once opened, the workspace's guard allows queries only inside the grant (data refs and windows), for as long as the workspace lives; stepping and preload need no further call to the search tool. Sharing a workspace never widens it: the receiver needs their own grant (D-084's rule, now with the search tool as the source).
- **Local `none` mode** stays as today: no login, unsigned catalogs accepted, everything visible.
- Each session's object becomes a data ref through KIPscope's own mapping (`KIPSCOPE_CASE_DATAREF`, default `{object}`).
- The payload is still validated by schema and size limits: at most 2,000 sessions by file or API, at most 8,192 characters by link.
- The link carries no credentials beyond the short-lived signed grant.
- `origin.url` ("back to the search tool") becomes a link only if it starts with a configured finder origin, so no link can point anywhere else.
- **Login caveat.** If the user is not signed in yet, an IdP round trip may drop the fragment. The user then clicks again in the search tool.

### Payload

```json
{
  "kipscope": "cases",
  "version": 1,
  "origin": { "tool": "search tool", "url": "https://finder.example/#f=…", "set": "set 7" },
  "current": 1,
  "pad": "60s",
  "align": { "mode": "start" },
  "view": "drive-dashboard",
  "cases": [
    { "id": "s-0001", "object": "TESTVIN0000000001",
      "kind": "driving", "from": "2026-10-13T09:07:03Z", "to": "2026-10-13T09:17:33Z",
      "title": "F-104 drive", "meta": { "distance_km": 6.2 } },
    { "id": "s-0002", "object": "TESTVIN0000000001",
      "kind": "charging", "from": "2026-10-13T10:02:11Z", "to": "2026-10-13T13:40:00Z",
      "title": "F-104 charge", "meta": { "energy_kwh": 11.8, "charge_mode": "ac" },
      "anchor": "2026-10-13T10:02:41Z" },
    { "id": "s-0003", "object": "TESTVIN0000000002",
      "kind": "driving", "from": "2026-10-13T14:30:00Z", "to": "2026-10-13T16:50:00Z" }
  ]
}
```

| Field | Meaning |
|---|---|
| `cases` | The catalog in the finder's order. The order defines neighbours. Sessions may belong to different objects; comparing one event across vehicles is a main use. |
| `current` | Index of the session to show first. A single session without neighbours is a catalog of one. |
| `id` | Opaque to KIPscope; shown and sent back unchanged. |
| `object` | Mapped to a data ref by KIPscope. |
| `from`, `to` | UTC, half-open. |
| `kind`, `title`, `meta` | Display only. |
| `anchor` | Optional time inside the session that alignment uses. |
| `pad` | Optional; added to both edges of the scope. |
| `view` | Optional layout: a saved view by name, or an inline view. Without one, the windows of the user's latest workspace are kept (D-080 signal books add `book` later). |

### Commands and routes

| Command (UI, CLI, HTTP) | Effect |
|---|---|
| `case.open {cases}` | Stores the catalog in the workspace and goes to `current`. |
| `case.go {index}`, `case.step {by: ±1}` | Sets the scope to session ± pad and moves every window and cursor by the alignment rule. No page load. |
| `case.unlink` | Sets the scope to the object's horizon; the catalog is kept and the arrows grey out. |
| `case.link {index?}` | Goes back to the current session, or to the one given. |
| `case.align {mode: start\|end\|anchor\|event, event?}` | Sets what stays fixed when stepping. |

| Route or CLI call | Purpose |
|---|---|
| `GET /open#cases=…` | Start-up path; creates a workspace and replaces the address with `/w/<id>`. |
| `POST /api/workspaces {open: {cases}}` | The file, CLI and API form of the same handoff. |
| `kipscope case open file.json \| -` | Open a catalog from a file or stdin. |
| `kipscope case next \| prev \| go 5 \| unlink \| link` | Step and switch from the shell. |
| `kipscope case link file.json` | Print the link for a catalog. |

All of these are ordinary workspace commands, so the guard, `--wait` and the live channel need nothing new.

## UX sketch

### Linked: the session bar replaces the SCOPE label

```
┌ Signals ┐ Views  Speeds · A B Diff  Link axes  [Go to]  Back Reset ⋯
│ SESSION  ‹  F-104 · driving · 2026-10-13 11:07–11:17 (10.5 min) · 6.2 km  ›  3 / 17 ▾  Unlink   Align: start ▾
│ ▁▁▂▇█▇▃▁▁▁▁▁▁  (strip over session ± pad; drives and events as today)
```

- **Arrows.** `‹ ›` appear on hover and focus of the bar. `[` and `]` are the keys: `←` and `→` already pan, and Alt+← is the browser's Back on Windows. Each arrow's tooltip names the neighbour ("next: F-104 charge, 13:02").
- **Catalog list.** `3 / 17 ▾` opens the catalog: one row per session with kind, object, time and meta, a click jumps there, and filter-as-you-type is available.
- **Stepping keeps the dashboard.**
  - What moves: the scope, every window range and the cursors.
  - What stays: windows, signals, heights, Diff and the events filter.
  - Each window keeps its offset and span relative to the alignment point. That point is the session start by default; it can also be the end, the payload `anchor`, or an event.
  - "Align to this event" on an event pin's menu stores the event's name (for example the ignition change) and sets `mode: event`. On each step KIPscope puts that point on the first matching event of the new session; if none matches, it uses the start and the message line says so. This is Jan's "every session has an event, the dashboard is tuned to it".
  - A window range that would leave the new scope is clamped as today.
- **Within a session, nothing changes.** `,` `.` (drives), zoom, Back and Widen work as before. Back history is per session, and a step is one Back entry.

### Unlinked: Jan's "unlink"

```
│ OBJECT  ‹ › (grey)  F-104 · whole series · 2026-09-20 – 2026-10-20 (31 d)   Link ▸   Widen
│ ▁ ▂ ▁ ▃▇▂ ▁ ▁ ▂ ▅ ▁   (density per 6 h)  ▮ ▮▮  ▮ (catalog sessions of this object as marks)
```

- **What changes.** The scope becomes the object's horizon. The arrows are greyed, and the catalog's sessions of this object show as marks on the strip. Clicking a mark links to that session; "Link" goes back to the last one.
- **Horizon for very long series.** D-082 forbids unbounded queries, so the horizon is bounded:
  - **Default.** The default horizon is 31 days centred on the current session, or the span of the catalog's sessions of this object if that is shorter.
  - **Widen.** Widen adds one span each side up to `KIPSCOPE_HORIZON_MAX` (proposed 366 d), never further. `widenScope` gains this cap in scoped mode.
  - **Strip.** The strip keeps at most 120 bars: 31 d gives one bar per 6 h, 1 year one bar per 3 days. A bucket query over months of one data ref on ADX is unmeasured; the first ADX test must measure it, and if it is too slow the strip shows only the catalog marks until the view is shorter than 7 days.
  - **Charts.** Charts load buckets only (min/max over 1,024–2,048 buckets, as today), so a year's view costs the same number of points as an hour's. Raw rows come only when zoomed in.

### Workspaces become invisible

- The Sessions menu goes.
- "Share…" in the overflow menu offers two choices: "Copy link (own copy)" (today's `#view=`) and "Invite to this workspace: read or write" (today's share level plus the `/w/<id>` link).
- `/` opens the user's latest workspace that has no open tab, else a new one. A second tab is never mirrored into the first.
- A "Recent" list (the last 10 workspaces, titled by session or view) moves into the Views menu for the rare way back.
- Limits and idle cleanup stay as they are.

## Caching plan

1. **Keep tiles across scopes (`add-case-open`).**
   - **Today.** `enterScope` clears every tile when the scope key changes (add-scope Z12). Rows inside a scope are the same rows in any other scope ("as if the source held only the scope's rows"); only tiles cut at a scope edge are incomplete.
   - **New key.** Key tiles by data ref, signal, level and index, without the scope. Store a tile only if it lies fully inside the scope it was fetched under. Keep extents and gap info per scope key in a small LRU of four, matching the server's four kept signal lists, instead of forgetting them.
   - **Result.** Stepping back to a session already seen draws from memory.
2. **Preload neighbours (`add-case-open`).**
   - **When.** After the current session settles: no interactive request open, and the render acknowledgement sent.
   - **What.**
     - For the next session, then the previous one, fetch the tiles each window will need after the step, at the level it will draw.
     - Also fetch the neighbour scope's signal list, density, gaps and events.
   - **Query class.** These run as D-081 `preload` queries, at most 2 runs in flight. Any gesture or step cancels them.
   - **Budget.** At most 25 % of the memory limit.
3. **Persist across reloads (own change, `add-tile-store`, after `add-case-open`).**
   - **Storage.** A second level in IndexedDB below the 4 M value memory LRU: tiles as binary blobs, keyed by user, server, data ref, signal, level and index.
   - **Limits.** Up to `min(1 GB, 50 % of navigator.storage.estimate())`, dropped least recently used first, and after 14 days at the latest.
   - **Freshness.** Tiles ending within the last hour are not stored (as today). The server already re-counts each data ref's rows every 5 minutes (D-068 G9). That count goes into `/api/meta` as a data epoch, and tiles of an older epoch are dropped, so backfilled data is never hidden.
   - **Who sees it.** The store is cleared when the signed-in user changes or signs out, so a shared browser profile never shows another user's data.
   - **What this fixes.** It covers the page load after a click in the search tool into the same tab, and switching workspaces.

## `add-multiuser` vs `add-case-open`

**In `add-multiuser`, before it is archived** (wording and UI; the server mechanics stay):
- **Rename.** User-facing "session" becomes "workspace" in the UI, CLI and docs:
  - `/s/<id>` becomes `/w/<id>`, and `/api/s/<id>/…` becomes `/api/w/<id>/…`;
  - `--session` becomes `--workspace`, and `kipscope session …` becomes `kipscope workspace …`;
  - the `sessions` capability becomes `workspaces`;
  - the header becomes `X-KIPscope-Workspace`.
- **Hide.** Drop the Sessions menu for "Share…" in the overflow menu plus a "Recent" list in the Views menu. The two link actions get names that say what the receiver gets.
- **Change `/`.** `/` opens the latest own workspace without a live client, else a new one. The CLI without `--workspace` still takes the most recently active workspace (scripts keep working) and prints which one it took.
- **Keep.** Identity adapters, rules, the guard, share levels, per-workspace state, limits, idle cleanup and migration stay.

**In `add-case-open`:**
- the catalog document, `/open#cases=`, `POST /api/workspaces {open: {cases}}`, the `case.*` commands and CLI;
- the session bar (‹ › on hover, `[` `]`, `3 / 17`, Unlink and Link, Align);
- the object horizon with Widen capped;
- catalog marks on the strip;
- tiles kept across scopes, and neighbour preload;
- the object → data ref mapping;
- the button on the search tool's side (outside this repo and out of scope of KIPscope, after the payload is fixed).

**Own change after that:** `add-tile-store` (IndexedDB).

## Questions for Jan

Each question comes with a recommended answer; "ja" accepts it.

1. **Terms:** "Session" means the data section, as in the search tool. The server state is called "workspace" and drops out of the UI: no Sessions menu; "Share…" and "Recent" instead. The rename happens in `add-multiuser` before the archive. *Recommended: ja.*
2. **Handoff:** the search tool sends the catalog inside a link (`/open#cases=…`, up to 200 sessions). The same JSON also works as a file and on the CLI. There is no live control channel and no KIPscope → search tool calls; the search tool opens the link in a named tab, so later clicks reuse it. *Recommended: ja.*
3. **Neighbours = catalog order:** decided by D-085 — the list is any order, any VINs; ← → follow it as sent. Still open: Unlink always stays on the current session's vehicle. *Recommended: ja.*
4. **Stepping keeps the dashboard:** windows keep their position relative to the session start. "Align to this event" on an event pin makes every session show the same event instead. *Recommended: ja.*
5. **Unlink horizon:** 31 days around the session by default, Widen up to 1 year, never unbounded, with the catalog's sessions as marks on the strip. *Recommended: ja (numbers can change after the first ADX measurement).*
6. **Cache:** tiles survive session switches in memory, and neighbours are preloaded in the background (`add-case-open`). After that, an IndexedDB store keeps up to 1 GB for 14 days, per user (`add-tile-store`). *Recommended: ja.*
7. **Object → data ref:** the data ref is the VIN as the search tool sends it, configurable by a template. The ADX testers confirm how ADX names a vehicle. *Recommended: ja.*
8. **Local testing without the search tool:** the search tool has no data for Jan's own cars. `kipscope case drives <dataRef>` builds a catalog from the strip's drives (D-060), so the session bar can be used on smart451 and the demo. It is a dev aid, and finding stays with the search tool (D-078). *Recommended: ja.*
9. **The search tool's button:** the search tool adds "Open in KIPscope" in its own repo and after its own rules; that work is out of scope of KIPscope. Because of D-085 the link is built by the search tool's server (it signs), not in the browser. *Recommended: ja, once the payload is fixed.*

**After D-085 (rights in the search tool):**

10. **How the search tool vouches:** it signs the catalog (JWS, short expiry, bound to the Ping user); KIPscope verifies with the search tool's public key and allows only what is signed. Alternative: KIPscope asks the search tool per request "may this user see VIN X?" — rejected, it makes KIPscope stop working whenever the search tool is down. *Recommended: ja, signed catalog.*
11. **Rules file in KIPscope:** drop the KIPscope rules file (role → data-ref patterns) from `add-multiuser` before its archive; on a server, KIPscope shows only what a signed grant covers, and the guard stays as the one place that enforces it. Local `none` is unchanged. *Recommended: ja.* (Alternative: keep the rules file as an option for deployments without a search tool.)
12. **Unlink and rights:** Unlink on a server works only as far as the search tool's grant covers the vehicle (`grant.objects`). If the search tool grants only the listed session windows, Unlink is greyed out. *Recommended: ja; the search tool decides how much of a vehicle a user may see.*
13. **Views without the search tool:** on a server, a saved view or `#view=` link opens only data the user's current workspace grant covers; a view alone grants nothing. *Recommended: ja.*
