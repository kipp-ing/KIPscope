## ADDED Requirements

### Requirement: Time bounds in requests
Series requests SHALL accept only times between 1900-01-01T00:00:00Z and 2262-04-11T00:00:00Z inclusive and answer 400 `invalid_request` for a time outside, without querying the database. Origin: necessary consequence of the bug "window range 1036-01-11 … 3937-05-09" (times beyond int64 nanoseconds reached the API; design "Bug analysis").

#### Scenario: Series far beyond the data
- **WHEN** a client requests `/api/series?signal=smart451/CPC_448h.PTC_HV_Volt&from=-29473328485867940608&to=62083631947910636800`
- **THEN** the response is 400 with code `invalid_request` and a message naming the bounds
- **Evidence:** `apps/server/test/series.http.test.ts` › "rejects times outside the bounds with 400"; `curl -s -o /dev/null -w '%{http_code}' 'localhost:7310/api/series?signal=smart451/CPC_448h.PTC_HV_Volt&from=-29473328485867940608&to=62083631947910636800'` prints `400`
