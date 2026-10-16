## ADDED Requirements

### Requirement: A window that fails to draw is contained
When drawing one window throws, only that window SHALL be replaced by a box reading `Window failed to draw: <message>` with a Retry button that draws it again; the other windows, the sidebar and the option bar SHALL keep working. The failed window SHALL report a render error for the current revision, so `--wait` ends with status `error`. Origin: concept §10 („Fehler … müssen erkennbar bleiben"); concept §7 (wait). Design H6.

#### Scenario: Boundary catches and reports
- **WHEN** the window boundary of window `w2` at revision 9 catches an error `boom`
- **THEN** its state holds the message `boom`, and `onReady` was called with `w2`, 9 and one error for `w2` whose message contains `boom`
- **Evidence:** `apps/web/test/boundary.test.ts` › "catches a window's error and reports it as rendered with an error"

#### Scenario: Every window is wrapped
- **WHEN** `grep -n "<WindowBoundary" apps/web/src/App.tsx` runs
- **THEN** it prints the line that wraps each window of the window list
- **Evidence:** command output

### Requirement: Height drag always ends
A height drag SHALL end, restoring text selection and the live cursor, when the pointer is released, the gesture is cancelled, the pointer capture is lost, or the window unmounts. Unmounting SHALL send no `window.setHeight`. Origin: necessary consequence of "Resizable window height" and "No text selection while dragging": a leaked drag left selection off and the live cursor suspended for the whole tab. Design H8.

#### Scenario: Lost capture and unmount
- **WHEN** a height drag is tracked on a handle and the handle fires `lostpointercapture`; a second drag fires `pointerup` and then `lostpointercapture` (as browsers do); and a third drag is disposed (unmount) before any pointer event
- **THEN** the end callback runs once each for the first and second drag, the release callback runs once for each drag, the third never calls end, and later `pointermove` events change nothing
- **Evidence:** `apps/web/test/height.test.ts` › "ends a height drag on lost capture and on unmount"

### Requirement: Dropped files are ignored
A file dragged from the desktop and dropped anywhere on the page SHALL be ignored: the tab SHALL stay on KIPscope, and the pointer SHALL show that no drop is possible. Origin: necessary consequence: today a dropped file navigates the tab away and loses the zoom history and cursors of the session. Design H8.

#### Scenario: File drag on the document
- **WHEN** a cancelable `dragover` and a cancelable `drop` whose data types include `Files` are dispatched on the document target the guard is installed on
- **THEN** both are default-prevented and `dropEffect` is `none`; after the guard is removed, they are not
- **Evidence:** `apps/web/test/filedrop.test.ts` › "prevents file drops on the page"

### Requirement: Unrelated revisions do not reload
A window SHALL hand its requests to the loader again only when a signal assignment, the view, the target or the plot width changes, or when a `window.setRange` command arrives (also one that leaves the range unchanged); other revisions SHALL NOT retry a failed signal. Origin: D-042 (1) („setting the same range again also retries"); D-044 („4xx only when the same request comes again"): an unrelated revision is not the same request coming again. Design H7.

#### Scenario: Load key
- **WHEN** the load key is computed for the same window before and after an unrelated revision (new but equal `signals` array), after a signal is added, and after the range-command count rises
- **THEN** the first two keys are equal, the others differ
- **Evidence:** `apps/web/test/loader.test.ts` › "load key ignores unrelated revisions"

#### Scenario: Range count from the live channel
- **WHEN** the live state reducer gets a state message with `command` `window.setRange`, then one with `window.rename`, then one without `command`
- **THEN** the range-command count rises by one after the first and stays after the others
- **Evidence:** `apps/web/test/livestate.test.ts` › "counts range commands from state pushes"
