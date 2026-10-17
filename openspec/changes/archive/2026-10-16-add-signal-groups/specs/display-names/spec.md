## MODIFIED Requirements

### Requirement: Display names come from the server
The server SHALL compute every signal's shown name once per catalog load and deliver it in each catalog entry as `displayName`, absent when it equals `name`. Signal IDs, `name`, workspace state, commands and the CLI's arguments and output SHALL stay on the full source names. Origin: D-035 („CLI and API keep the stable full IDs"); server-side computation: necessary consequence of one source of truth for UI and API search (design N7).

#### Scenario: Catalog entry with a display name
- **WHEN** the server runs on real data with the shipped `kipscope.yaml`
- **THEN** `curl -s 'localhost:7310/api/signals?q=ICL_3A2h.SPEED_DISP' | jq -c '.items[0] | {id, name, displayName}'` prints `{"id":"smart451/ICL_3A2h.SPEED_DISP","name":"ICL_3A2h.SPEED_DISP","displayName":"SPEED_DISP"}`
- **Evidence:** the curl command; `apps/server/test/signals.http.test.ts` › "returns displayName in search and full catalog and keeps IDs" (test DB with the test project file: `testcar/Sna_800h.RPM` has `displayName` `RPM`, `testcar/Fast_100h.SIG_A` has none)

#### Scenario: All real signals shortened, none alike
- **WHEN** the server runs on real data with the shipped `kipscope.yaml`
- **THEN** `curl -s localhost:7310/api/catalog | jq '[.items[] | select(.displayName)] | length'` prints `428` and `curl -s localhost:7310/api/catalog | jq '[.items[].displayName] | unique | length'` prints `428`, and the server log has no display-name collision warning
- **Evidence:** the two curl commands; server log excerpt

#### Scenario: Identity unchanged
- **WHEN** the CLI runs `signal add w1 SPEED_DISP` against the server on real data with the shipped file, and the workspace is read
- **THEN** the CLI output and the workspace hold `smart451/ICL_3A2h.SPEED_DISP`, never `SPEED_DISP` as an ID
- **Evidence:** command `node apps/cli/src/main.ts signal add <window> SPEED_DISP` output; `curl -s localhost:7310/api/workspace | jq` excerpt

#### Scenario: No file, no field
- **WHEN** the catalog is built without a project file (test DB)
- **THEN** no entry has `displayName` (nor `group`, capability `signal-groups`) and every existing catalog `toEqual` test passes with no change other than `sender: "TEST"` in its `dbc` object (D-053)
- **Evidence:** `apps/server/test/catalog.test.ts` › "lists a signal without DBC entry with its name only" (unchanged) and › "merges DBC unit and comment as description" (only `sender` added)
