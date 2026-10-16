## ADDED Requirements

### Requirement: Signals and Events in the sidebar
The sidebar SHALL hold a switch `Signals | Events` above its content (explorer or events panel), kept per browser in local storage (Signals without usable storage), not in the workspace. `/` SHALL switch to Signals before focusing the search; `e` without Ctrl, Meta or Alt outside text fields and selects SHALL open a collapsed sidebar on Events and focus the filter field, its text selected. Origin: D-058; place: D-058 (Jan's answers); `e` like `/` (D-020).

#### Scenario: Switch and key e
- **WHEN** at 1440×900 the sidebar is collapsed, focus is on the page body and the user presses `e`; then clicks `Signals`; then reloads; then presses `/`
- **THEN** the sidebar opens 240 px wide on Events with the filter field focused and its text selected; then the explorer shows; after the reload the explorer still shows; `/` focuses the search
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after `e` and after the reload)

#### Scenario: Stored part and key
- **WHEN** the stored part is read from storage holding `events`, holding `nonsense`, and from storage that throws; and the key `e` is tested with Ctrl, in a text field, in a select and on the body
- **THEN** `events`, `signals`, `signals`; only the body press opens the events
- **Evidence:** `apps/web/test/sidebar.test.ts` › "loads and saves the sidebar part", "opens the events with e outside text fields and selects"
