## ADDED Requirements

### Requirement: Reusable buckets for aligned requests
For `from` and `to` multiples of `w` and target `(to − from) / w + 1`, an aggregated result SHALL have width exactly `w` and complete buckets, so a bucket comes back identical from every such request. Origin: necessary consequence of D-037 (3) (the browser cache combines buckets of different requests). Today's behaviour; no server code change.

#### Scenario: Same bucket from two aligned requests
- **WHEN** `testcar/Sna_800h.SPEED` is requested for `from` 1790820011732893696 to `to` 1790820080452370432 with target 513, and for `from` 1790820046092632064 to the same `to` with target 257
- **THEN** both results are aggregated with width `134217728`, and the second result's buckets equal, field by field (start, count, SNA count, mean, minimum, maximum), the first result's buckets that start at or after 1790820046092632064
- **Evidence:** `apps/server/test/series.test.ts` › "returns identical buckets for aligned requests that share them"

#### Scenario: Real speed, aligned
- **WHEN** a client requests `/api/series?signal=smart451/COMBI_412h.V_ANZ&from=1791896364897009664&to=1791896914652823552&target=513`
- **THEN** `jq -r '.kind, .width'` prints `buckets` and `1073741824`
- **Evidence:** the `curl` command against the dev server
