# KIPscope manual

KIPscope shows recorded vehicle data over time: CAN signals and diagnostic data that a logger wrote into a recording. You put signals into windows, zoom from the whole recording down to single samples, and read exact values and differences with two cursors. All times are local time.

## Start here

The screen, from left to right and top to bottom:

- **Signal list**, with the tabs Signals and Events; each tab shows its count. The sidebar icon at the start of the top row, or `s`, hides or shows it.
- **Top row**: the sidebar icon, Views, the range button, the icons Back, Reset and Link time axes, the cursor pills A, B and Diff, Share…, the ⋯ menu with Digits and + Values window, and `?` for help. The range button shows the time range on screen and opens the range picker. Every icon names itself in its tooltip. On a narrow screen, Share… moves into the ⋯ menu too; Help (`?`) always stays last in the row.
- **Context row**, only with a session list or a scope: the session bar, or the scope with Widen and Clear.
- **Time strip**: the whole recording as bars, the drives under them, and the event pins. Its tooltip gives the strip info.
- **Windows**: signals over time, or a table of values, in two columns on a wide screen.
- **Status strip**: `connected` or `disconnected`, the last error and the measurement info. Hover `connected` for the revision, the source and the build.

The Start here card above the windows sums up the first moves; × hides it, and the help panel brings it back.

## Find a signal

Press `/` and type. Every word must occur in the signal's name, short name, description or unit, and parts of words match: `pack` finds PackVoltage and PackCurrent, `cellv` the 93 cell voltages. With an empty search the list shows all signals (135 in the demo recording), grouped by the ECU that sends them; click a group to open it. While you search, only groups with a match show, already open.

A row shows the short name, the unit and an SNA marker. Short names come from the full DBC name, for example VehSpeed for VEH_200h.VehSpeed; the full name is the row's tooltip.

Rest the pointer on a row, or move to it with `↑` and `↓`, and a card shows what the DBC and diagnostic catalog know: full name, description, message and CAN ID, unit, scaling, raw step, range, SNA codes, state names, source file, and the windows that show the signal. `Esc` clears the search.

## Chart a signal

**Where an added signal goes:** `+` on a row, or `Enter`, adds the signal to the **Add to target**: the window you last clicked. Any click inside a window marks it with a blue frame and an "Add to" pill after its title. While no window is marked, the target is a new window. The "Add to" select above the list shows the target; choose New window there to stop adding to the marked one.

A window created by an add does not become the target, so the next add makes another new window; click it first to add more into it. After each add, the window that received the signal scrolls into view and flashes briefly.

You can also drag a row onto a window. During a drag the status strip and the free space below the last window turn into "+ New window"; drop there for a new window. `Esc` cancels a drag. Dropping a row on the time strip does not chart it; it marks the state changes of a signal with states (see Events).

For several signals, select rows with `Ctrl/Cmd+click` or `Shift+click`, then press `+` or drag the selection. A timeseries window holds at most four units; the rest flows into the next window with room, then into new windows.

Drag a legend row onto another window to move the signal; hold Alt or Ctrl while dropping to copy it. Double-click a window's title to rename it. Its ⋯ window menu, at the right of the header, offers the display mode (Line, Step or Markers), Min/max, Rename and Remove window.

## Compare signals

A timeseries window holds up to four units, with one y axis per unit. Signals with the same unit share an axis, so the 93 cell voltages in V compare on one scale.

**Link time axes**, the link icon after Reset, decides whether windows share one time range. On (the default, the icon pressed), zooming or panning one window moves all windows, and the range button shows the one range. Off, each window keeps its own range and shows it small in its header, and the range button, Back and Reset act on the window you zoomed last; their tooltips name it.

For many signals at one moment, use **+ Values window** in the ⋯ menu: a table with one row per signal and its value at A, at B, with Diff on the difference, and at L. Add signals to it as to any window.

## Measure

Click in a plot to set **cursor A**; `Shift+click` sets **cursor B**. A plain second click moves A again. Both cursors mark the same time in every window. Drag a line to move it. The A and B pills switch them on and off.

Each legend row shows the signal's exact value at A and at B, read from the recording at any zoom. The legend's header row heads these columns with the cursor times, such as `A 07:44:22.950`; with Diff on, the Δ column's header shows Δt. **Diff** adds Δ, the value at B minus the value at A, and Δt, the time from A to B, which also shows between the flags at the top of the plot.

The column **L** follows the pointer: it shows each value under the pointer, a thin L line marks that time in the other windows, and the signal nearest the pointer is highlighted.

Signals with states show the state name: Gear reads `P`, `R`, `N` or `D`. For states, Δ shows `=` or `≠`.

**Example, an acceleration in the demo recording:** add VehSpeed (vehicle speed), press `t`, type `2026-10-14 07:44:10 +30s` into Go to and press `Enter`. Click where the speed leaves 0 at 07:44:22.950 for A, `Shift+click` where it reaches 40 km/h at 07:44:28.350 for B, and switch on Diff. The row reads A 0, B 40.1, Δ 40.1 [km/h], Δt +5.400 s: about 2.1 m/s².

## Move in time

In a plot, drag across to zoom to that range; `Ctrl+wheel` or `Shift+wheel` zooms around the pointer; the plain wheel scrolls the page; a horizontal swipe pans; double-click shows all data of the window.

On the time strip:

- Click a bar to jump there, keeping the span.
- Drag across the bars to zoom.
- Drag the highlighted shown range to pan, or its edges to resize it.
- Double-click shows the whole recording.
- Click a drive (the dark segments under the bars) to fit it; `,` and `.` step to the previous and next drive.

The **range button** in the top row reads the range on screen as start and duration: `26-10-13 15:06` and, after the stopwatch, `0:12 h`, `41 s` or, from two days, `9 d 11 h`. Hovering the start shows its full date (`Tue 2026-10-13 15:06`), hovering the duration its words (`Duration 12 min`). Click it or press `t` to open the **range picker**:

- **Go to** at the top takes a time or range: `15:08`, `15:07 .. 15:09`, `2026-10-13 15:15:30 +30s`, `1h` around the anchor, `+30min` to pan, `a` to centre on cursor A. A time without a date takes the date the view shows. `Enter` goes there and closes the picker; text it cannot read stays with the reason below.
- The **calendar** shows two months. Under each day, small bars show how much was recorded in each two hours, dark where a drive ran; days without data are greyed out. Click a start day, then an end day; ‹ and › page to months with data. By keyboard: `Tab` to the days, arrows move a day or a week, `PageUp`/`PageDown` a month, `Enter` picks.
- The **presets** line lists the drives of the start day, **Whole day**, and the whole recording, scope or session.
- **From** and **To** each show a date as YY-MM-DD and a time field that takes `HH:MM`; To also takes `24:00`, the end of the day.
- **Go** shows the range, as one step that **Back** undoes. **Cancel**, `Esc` or a click outside closes the picker and changes nothing. While it is open, the navigation keys do nothing.

Keys `+` and `-` zoom, `←` and `→` pan by half the span, with Shift by the whole span, on the window under the pointer. **Back** (the arrow icon after the range button, `Backspace`) returns to the previous range, up to 50 steps. **Reset** (the icon after Back, `Home`) shows all data.

### Sessions from the search tool

The search tool (finder) is a separate tool that finds sessions; it is not part of KIPscope. Its "Open in KIPscope", or a dropped catalog file, opens a new workspace on one session of the list it found. The context row above the strip then shows the session bar instead of the scope, each part in a fixed place: `SESSION`, `‹`, the position such as `3 / 17 ▾`, `›`, the vehicle or title, the weekday, date and times, the length, and **Unlink**. An end on the next day carries a small +1; a session over two or more days shows both dates. Hover the title for the kind and the meta values; the session list has a `Back to` link to the finder.

- `‹` and `›` on the bar, or the keys `[` and `]`, step to the previous and next session in the order the search tool sent. The windows, signals and filter stay; each window keeps its distance from the alignment point, so the same moment of the next session shows. The bar shows the next session at once and a thin line under it runs until the windows have drawn. A signal the next vehicle lacks stays in its window and reads `missing`.
- `3 / 17 ▾` opens the list of all sessions; type to filter by vehicle, kind, time or a meta value, then `Enter` or click a row.
- **Align**, at the foot of the session list (`3 / 17 ▾`), sets what lines up between sessions: `Session start`, `Session end`, `Anchor from the finder`, or an event: right-click a pin and choose `Align sessions to this event`, or use `Align` on an Events row. Each later session lines up on its first matching event; without one it aligns to its start and the message line says so.
- **Unlink**, at the end of the bar, shows the vehicle's whole recording around the session: the bar reads `VEHICLE` and greys the arrows, the strip shows the catalog's sessions of this vehicle as marks, and the Events tab lists the events near the view (`Nearby`). Click a mark, or **Link**, to go back to a session with the layout you had.
- **Back** remembers the zoom steps of each session; stepping back to a session restores them.

### Workspaces and sharing

Each browser tab works in its own **workspace**: the windows, signals, cursors, scope and session list you see, kept on the server under the address `/w/<id>`. A second tab never mirrors the first; a reload, or opening the address again, brings the workspace back as you left it. There is nothing to manage: an untouched workspace without an open tab is removed after 30 days.

**Share…** (in the top row, or in the ⋯ menu when the row is narrow):

- **Copy link (own copy)** copies a link with this layout. The receiver gets their own workspace; their changes stay apart from yours.
- **Copy workspace link (same live workspace)** copies the address of this workspace. Whoever opens it works in the same workspace with you.
- **Invite to this workspace** (on a shared server, owner only): `Private` keeps it to you, `Read` lets others with the link watch live, `Write` lets them change it with you. The setting applies at once.

Opening a shared workspace with `Read` shows the pill `Read-only`; zoom and other changes are refused, and "Copy link (own copy)" gives you a copy to work in.

**Recent workspaces** in the Views menu lists your latest workspaces with their time; `●` marks one open in a tab, the tick the one you are in. Saved views (Save, Open, Import file…) are your own layouts; opening one puts it into a new workspace.

**On a shared server** you sign in through your company's login, and the search tool decides which vehicles you may see: a new workspace shows "Open a session from the search tool" until you open a session there. "No access to this workspace" means its owner keeps it private; "My latest workspace" and "New workspace" take you on. The status strip, and the gate pages, show who you are signed in as.

## Events

Events are faults (diagnostic trouble codes), state changes and logger errors. They show as pins on the time strip and as lines in the plots, with a glyph above the plot; hover one for its time, source and text. A click on a pin centres the view on it; a click on a glyph sets cursor A there.

The count on the Events tab, such as `Events 13`, means 13 events pass the filter in the whole recording, not only in the time shown; its tooltip adds the total, such as 669 in the recording. A click on the tab opens it.

The Events tab (`e`) has the filter, presets such as Faults or Changes, and under Refine the field and chips per category and ECU; then the list. A click on an event puts cursor A on it (`Shift+click`: B) and centres the view only when the event lies outside it. Filter words include `faults`, `changes`, `active`, `logger`, `ecu:BMS` and any text; a leading `-` excludes. The default is `active changes`.

`In view` lists the events of the time shown, with how many lie earlier and later; `All` lists every event that passes the filter.

`n` and `p` put cursor A on the next or previous event, so the values window shows the values there.

A hollow mark or glyph is a fault memory read: the time the DTCs were read out, not when a fault first occurred.

## Read the display

**The mode tag** at the right of a window's header, before its ⋯ menu: `raw` draws every recorded sample. `agg 2 s` is aggregated: each point stands for 2 s of data, drawn as their mean; zoom in for raw samples. `part 2 s`: some signals aggregated, others raw. The ⋯ window menu switches the display mode and Min/max.

**SNA** means signal not available: the sender marked the value invalid, for example the raw value 255 for SocDisplay. SNA is never drawn as a value; the curve stops, and a thin strip in the signal's colour at the foot of the plot marks the time. `SNA 4.0 %` in a legend row means 4.0 % of the signal's points in the shown range are SNA. Cursor cells read `SNA`.

**No data:** where the logger recorded nothing for 2 s or more, the plot shows a grey band and the curves break. A cursor there reads `no data`; `—` means no value for another reason, named in the tooltip.

**The strip info**, the first line of the time strip's tooltip, such as `2.5 h of 5.6 d recorded · 1 bar = 2 h`, gives the time shown, the length of the recording, and the time each bar covers: with `1 bar = 2 h` each bar is two hours, its height how many rows the logger wrote. Bars in the shown range are blue.

**Loading:** a legend row shows a signal's loading state, or `failed:` with the message; the window keeps the last curve and retries. `missing` means the recording has no such signal; the row keeps its place and the plot draws no axis for it. The strip shows grey placeholder bars while it loads, or `Recording unavailable`.

## Keys

Press `?` in the app for every key and gesture.

## Words

- **window**: a tile in the window list, a timeseries window or a values window.
- **timeseries window**: draws signals over time, up to four units.
- **values window**: a table of values at the cursors.
- **Add to target**: where `+` and `Enter` add; the window you last clicked, else a new window.
- **cursor A / B**: two times, the same in every window; click sets A, `Shift+click` sets B.
- **L**: the live cursor, the time under the pointer.
- **Δ**: the value at B minus the value at A.
- **Δt**: the time from A to B.
- **SNA**: signal not available, a value the sender marked invalid; never drawn.
- **raw**: every recorded sample drawn as it is.
- **aggregated**: each point stands for a stretch of time.
- **drive**: a stretch of dense logging, shown under the strip bars.
- **event**: a fault, a state change or a logger error at one time.
- **data ref**: one recording, for example smart-ed.
- **session**: a section of one vehicle's data found by the search tool, such as a drive or a charge.
- **catalog**: the list of sessions the search tool handed over, in its order.
- **context row**: the row under the top row with the session bar or the scope.
- **workspace**: what one tab shows, kept on the server at `/w/<id>`.
