# Spec Delta

## Purpose

Holds the state of the open workspace on the server and changes it only through commands, so the UI and later the CLI operate the same view through the same actions.

## ADDED Requirements

### Requirement: Server-held workspace
The server SHALL hold one open workspace consisting of windows, the signals assigned to each window, each window's time range and display options. Windows and signal assignments SHALL have stable IDs.

#### Scenario: Browser reload
- **WHEN** the browser reloads the page
- **THEN** it shows the same windows, signals and time ranges as before

### Requirement: Changes only through commands
The workspace SHALL change only by applying commands. The skeleton SHALL support at least: create window, remove window, add signal to window, remove signal from window, set window time range, set window display options.

#### Scenario: UI zoom is a command
- **WHEN** the user zooms a window in the UI
- **THEN** the UI sends a set-time-range command and the window's range changes only after the server accepts it

### Requirement: Command results
Every command SHALL get a machine-readable result: accepted with the resulting revision, or rejected with an error code and message. A rejected command SHALL leave the workspace unchanged.

#### Scenario: Unknown window
- **WHEN** a command references a window ID that does not exist
- **THEN** the command is rejected with an error code and the revision does not change

### Requirement: Revisions
Each accepted command SHALL increase the workspace revision by one. The current state and revision SHALL be readable at any time.

#### Scenario: Read state
- **WHEN** a caller reads the workspace
- **THEN** it receives the full state together with the current revision

### Requirement: Render acknowledgement
Connected browsers SHALL report the highest revision they have fully rendered, including whether the data needed for it was loaded successfully. The server SHALL expose this per revision.

#### Scenario: Rendered after load
- **WHEN** a command adds a signal and the browser has loaded its data and drawn it
- **THEN** the server reports that revision as rendered with data complete

#### Scenario: Rendered with load error
- **WHEN** the data for a revision failed to load
- **THEN** the server reports that revision as rendered with an error, not as complete

### Requirement: Signal limit
A workspace SHALL contain at most 50 distinct signals across all windows. A command that would exceed the limit SHALL be rejected.

#### Scenario: 51st signal
- **WHEN** 50 distinct signals are shown and a command adds another one
- **THEN** the command is rejected with a limit error
