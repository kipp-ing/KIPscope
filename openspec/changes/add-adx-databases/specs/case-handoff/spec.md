## ADDED Requirements

### Requirement: A catalog's data refs name a configured database
With two or more ADX databases, `KIPSCOPE_CASE_DATAREF` SHALL be able to carry the database as a literal prefix (`prod:{object}`), and opening a signed catalog SHALL be refused with `invalid_catalog` (400), naming the path of the first session, when a mapped data ref does not name a configured database. With one database the check SHALL not apply.

#### Scenario: Unknown database in a catalog
- **WHEN** databases `prod` and `test` are configured, `KIPSCOPE_CASE_DATAREF=prod:{object}`, and a signed catalog opens with objects `car1` and `car2`; then with `KIPSCOPE_CASE_DATAREF={object}` and the same catalog
- **THEN** the first opens with `case.dataRefs` `["prod:car1", "prod:car2"]` and a grant of exactly these; the second is refused with `invalid_catalog` naming `cases[0]`
- **Evidence:** `apps/server/test/case.http.test.ts` › "checks the database of a mapped data ref"
