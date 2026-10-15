## REMOVED Requirements

### Requirement: No value readout on hover
**Reason**: D-032 supersedes D-023's „no value readout on hover": „besides A and B a live cursor "L" follows the mouse … Every chart legend gets a 4th column L with each signal's value at the pointer time … Supersedes D-023's "no value readout on hover"."
**Migration**: Hover values are specified in `live-cursor` ("L column in every chart legend", "Near-signal highlight", "Highlight label"). The A, B and Δ cells and the values window's A/B cells still do not change while the pointer moves (cursors "Exact readout values", values-window "Values follow the cursors"); only the L cells do.
