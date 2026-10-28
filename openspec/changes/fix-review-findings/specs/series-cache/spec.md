## MODIFIED Requirements

### Requirement: Tiles kept across scopes
A scope change SHALL NOT clear the tab's tiles. A tile fetched under scope S that lies fully inside S SHALL be stored for every scope: under another scope it SHALL answer only when it lies inside that scope and, for a raw tile without its `before` or `after` point, when that scope does not reach past S on that side. A raw tile that answers under a scope SHALL answer without its `before` point when that point lies before the scope's start, and without its `after` point when that point lies at or after the scope's end, as the server's answer under that scope would be; the stored tile keeps both points. Runs in flight SHALL be keyed by tile and scope. Origin: Jan („idealerweise wird auch der cache im browser sehr lange gehalten"); exploration "Caching plan" 1, accepted by D-086 Q6; edge points: review day 2026-10-28 T-05 (a tile kept its edge point under a scope that excludes it, so the line ran to a point outside the scope; reproduced in a throw-away test), necessary consequence of scope "every query bounded by the scope".

#### Scenario: Back to a seen session
- **WHEN** a cache with a fake fetch loads one window's tiles under entry 0's scope of C4, the scope changes to entry 2's, then back to entry 0's, and the window asks for the same range
- **THEN** the third load makes no fetch and draws the same data as the first
- **Evidence:** `apps/web/test/cache.test.ts` › "keeps tiles across scopes"

#### Scenario: Cut raw tile under a wider scope
- **WHEN** a raw tile inside scope S has no `before` point, and the same tile is asked under a scope starting 1 h before S, then under a scope starting at S's start
- **THEN** the first asks the server again; the second is served from memory
- **Evidence:** `apps/web/test/cache.test.ts` › "refetches a cut raw tile under a wider scope"

#### Scenario: Edge points outside a narrower scope
- **WHEN** a cache with a fake fetch loads a raw tile under scope S whose answer has a `before` point 5 s before the tile's start and an `after` point 5 s after its end; then the same tile is asked under scope S2, which starts 2 s before the tile's start and ends 2 s after its end; then under S3, which starts 10 s before the tile's start and ends 10 s after its end; then under S again
- **THEN** none of the three later asks makes a fetch; under S2 the tile has neither `before` nor `after`; under S3 and under S it has both, equal to the first answer's
- **Evidence:** `apps/web/test/cache.test.ts` › "drops edge points outside the asking scope"
