# KIPscope manual

KIPscope shows recorded vehicle data over time: CAN signals and diagnostic data that a logger wrote into a recording. You put signals into windows, zoom from the whole recording down to single samples, and read exact values and differences with two cursors. All times are local time.

## Start here

The screen, from left to right and top to bottom:

- **Signal list**, with the tabs Signals and Events. `s` hides or shows it.
- **Top row**: the cursor pills A, B and Diff, Link time axes, Go to, Span, Back, Reset, Digits, + Values window and `?` for help. On a narrow screen, Digits, + Values window, Span and Help (`?`) move into the ⋯ menu.
- **TIME strip**: the whole recording as bars, the drives under them, and the events count.
- **Windows**: signals over time, or a table of values, in two columns on a wide screen.
- **Status strip**: connection, revision, the last error and the measurement info.

The Start here card above the windows sums up the first moves; × hides it, and the help panel brings it back.

## Find a signal

Press `/` and type. Every word must occur in the signal's name, short name, description or unit, and parts of words match: `wheel speed` finds DVL, DVR, DHL and DHR. With an empty search the list shows all signals (553 in smart451), grouped by the ECU that sends them; click a group to open it. While you search, only groups with a match show, already open.

A row shows the short name, the unit and an SNA marker. Short names come from the full DBC name, for example V_ANZ for COMBI_412h.V_ANZ; the full name is the row's tooltip.

Rest the pointer on a row, or move to it with `↑` and `↓`, and a card shows what the DBC and diagnostic catalog know: full name, description, message and CAN ID, unit, scaling, raw step, range, SNA codes, state names, source file, and the windows that show the signal. `Esc` clears the search.

## Chart a signal

**Where an added signal goes:** `+` on a row, or `Enter`, adds the signal to the **Add to target**: the window you last clicked. Any click inside a window marks it with a blue frame and an "Add to" pill after its title. While no window is marked, the target is a new window. The "Add to" select above the list shows the target; choose New window there to stop adding to the marked one.

A window created by an add does not become the target, so the next add makes another new window; click it first to add more into it. After each add, the window that received the signal scrolls into view and flashes briefly.

You can also drag a row onto a window. During a drag the status strip and the free space below the last window turn into "+ New window"; drop there for a new window. `Esc` cancels a drag. Dropping a row on the TIME strip does not chart it; it marks the state changes of a signal with states (see Events).

For several signals, select rows with `Ctrl/Cmd+click` or `Shift+click`, then press `+` or drag the selection. A timeseries window holds at most four units; the rest flows into the next window with room, then into new windows.

Drag a legend row onto another window to move the signal; hold Alt or Ctrl while dropping to copy it. Double-click a window's title to rename it; its ⋯ menu offers Rename and Remove window.

## Compare signals

A timeseries window holds up to four units, with one y axis per unit. Signals with the same unit share an axis, so the four wheel speeds in 1/min compare on one scale.

**Link time axes** decides whether windows share one time range. On (the default), zooming or panning one window moves all windows. Off, each window keeps its own range, and Go to, Span, Back and Reset act on the window you zoomed last; their tooltips name it.

For many signals at one moment, use **+ Values window**: a table with one row per signal and its value at A, at B, with Diff on the difference, and at L. Add signals to it as to any window.

## Measure

Click in a plot to set **cursor A**; `Shift+click` sets **cursor B**. A plain second click moves A again. Both cursors mark the same time in every window. Drag a line to move it. The A and B pills switch them on and off.

Each legend row shows the signal's exact value at A and at B, read from the recording at any zoom. **Diff** adds Δ, the value at B minus the value at A, and Δt, the time from A to B, which also shows between the flags at the top of the plot.

The column **L** follows the pointer: it shows each value under the pointer, a thin L line marks that time in the other windows, and the signal nearest the pointer is highlighted.

Signals with states show the state name: PT_Rdy_IndLmp_Rq reads `OFF`, `GREEN` or `YELLOW`. For states, Δ shows `=` or `≠`.

**Example, an acceleration in smart451:** add V_ANZ (indicated speed), type `2026-10-13 15:15:30 +30s` into Go to and press `Enter`. Click where the speed leaves 0 at 15:15:38.525 for A, `Shift+click` where it reaches 43 km/h at 15:15:44.833 for B, and switch on Diff. The row reads A 0, B 43.0, Δ 43.0 [km/h], Δt +6.308 s: about 1.9 m/s².

## Move in time

In a plot, drag across to zoom to that range; `Ctrl+wheel` or `Shift+wheel` zooms around the pointer; the plain wheel scrolls the page; a horizontal swipe pans; double-click shows all data of the window.

On the TIME strip:

- Click a bar to jump there, keeping the span.
- Drag across the bars to zoom.
- Drag the highlighted shown range to pan, or its edges to resize it.
- Double-click shows the whole recording.
- Click a drive (the dark segments under the bars) to fit it; `,` and `.` step to the previous and next drive.

**Go to** (`t`) takes a time or range: `15:08`, `15:07 .. 15:09`, `2026-10-13 15:15:30 +30s`, `1h` around the anchor, `+10min` to pan, `a` to centre on cursor A. A time without a date takes the date the view shows. **Span** sets 1 s to 1 day around cursor A, or the centre.

Keys `+` and `-` zoom, `←` and `→` pan by half the span, with Shift by the whole span, on the window under the pointer. **Back** (`Backspace`) returns to the previous range, up to 50 steps. **Reset** (`Home`) shows all data.

## Events

Events are faults (diagnostic trouble codes), state changes and logger errors. They show as pins on the TIME strip and as lines in the plots, with a glyph above the plot; hover one for its time, source and text. A click on a pin centres the view on it; a click on a glyph sets cursor A there.

The count in the strip head, such as `13 of 669 events`, means 13 events pass the filter out of 669 in the whole recording, not only in the time shown. A click on it opens the Events tab.

The Events tab (`e`) has the filter, presets such as Faults or Changes, chips per category and ECU, and the list; a click on an event centres the view on it. Filter words include `faults`, `changes`, `active`, `logger`, `ecu:BMS` and any text; a leading `-` excludes. The default is `active changes`.

## Read the display

**The badge** after a window's title: `raw` draws every recorded sample. `agg · 2 s` is aggregated: each point stands for 2 s of data, drawn as their mean; zoom in for raw samples. `part · 2 s`: some signals aggregated, others raw.

**SNA** means signal not available: the sender marked the value invalid, for example 511 for V_ANZ. SNA is never drawn as a value; the curve stops, and a thin strip in the signal's colour at the foot of the plot marks the time. `SNA 4.0 %` in a legend row means 4.0 % of the signal's points in the shown range are SNA. Cursor cells read `SNA`.

**No data:** where the logger recorded nothing for 2 s or more, the plot shows a grey band and the curves break. A cursor there reads `no data`; `—` means no value for another reason, named in the tooltip.

**The strip info**, such as `2.5 h of 5.6 d recorded · 1 bar = 2 h`, gives the time shown, the length of the recording, and the time each bar covers: with `1 bar = 2 h` each bar is two hours, its height how many rows the logger wrote. Bars in the shown range are blue.

**Loading:** a legend row shows a signal's loading state, or `failed:` with the message; the window keeps the last curve and retries. The strip reads `Loading recording…` or `Recording unavailable`.

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
- **data ref**: one recording, for example smart451.
