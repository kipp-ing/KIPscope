## MODIFIED Requirements

### Requirement: Match highlighting
The explorer SHALL highlight every matched part of the query terms in the shown name and unit of each row, and in the full name and description inside the hover card. Overlapping matches SHALL be shown as one highlight; every occurrence of a term counts, also one that overlaps the term's previous occurrence. Highlight ranges SHALL index the original text, also where a character's lower case has another length than the character (`İ` lower-cases to two UTF-16 units). Origin: D-018 ("match highlighting"); shown name in the row, full name in the card: D-035; overlapping occurrences and original indices: review day 2026-10-28 T-11 (`aa` on `AAA_X` marked 2 of 3 letters) and T-12 (ranges shifted after such a character; theoretical for ASCII DBC names, real for non-ASCII ADX names).

#### Scenario: Highlight in the name
- **WHEN** the user searches for `volt` on real data with the local `kipscope.yaml`
- **THEN** the row `HTR_HV_Volt` (`DCU_2B8h.HTR_HV_Volt`) shows `Volt` highlighted (one `<mark>` element) and the rest of the name plain
- **Evidence:** UI check (screenshot; `document.querySelectorAll('.explorer mark')` text); `packages/shared/test/search.test.ts` › "returns merged highlight ranges for name, unit and description" (`volt` on `DCU_2B8h.HTR_HV_Volt` → name `[[16, 20]]`; `v_a disp` on `ICL_3A2h.SPEED_DISP` → `[[11, 16]]`) and › "returns highlight ranges in the shown name" (`volt` on `DCU_2B8h.HTR_HV_Volt` shown `HTR_HV_Volt` → shown `[[7, 11]]`; without `displayName` shown ranges equal name ranges; empty query → `[]`)

#### Scenario: Description match shown in the card
- **WHEN** the user searches for `temp` on real data and hovers `T_ENG` (`ENG_5E0h.T_ENG`, description `Motortemperatur`)
- **THEN** the row has no highlight in the name, rows whose name contains `TEMP` are listed above it, and the card shows `temp` highlighted in `Motortemperatur`
- **Evidence:** UI check (screenshot of the card)

#### Scenario: Overlapping occurrences of one term
- **WHEN** `searchSignals` runs the query `aa` over a signal named `AAA_X`, and the query `aba` over a signal named `ABABA.X`
- **THEN** the first match's `name` ranges are `[[0, 3]]`; the second's `[[0, 5]]`
- **Evidence:** `packages/shared/test/search.test.ts` › "highlights overlapping occurrences of one term"

#### Scenario: Ranges on the original text
- **WHEN** `searchSignals` runs the query `volt` over a signal named `ABC.İx_Volt` with unit `V`, the query `i` over the same signal, and the query `volt` over a signal named `DCU_2B8h.HTR_HV_Volt`
- **THEN** the first match's `name` ranges are `[[7, 11]]` (`Volt` in the original string), the second's `[[4, 5]]` (the `İ`), the third's `[[16, 20]]` as before; for each, `name` ranges sliced out of the original name give `Volt`, `İ` and `Volt`
- **Evidence:** `packages/shared/test/search.test.ts` › "keeps highlight ranges on the original text"

