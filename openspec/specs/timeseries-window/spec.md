# timeseries-window Specification

## Purpose
Displays one or more signals over time in a window and lets the user navigate from a long overview down to individual raw measurements.

## Requirements

### Requirement: Overview display
When a window shows aggregated buckets, each signal SHALL be drawn as a curve of the bucket means. Aggregated display SHALL be visibly distinguishable from raw display.

#### Scenario: Long range
- **WHEN** a window shows ten hours of a 5 ms signal
- **THEN** it draws the bucket means and indicates that the view is aggregated

### Requirement: Min/max envelope
A window SHALL offer an envelope option, off by default, that draws the minimum and maximum of each bucket around the mean curve.

#### Scenario: Spike in overview
- **WHEN** the envelope is on and a single raw spike lies inside one bucket
- **THEN** the envelope reaches the spike's value

### Requirement: Raw display modes
When a window shows raw points, each signal SHALL be drawable as lines between points, as steps holding the previous value, or with point markers, as chosen in the window's display options.

#### Scenario: Step mode
- **WHEN** step mode is selected
- **THEN** the curve holds each value until the next point's timestamp

### Requirement: No invented values
The window SHALL NOT draw a curve segment where no measured point exists on at least one side; it SHALL use edge neighbors from the query to draw segments that cross the visible range edges.

#### Scenario: Window inside a gap between points
- **WHEN** the visible range contains no point but has neighbors on both sides
- **THEN** the line or step through the window is drawn from those neighbors

#### Scenario: Before the first point
- **WHEN** the visible range starts before the signal's first point
- **THEN** nothing is drawn before that point

### Requirement: Independent zoom and pan
Each window SHALL have its own time range. Zooming and panning in one window SHALL NOT change other windows.

#### Scenario: Zoom one of two windows
- **WHEN** the user zooms into window 1
- **THEN** window 2 keeps its time range

### Requirement: Reload on navigation
After a zoom or pan, the window SHALL request data for the new range and resolution, keep showing the already loaded data meanwhile, and replace it when the new data arrives.

#### Scenario: Zoom into detail
- **WHEN** the user zooms from an aggregated view into a range with few raw points
- **THEN** the window loads and shows the raw points

### Requirement: Stale responses discarded
A response for an earlier time range or revision SHALL NOT replace data for a newer one.

#### Scenario: Out-of-order responses
- **WHEN** the user zooms twice quickly and the first response arrives after the second
- **THEN** the window shows the data of the second zoom

### Requirement: Loading and error state
A window SHALL show per signal whether data is loading, complete, or failed, including the error message on failure.

#### Scenario: Query fails
- **WHEN** the query for one signal fails
- **THEN** the window marks that signal as failed and keeps showing the other signals

### Requirement: Time axis precision
The time axis SHALL display local time and SHALL be able to label ticks down to the precision of the data, including sub-millisecond steps.

#### Scenario: Microsecond zoom
- **WHEN** the visible range is 100 µs wide
- **THEN** tick labels distinguish microseconds
