# Spec Delta

## ADDED Requirements

### Requirement: Tiles kept across scopes
A scope change SHALL NOT clear the tab's tiles. A tile fetched under scope S SHALL be stored only when it lies fully inside S; under another scope it SHALL answer only when it lies inside that scope and, for a raw tile without its `before` or `after` point, when that scope does not reach past S on that side; runs in flight SHALL be keyed by tile and scope. Origin: Jan („idealerweise wird auch der cache im browser sehr lange gehalten"); exploration "Caching plan" 1, accepted by D-086 Q6.

#### Scenario: Back to a seen session
- **WHEN** a cache with a fake fetch loads one window's tiles under entry 0's scope of C4, the scope changes to entry 2's, then back to entry 0's, and the window asks for the same range
- **THEN** the third load makes no fetch and draws the same data as the first
- **Evidence:** `apps/web/test/cache.test.ts` › "keeps tiles across scopes"

#### Scenario: Edge tiles not stored
- **WHEN** under scope [100 s, 200 s) a run answers tiles covering [64 s, 128 s), [128 s, 192 s) and [192 s, 256 s)
- **THEN** only the middle tile is stored; a later request for [64 s, 128 s) under the same scope fetches again
- **Evidence:** `apps/web/test/cache.test.ts` › "stores only tiles inside the scope they were fetched under"

#### Scenario: Cut raw tile under a wider scope
- **WHEN** a raw tile inside scope S has no `before` point, and the same tile is asked under a scope starting 1 h before S, then under a scope starting at S's start
- **THEN** the first asks the server again; the second is served from memory
- **Evidence:** `apps/web/test/cache.test.ts` › "refetches a cut raw tile under a wider scope"

### Requirement: Extents and gap info per scope
Signal extents and gap info SHALL be kept for the 4 most recently used scope keys, the least recently used dropped; in an object scope gap info SHALL be keyed by data ref and work window. Origin: exploration "Caching plan" 1 („Keep extents and gap info per scope key in a small LRU of four"), accepted by D-086 Q6; 4: the server's kept scope lists (add-scope Z10).

#### Scenario: Four scopes
- **WHEN** the tab enters scopes A, B, C, D, then A again, then E, then B
- **THEN** returning to A asks no extent or gap request; E drops B (least recently used); B then asks again
- **Evidence:** `apps/web/test/rescope.test.ts` › "keeps extents and gap info for four scopes"
