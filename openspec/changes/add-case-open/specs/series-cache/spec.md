# Spec Delta

## ADDED Requirements

### Requirement: Tiles kept across scopes
A scope change SHALL NOT clear the tab's tiles. A tile fetched under scope S that lies fully inside S SHALL be stored for every scope: under another scope it SHALL answer only when it lies inside that scope and, for a raw tile without its `before` or `after` point, when that scope does not reach past S on that side. Runs in flight SHALL be keyed by tile and scope. Origin: Jan („idealerweise wird auch der cache im browser sehr lange gehalten"); exploration "Caching plan" 1, accepted by D-086 Q6.

#### Scenario: Back to a seen session
- **WHEN** a cache with a fake fetch loads one window's tiles under entry 0's scope of C4, the scope changes to entry 2's, then back to entry 0's, and the window asks for the same range
- **THEN** the third load makes no fetch and draws the same data as the first
- **Evidence:** `apps/web/test/cache.test.ts` › "keeps tiles across scopes"

#### Scenario: Cut raw tile under a wider scope
- **WHEN** a raw tile inside scope S has no `before` point, and the same tile is asked under a scope starting 1 h before S, then under a scope starting at S's start
- **THEN** the first asks the server again; the second is served from memory
- **Evidence:** `apps/web/test/cache.test.ts` › "refetches a cut raw tile under a wider scope"

### Requirement: Edge tiles stored under their scope
A tile fetched under scope S that reaches past S's edge SHALL be stored under `scopeKey(S)` and answer only while that key is active, else be fetched again. It SHALL weigh in the tile limit and LRU and be dropped by it or when its key leaves the per-scope LRU of 4, whichever comes first (design K12). Origin: lead's decision after round 3 (replaces "Edge tiles not stored"); necessary consequence of D-078 („das nachladen muss für die nächste halt auch noch klappen").

#### Scenario: Edge tiles stored under the scope
- **WHEN** a cache with a fake fetch, under scope A = `{testcar, 100 s, 200 s}`, runs bucket tiles covering [64 s, 128 s), [128 s, 192 s) and [192 s, 256 s), then asks for the same three tiles under A again
- **THEN** the second ask makes no fetch; the middle tile is stored for every scope, the two outer ones under A's key
- **Evidence:** `apps/web/test/cache.test.ts` › "stores edge tiles under the scope that fetched them"

#### Scenario: Edge tile reused only in its scope
- **WHEN** after "Edge tiles stored under the scope" the scope changes to B = `{testcar, 110 s, 210 s}` (same tiles, cut at both ends again) and the three tiles are asked; then the scope goes back to A and they are asked; then scopes B, C, D and E (four keys other than A's) are entered in turn, and the scope goes back to A once more
- **THEN** under B only [64 s, 128 s) and [192 s, 256 s) are fetched (the middle tile comes from memory); back under A nothing is fetched; after B, C, D, E (A's key dropped from the LRU of 4) the two outer tiles are fetched again and the middle one is not
- **Evidence:** `apps/web/test/cache.test.ts` › "uses an edge tile only in the scope that fetched it"

### Requirement: Extents and gap info per scope
Signal extents and gap info SHALL be kept for the 4 most recently used scope keys, the least recently used dropped; in an object scope gap info SHALL be keyed by data ref and work window. Origin: exploration "Caching plan" 1 („Keep extents and gap info per scope key in a small LRU of four"), accepted by D-086 Q6; 4: the server's kept scope lists (add-scope Z10).

#### Scenario: Four scopes
- **WHEN** the tab enters scopes A, B, C, D, then A again, then E, then B
- **THEN** returning to A asks no extent or gap request; E drops B (least recently used); B then asks again
- **Evidence:** `apps/web/test/rescope.test.ts` › "keeps extents and gap info for four scopes"
