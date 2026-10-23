## MODIFIED Requirements

### Requirement: Option bar
Above the windows, an option bar SHALL stay visible while the window list scrolls. After the sidebar button it SHALL hold, in this order: "Views" (with the open view's title and the Read-only pill, `saved-views`); a separator; the range control (time-navigation; its content is owned by `add-range-picker`); "Back" and "Reset" as 26 × 26 px icon buttons (`aria-label` `Back` and `Reset`; Reset's tooltip names `Home`, Back's names `Backspace` while there is an earlier range and otherwise reads `Back: no earlier time range yet`); the "Link time axes" icon toggle ("Link toggle"); a separator; the cursor pills "A", "B" and "Diff" (cursors spec); then, at the row's end and at every width, "Share…", the "⋯" menu and "?" (`guidance` "Help panel"). The Digits control (number-format "Digits option", a segmented control `3 | 4`) and "+ Values window" SHALL always be items of the "⋯" menu, never in the row (`saved-views` "Top-row overflow menu"). Origin: D-023 (cursor toggles, diff mode, "Link time axes", zoom back and reset in a bar); D-025 (one "Back", one "Reset"); D-027 (time navigation); D-026 (digits option); order, icons and the "⋯" items: D-092 (7) (supersedes D-071's width rule for Digits and "+ Values window") and mock `Main.dc.html`; Share in the row at every width: D-095 (critic 15, supersedes the compact-width move of D-092's mock); Digits as a segmented control: D-112 (1).

#### Scenario: Scrolled down
- **WHEN** six windows exist and the list is scrolled to the end
- **THEN** the option bar is fully visible above the windows with its controls in that order
- **Evidence:** UI check (screenshot)

#### Scenario: Order in the row
- **WHEN** the option bar is rendered to static markup for a workspace with a timeseries window, its overflow menu closed
- **THEN** the controls appear in the order `Views`, the `range-control` element, `Back`, `Reset`, `Link time axes`, `A`, `B`, `Diff`, `Share…`, `More`; `Back` and `Reset` hold no visible text; no element with `aria-label="Digits"`, no `<select` and no `+ Values` button is in the row
- **Evidence:** `apps/web/test/bar.test.ts` › "renders the top row in order"
