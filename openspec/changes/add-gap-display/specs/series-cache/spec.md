## ADDED Requirements

### Requirement: Gaps across tile edges
Breaks, SNA marks and drawn values at gaps SHALL be the same whether a view's data comes from one request or is stitched from tiles, including a split whose two points lie in different tiles. Origin: necessary consequence of D-062 and series-cache "Same drawn data as without cache" (gaps are found on the stitched result, never per tile).

#### Scenario: Dropout at a tile edge
- **WHEN** raw points of a 20 ms signal with a dropout from the last point of one tile to the first point of the next are stitched for a view over both tiles, and the same points come back as one raw result
- **THEN** both give the same drawn columns (with the break) and the same drawn value inside the dropout (none `period_gap`)
- **Evidence:** `apps/web/test/build.test.ts` › "breaks a gap across a tile edge like one request"
