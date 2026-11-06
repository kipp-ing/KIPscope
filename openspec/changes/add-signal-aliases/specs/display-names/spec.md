## MODIFIED Requirements

### Requirement: Name rules
`display.names` SHALL be an ordered list of rules, each a regular expression `match` with named groups and a template `show` over those groups (`{group}`). A signal without a dictionary entry (signal-aliases) SHALL show the `show` of the first rule matching its source name (without data reference); a group that did not take part renders empty. A signal with an entry shows its logical name instead; the rules do not apply to it. No matching rule, or an empty render, SHALL show the full source name. Origin: D-035 (rules, first match wins, full name without a match); empty render: design N3; dictionary: signal-aliases.

#### Scenario: First match wins
- **WHEN** rule 1 is `^(?<message>[^.]+?)_[0-9A-Fa-f]+h\.(?<signal>.+)$` / `{signal}` and rule 2 is `^(?<message>[^.]+)\.(?<signal>.+)$` / `{message}-{signal}`
- **THEN** `ICL_3A2h.SPEED_DISP` shows `SPEED_DISP`, `STR_0D4h.STEER_CHKSUM` shows `STEER_CHKSUM`, and `CLIM_A1.T_SET` shows `CLIM_A1-T_SET`
- **Evidence:** `apps/server/test/names.test.ts` › "takes the first matching rule and renders its template"

#### Scenario: No rule matches
- **WHEN** rule 1 is `^(?<message>[^.]+?)_[0-9A-Fa-f]+h\.(?<signal>.+)$` / `{signal}` and rule 2 is `^X(?<rest>.*)$` / `{rest}`
- **THEN** `VIN.VIN_1` shows `VIN.VIN_1` (no match), and `X` shows `X` (the second rule matches but renders empty)
- **Evidence:** `apps/server/test/names.test.ts` › "keeps the full name without a matching rule or with an empty render"

#### Scenario: A dictionary entry skips the rules
- **WHEN** rule 1 shortens `ICL_3A2h.SPEED_DISP` to `SPEED_DISP` and the dictionary maps it to `Speed`
- **THEN** it shows `Speed`; `STR_0D4h.STEER_CHKSUM`, with no entry, still shows `STEER_CHKSUM`
- **Evidence:** `apps/server/test/names.test.ts` › "ranks rename, alias, rules"
