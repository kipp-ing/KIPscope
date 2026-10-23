## MODIFIED Requirements

### Requirement: Digits option
The workspace's digits option (3 or 4, default 3) SHALL apply to every place of "One format in every human-readable place" in every connected UI within 1 s of the change. The option bar SHALL show and set it with a segmented control in the "⋯" menu: a group with `role="radiogroup"` and `aria-label` `Digits` holding two buttons `3` and `4` with `role="radio"`, `aria-checked` on the one equal to the option, the checked one `tabindex="0"` and the other `-1`, in the pressed look of the design language's segmented controls (case-navigation's Align, DW6). A click on a button, or ArrowRight/ArrowDown (→ `4`) and ArrowLeft/ArrowUp (→ `3`) on the group, SHALL move focus to that button and send `workspace.setOptions {digits}` when it differs from the option; the arrows do not wrap. The "⋯" menu SHALL stay open after a choice. The control SHALL hold no native `<select>` and open no popup. Origin: D-026 („4 significant digits are an option"); concept §8 (user options belong to the workspace state); segmented control instead of the select, menu stays open: D-112 (1) (Edge on Windows reports the select's popup as a pointer down outside the menu, which closes it).

#### Scenario: Switch to four digits
- **WHEN** the scenario "Same value, same text" is shown and the user sets the option bar's digits to 4
- **THEN** both cells read `362.8 V lin`, and `curl -s localhost:7310/api/workspace | jq .workspace.options.digits` prints `4`
- **Evidence:** UI check (screenshot after the switch); the `curl` command

#### Scenario: Set from the CLI
- **WHEN** a caller runs `kipscope digits 3` while the UI shows four digits
- **THEN** within 1 s the cells read `363 V lin` again
- **Evidence:** UI check (screenshot after the command); CLI output with `"accepted":true`

#### Scenario: Digits control markup and keys
- **WHEN** the digits control is rendered to static markup for digits 3 and for digits 4; and the pure key helper `digitsByKey(current, key)` gets `(3, "ArrowRight")`, `(3, "ArrowDown")`, `(4, "ArrowRight")`, `(4, "ArrowLeft")`, `(4, "ArrowUp")`, `(3, "ArrowLeft")` and `(3, "Enter")`
- **THEN** each markup holds one element with `role="radiogroup"` and `aria-label="Digits"`, two `role="radio"` buttons with the texts `3` and `4`, and no `<select`; for digits 3 the `3` button has `aria-checked="true"` and `tabindex="0"`, the `4` button `aria-checked="false"` and `tabindex="-1"`, for digits 4 the reverse; the helper gives `4`, `4`, `4`, `3`, `3`, `3` and `undefined`
- **Evidence:** `apps/web/test/bar.test.ts` › "renders Digits as a segmented control" and › "moves Digits with the arrow keys"

#### Scenario: Real click on 4 keeps the menu open
- **WHEN** on smart451 at 1440×900 with digits 3 the UI user opens "⋯" and clicks the `4` button with a real pointer click (the browser tool's click, not a dispatched `change` or `click` event from script)
- **THEN** the "⋯" menu is still open (`aria-expanded="true"` on "⋯", the Digits group displayed), the `4` button has `aria-checked="true"`, `kipscope state` shows digits `4`, and a values cell shows four significant digits; a following real click on `3` gives digits `3` with the menu still open
- **Evidence:** UI check on smart451 (`aria-expanded` and `aria-checked` read from the page after each click, `kipscope state` output after each click, one screenshot with the menu open after the click on `4`)
