# signal-catalog Specification

## Purpose
Lets users and other callers discover which signals a data source offers and read their metadata, so they can find the signals relevant to an investigation.

## Requirements

### Requirement: Catalog contents
The catalog SHALL list exactly the signals that have data in the source, per data reference (for vehicle data: the vehicle). Signals that exist only in metadata files SHALL NOT be listed.

#### Scenario: Signal defined in DBC without data
- **WHEN** a DBC file defines a signal that never occurs in the database
- **THEN** the catalog does not list it

### Requirement: Signal identity
Each signal SHALL have a stable ID built from its data reference and its name in the source, which does not change between server restarts.

#### Scenario: Same ID after restart
- **WHEN** the server restarts against the same data source
- **THEN** every signal keeps the ID it had before

### Requirement: Signal metadata
The catalog SHALL return for each signal its name and, where available, its description, alias and unit. Metadata the source lacks SHALL come from configured metadata files (DBC). Missing fields SHALL be reported as absent, not as empty strings or invented values.

#### Scenario: Unit from DBC
- **WHEN** a signal `MS_312h.DNMOT` has data and the DBC defines unit and comment for signal `DNMOT` in message `MS_312h`
- **THEN** the catalog entry shows that unit and the comment as description

#### Scenario: Signal not in any DBC
- **WHEN** a signal has data but no DBC entry
- **THEN** the catalog lists it with its name only and no unit, description or alias

### Requirement: Signal search
The catalog SHALL support a case-insensitive text search that matches the query against name, description, alias and unit, and SHALL return results within a bounded page size.

#### Scenario: Match by description
- **WHEN** a user searches for a term that only occurs in a signal's description
- **THEN** that signal is in the results

#### Scenario: Large catalog
- **WHEN** the source has 10,000 signals and the query matches most of them
- **THEN** the result is limited to one page and indicates that more matches exist

### Requirement: Signal explorer in the UI
The UI SHALL offer a signal explorer that searches the catalog, shows the metadata of each result, and lets the user add a signal to a window.

#### Scenario: Add signal from explorer
- **WHEN** the user searches, selects a result and adds it to a window
- **THEN** the signal appears in that window
