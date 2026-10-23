# Rounds: add-computed-signals

- Round 1: needs_jan (lead) — build, tests and lint are green and most scenarios are fulfilled, but M1 cannot pass as written (design.md M1 searches between the two clicks, yet the existing "Selection lifetime" requirement, D-066, clears the selection on a query change, and the prefill is in list order) so the spec owner must rewrite M1; the Q-8 race (new row not active / not added after Save) is a plain code fix, "Gap marks on real data" has no logger gaps in smart451 and M7 is the lead's timing.
