## MODIFIED Requirements

### Requirement: Apply and cancel
Go and Enter in any of the picker's fields SHALL apply what "Go on typed text" names with one command for the bar target, as "Go to" did (all windows while linked, the target only while unlinked, one zoom history entry), and close the picker. Cancel, Esc and a click outside SHALL close it without a command; Esc SHALL do so wherever focus is while the picker is open (in the picker, on the page body after a click on a non-focusable part of the picker such as the month title or the legend), unless a control inside the picker consumes that Esc itself, and focus SHALL then return to the range button. While it is open the navigation keys SHALL do nothing. Origin: D-092 (mock: Go, Cancel); time-navigation "Navigation targets", "Navigation in the zoom history"; Esc after focus left: review day 2026-10-28 T-06 (Esc was handled on the dialog root only, and App ignores keys while the picker is open, so a click on the month title or the legend left Esc dead).

#### Scenario: Go and Back
- **WHEN** two linked windows show smart451 at a 20 min range, the user opens the picker, clicks **Whole day** and Go, then clicks "Back"
- **THEN** after Go both windows show the start day 00:00 – 24:00, the button reads `<YY-MM-DD> 00:00` and `24:00 h`, and the revision rose by exactly one; after Back both show the 20 min range (`0:20 h`)
- **Evidence:** UI check on smart451 (revision and button text after each step)

#### Scenario: Cancel, Esc and keys
- **WHEN** the user opens the picker, clicks a day and presses Esc; opens it, clicks a day and clicks Cancel; opens it, clicks a day cell and presses `-`, `→` and `Home`; and the key handler gets `+` while the picker is open
- **THEN** the revision and the shown range never change and the picker is closed after Esc and Cancel; the handler returns no action
- **Evidence:** `apps/web/test/keys.test.ts` › "ignores navigation keys while the range picker is open"; UI check (revision before and after)

#### Scenario: Esc after focus left the picker
- **WHEN** on smart451 at 1440×900 the user opens the picker, clicks the left month's title (a real pointer click) and presses Esc; opens it again, clicks the calendar legend and presses Esc
- **THEN** after each click `document.activeElement` is outside the picker's fields (the body or the dialog itself); after each Esc the picker is closed (no `role="dialog"` with `aria-label="Go to"` in the page), `document.activeElement` is the range button, and the revision is unchanged
- **Evidence:** UI check on smart451 (`document.activeElement` and the dialog's presence read from the page after each click and each Esc; `kipscope state` revision before and after; one screenshot after the first Esc); reviewer reads `apps/web/src/bar/RangePicker.tsx`: the Escape listener is on `document` while the picker is mounted and removed on unmount, and the dialog root's own Escape handler is gone (one handler, so one Esc closes once)
