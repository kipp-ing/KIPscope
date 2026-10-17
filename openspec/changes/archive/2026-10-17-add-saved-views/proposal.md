# Proposal

## Why

A view built in KIPscope cannot be kept or handed on. The workspace lives in server memory and is gone after every restart (status.md, Known limitations; the dev server restarts on every server change, so Jan's 17 windows of 2026-10-17 were lost: `GET /api/workspace` answered revision 0 with no windows a few hours after the persona test). In the persona test the boss could not hand a view to a colleague or a meeting: no share, no export, no link, no title (docs/feedback/2026-10-17-personas.md, single voice "must").

Jan (2026-10-17): „5 yes saving the view somehow necessary. url? shared link? yaml export. we need something."

Concept §8: „Erforderlich sind Speichern/Laden, Snapshots, versionierbare Konfiguration und Undo. Zum gespeicherten Zustand gehören mindestens Datenreferenz, Signalauswahl, Fensterlayout, Zeitbereiche, Darstellungsoptionen, Cursorpositionen, Differenzmodus und Benutzeroptionen. Ein Snapshot der Ansicht ist keine Kopie der Messdaten. […] Zugangsdaten gehören nicht in exportierte Templates." Concept §9 suggests opening an investigation by link and bookmarks with a note.

## What Changes

The first slice solves "keep a view, and hand it on" with one portable file format used everywhere:

- **The workspace survives a restart.** The server writes the open workspace to a state file shortly after every change and restores it at start, IDs and revision included.
- **One view document, versioned and human-readable.** A view is a small YAML document (`kipscope: view`, `version: 1`): title, note, the data refs it reads, every window (kind, title, range, display, height, signals by full ID), cursors and diff mode, link flag, digits, measurement info, event filter and events-line signals, signal colours. It holds no measured data and no credentials. Times are exact UTC ISO-8601 to the nanosecond. JSON with the same fields is read as well.
- **Named views on the server.** Save the open workspace under a title (name derived from it), list, open, delete. Files live in a views directory as `<name>.yaml`, readable, diffable and committable.
- **Open replaces the workspace** as one command (`view.open`), so every open tab and the CLI see it at once. Signals the catalog does not know, and signals over the window or workspace limits, are left out and reported; the file stays unchanged. The workspace before the last open is kept as the view "Before last open".
- **Title on screen.** The open view's title shows in the top row (with a dot while changed since saved or opened) and in the browser tab title; its note is the title's tooltip.
- **Export and import.** Download a view's YAML file; import a YAML or JSON file as a named view and open it.
- **Links.** "Copy link" copies a self-contained link (`#view=…`, the view compressed into the URL fragment; Jan's 17-window workspace: about 1.4 KB). `?view=<name>` opens a saved view by name (bookmarks). Both only work where a KIPscope server is reachable at the same address and sees the same data refs (see below).
- **CLI:** `view list | save | open | delete | export | import`.

### What "shared link" means while KIPscope is local-only

`server-access` answers only `localhost`-style hosts (D-046). A link such as `http://localhost:5173/?view=drive-3` therefore points to the **opener's own machine**: it works for me in another tab or browser, and for a colleague only if they run their own KIPscope on the same port with the same named view, which they do not have. The self-contained `#view=` link carries the whole view, so it works for a colleague who runs KIPscope against the same data (same data refs, e.g. `smart451`), and never reaches the server's network at all (the fragment stays in the browser). For anyone without KIPscope the YAML file is the hand-over. With `KIPSCOPE_HOST` set to a LAN address, colleagues reach the same server, but there is **one** workspace: opening a view there changes it for everyone looking at it.

### Out of scope (follow-up list)

- **Undo/redo** of commands (concept §8, §10); the command model and "Before last open" prepare it.
- **Templates:** rebinding a view to another measurement or data ref, mapping renamed signals (concept §9 „Templates neu binden").
- **Several workspaces** per server (one per tab or user), so a link opens without touching others; authentication (concept §8: later).
- **Snapshot history** of a view (versions over time), bookmarks of a single moment with a note (concept §9), relative time ranges ("latest drive").
- **PNG/PDF export** of windows (boss's wish), print layout.
- Importing by dropping a file onto the page; sharing through a server-side short link.

## Capabilities

### New Capabilities

- `saved-views`: the view document (format, version, references), named views on the server, open with its report, "Before last open", export and import, links, the title in the UI and the Views menu.

### Modified Capabilities

- `workspace-state`: new "Workspace survives a restart", "Workspace restored at start", "Open view in the workspace", "Open replaces the workspace", "View names only from the store".
- `cli`: new "View commands", "View export prints the file" and "Link from the CLI".

## Impact

- `packages/shared/src`: new `views.ts` (document schema, conversion both ways, names, link codec); `workspace.ts` (`Workspace.view`, commands `view.open` and `view.markSaved`, `OpenReport` in `CommandResult`, workspace schema for the state file); `apply.ts` (the two commands, the modified flag); `index.ts` (export).
- `apps/server/src`: new `views.ts` (`ViewStore`), new `persist.ts` (state file), new `routes/views.ts`; `workspace.ts` (restore, hook before open), `config.ts` (`KIPSCOPE_STATE_DIR`), `app.ts`, `main.ts`.
- `apps/web/src`: new `views/` (menu, save form, link handling, notice); `bar/OptionBar.tsx` (Views button and title), `App.tsx` (start-up link, tab title, notice), `api.ts` (view calls).
- `apps/cli/src`: new `views.ts`; `args.ts`, `run.ts` (forms, usage); `README.md` CLI section.
- No new dependencies (server has `yaml`; browsers and Node have `CompressionStream`).
- `.gitignore` gains `.kipscope/` (lead).
