## Purpose

User-defined information about the measurement under investigation (its name, the measurement object, further key/value entries), held in the workspace, started from the project file and changed by commands, so the UI shows it and the CLI reads and sets it like every other part of the open view.

## ADDED Requirements

### Requirement: Measurement info in the workspace
The workspace SHALL hold optional measurement info as `measurement` (design F6): a `name`, an `object` (vehicle or device under test) and an ordered `meta` list of `{key, value}` with unique keys. Empty fields SHALL be absent, and so SHALL an empty `measurement`. It SHALL travel with the workspace (`GET /api/workspace`, live pushes, `kipscope state`). Origin: Jan, 2026-10-16: „meta info shall be cli settable or yaml definable. so like measurement name, measurement object, measurement meta".

#### Scenario: Absent by default
- **WHEN** the server starts without a `measurement` section in the project file and `curl -s localhost:7310/api/workspace | jq -c '.workspace.measurement'` runs
- **THEN** it prints `null` (the key is absent)
- **Evidence:** `packages/shared/test/apply.test.ts` › "sets, replaces and clears measurement info" (EMPTY_WORKSPACE has no `measurement`); the `curl` command

#### Scenario: Read by the CLI
- **WHEN** the workspace holds measurement name `Testfahrt A9`, object `smart451` and meta `[{key: "driver", value: "Jan"}]` and `kipscope state` runs
- **THEN** `data.workspace.measurement` is `{"name":"Testfahrt A9","object":"smart451","meta":[{"key":"driver","value":"Jan"}]}`
- **Evidence:** `apps/cli/test/cli.test.ts` › "sets and reads measurement info over HTTP"

### Requirement: Measurement commands
Measurement info SHALL change only by commands, one revision each: `measurement.set {name?, object?}` sets the given fields, a blank one clears its field; `measurement.setMeta {key, value}` replaces an existing key's value in place or appends a new key, a blank value removes the entry; `measurement.clear` removes all. Texts SHALL be trimmed; `measurement.set {}` SHALL be rejected with `invalid_command`. Origin: Jan („cli settable"); concept §7, D-011 (D8); design F6.

#### Scenario: Set, replace and clear
- **WHEN** on an empty workspace the commands `measurement.set {name: "  Testfahrt A9 "}`, `measurement.set {object: "smart451"}`, `measurement.setMeta {key: "driver", value: "Jan"}`, `measurement.setMeta {key: "weather", value: "rain"}`, `measurement.setMeta {key: "driver", value: "Eva"}`, `measurement.setMeta {key: "weather", value: " "}`, `measurement.set {name: ""}` and `measurement.clear {}` are applied in turn
- **THEN** each is accepted with one revision; after the fifth `measurement` is `{name: "Testfahrt A9", object: "smart451", meta: [{key: "driver", value: "Eva"}, {key: "weather", value: "rain"}]}`; after the sixth `meta` holds only `driver`; after the seventh `name` is absent; after the last `measurement` is absent
- **Evidence:** `packages/shared/test/apply.test.ts` › "sets, replaces and clears measurement info"

#### Scenario: Set without a field
- **WHEN** `measurement.set {}` is posted to `POST /api/commands`
- **THEN** it is rejected with `invalid_command` and the revision does not change
- **Evidence:** `packages/shared/test/apply.test.ts` › "rejects measurement info beyond its limits"

#### Scenario: Pushed and rendered
- **WHEN** the UI is open and `kipscope --wait measurement name "Testfahrt A9"` runs
- **THEN** it exits 0 with `render.status` `complete`, and the footer shows `Testfahrt A9` without a reload
- **Evidence:** UI check (CLI output and a screenshot of the footer right after)

### Requirement: Measurement limits
`name` and `object` SHALL be at most 120 characters; a meta key at most 40, starting with a letter and holding only letters, digits, space, `_`, `.` and `-`; a meta value at most 200; no text SHALL hold a control character (line breaks included). Breaking one SHALL be rejected with `invalid_command`, a ninth meta entry with `measurement_limit`, the workspace unchanged. Origin: necessary consequences of the one-line footer and of bounded client input (as D-046's limits); numbers per design F6.

#### Scenario: Over the limits
- **WHEN** commands set a name of 121 characters, a meta key `1st`, a key of 41 characters, a value of 201 characters, a name with a line break, and, with eight entries present, a ninth key
- **THEN** the first five are rejected with `invalid_command`, the last with `measurement_limit`, and the revision is unchanged after each; a name of exactly 120 characters and an eighth entry are accepted
- **Evidence:** `packages/shared/test/apply.test.ts` › "rejects measurement info beyond its limits"

### Requirement: Start value from the project file
The project file (read once at start, `display-names` "Project file location") MAY hold a `measurement` section with `name`, `object` and `meta` (a map, in file order) under the same limits. It SHALL set the workspace's measurement info at revision 0; numbers and booleans count as their text, `null` and empty as absent. Commands SHALL win until the server restarts; nothing SHALL write the file. Origin: Jan („yaml definable"); precedence per the lead's recommendation, design F7, Q5.

#### Scenario: Start value
- **WHEN** the project file holds `measurement: {name: Testfahrt A9, object: smart451, meta: {driver: Jan, run: 3, wet: true, note: null}}` and the server starts
- **THEN** `GET /api/workspace` at revision 0 shows `measurement` `{name: "Testfahrt A9", object: "smart451", meta: [{key: "driver", value: "Jan"}, {key: "run", value: "3"}, {key: "wet", value: "true"}]}`
- **Evidence:** `apps/server/test/project.test.ts` › "reads the measurement section"; `apps/server/test/workspace.http.test.ts` › "starts with the measurement from the project file"

#### Scenario: Commands win until restart
- **WHEN** the server started with the shipped `kipscope.yaml` (object `smart451`), `kipscope measurement object testcar` runs, and the server is restarted
- **THEN** after the command the object is `testcar`; after the restart it is `smart451` again and the file is unchanged
- **Evidence:** lead's manual check (`curl -s localhost:7310/api/workspace | jq -r .workspace.measurement.object` before and after `scripts/restart-server.sh`; `git diff --quiet kipscope.yaml`)

#### Scenario: Display rules unchanged
- **WHEN** the shipped `kipscope.yaml` is loaded, and a file with only a `measurement` section is loaded
- **THEN** the first gives the same display rules as before this change and the measurement info `{object: "smart451"}` (Jan, Q7); the second gives no rules and the measurement info
- **Evidence:** `apps/server/test/project.test.ts` existing tests stay green, plus › "reads the measurement section"

### Requirement: Invalid measurement section stops the server
A `measurement` section with an unknown key, a text over its limit, a bad meta key, more than 8 meta entries or a value that is not text, a number or a boolean SHALL stop the server before it listens, like an invalid display section: exit code 1 and one line per problem in the form `<path>: <field>: <problem>`. Origin: necessary consequence of `display-names` "Invalid project file stops the server" (one rule for the whole file; a typo must not pass silently).

#### Scenario: Invalid section
- **WHEN** the project file's `measurement` has an unknown key `objekt`, a name of 121 characters, a meta key `1st`, nine meta entries, or a meta value that is a list under key `tags`
- **THEN** parsing fails with one line per problem, among them `measurement: unknown key "objekt"`, `measurement.name: at most 120 characters`, `measurement.meta.1st: key must start with a letter`, `measurement.meta: at most 8 entries` and `measurement.meta.tags: must be text, a number or true/false`
- **Evidence:** `apps/server/test/project.test.ts` › "refuses an invalid measurement section"

### Requirement: Example file documents the section
`kipscope.example.yaml` SHALL explain the `measurement` section, each of its keys, the limits and that commands win until restart; README SHALL list the four CLI forms of `cli` "Measurement commands". Origin: necessary consequence of `display-names` "smart451 project file shipped" (the example explains every key).

#### Scenario: Documented
- **WHEN** `grep -n "measurement" kipscope.example.yaml README.md` runs
- **THEN** it finds the section with `name`, `object` and `meta` in the example file and the four CLI forms in README
- **Evidence:** the `grep` command
