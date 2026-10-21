# Handing sessions to KIPscope

For the implementers of a search tool (finder): how to send an ordered list of found sessions (a *catalog*) to KIPscope, so the user steps through them in one workspace without a page load. KIPscope does not search; the finder decides which sessions and, on a server, which vehicles the user may see (D-078, D-085, D-086). Design: [add-case-open](../openspec/changes/archive/2026-10-20-add-case-open/design.md) K2–K5, K15. Routes: [http-api.md](http-api.md). User side: [manual.md](manual.md).

The search tool is not part of KIPscope and is out of scope of this repo. KIPscope defines only this interface: the catalog document, its signature and the link. Any search tool that signs a catalog as described here works.

## The catalog document

One JSON document travels by link, file, CLI and API. Unknown keys are ignored at every level, so a finder may add its own.

```json
{
  "kipscope": "cases",
  "version": 1,
  "origin": { "tool": "search tool", "url": "https://finder.example/#f=1", "set": "search 42" },
  "current": 0,
  "pad": "60s",
  "align": { "mode": "start" },
  "view": "battery-dashboard",
  "cases": [
    {
      "id": "s-000001",
      "object": "WVWZZZ1KZAW000001",
      "kind": "driving",
      "from": "2026-10-01T01:00:00Z",
      "to": "2026-10-01T01:10:00Z",
      "title": "F-104",
      "meta": { "distance_km": 6.2, "soc_start": 81 },
      "anchor": "2026-10-01T01:04:30Z"
    }
  ]
}
```

### Top-level keys

| Key | Type | Required | Meaning |
|---|---|---|---|
| `kipscope` | `"cases"` | yes | Marks the document. |
| `version` | `1` | yes | Format version. |
| `cases` | array of sessions | yes | 1 to 2,000 sessions. Their order is the order of previous and next (see "Order"). |
| `current` | integer ≥ 0 | no | 0-based index of the session to open first; default 0; less than the number of sessions. |
| `pad` | duration text | no | Time shown before and after each session, e.g. `60s`, `500ms`, `2min`, `1h`; 0 to 1 day (`24h`). Default `KIPSCOPE_CASE_PAD` (60 s). |
| `align` | object | no | How a step keeps the moment (see "Alignment"); default `{"mode": "start"}`. |
| `view` | view name or view document | no | The layout to open with: the name of the user's saved view, or a whole view document (`{"kipscope": "view", …}`). Without it KIPscope takes the layout of the user's latest workspace. Only the layout is taken: each chart opens at the session scope `[from − pad, to + pad)` of `current`; the view's own chart times and cursors are not used. |
| `origin` | object | no | Where the catalog came from: `tool` (≤ 64 characters, shown in the tooltip and on the back link), `url` (≤ 2,048 characters, the back link to the finder; kept only when its origin is listed in `KIPSCOPE_FINDER_ORIGINS`, or, with `KIPSCOPE_IDENTITY=none` only, when it is an `http` or `https` URL on `localhost`, `127.0.0.1` or `[::1]`, any port; otherwise dropped with a warning in the open report), `set` (≤ 256 characters, your name for the result set). |

### Session keys

| Key | Type | Required | Meaning |
|---|---|---|---|
| `id` | string, 1–256 | yes | Your session ID; opaque to KIPscope, shown and sent back unchanged. |
| `object` | string, 1–128, no control characters | yes | The vehicle (VIN). Mapped to a KIPscope data ref by `KIPSCOPE_CASE_DATAREF`. |
| `from` | time | yes | Session start, inclusive. |
| `to` | time | yes | Session end, exclusive; after `from`. |
| `kind` | string, 1–32 | no | Shown in the session bar (`driving`, `charging`, `idle`). |
| `title` | string, ≤ 120 | no | Shown instead of the object (e.g. the fleet number). |
| `meta` | object, ≤ 16 keys | no | Shown in the bar and the catalog list; keys 1–64 characters, values string (≤ 200), number, boolean or null. |
| `anchor` | time | no | A moment inside the session (`from` ≤ `anchor` ≤ `to`) for `align` mode `anchor`. |

**Lengths:** every character limit above (`id`, `object`, `title`, `meta` keys and values, `origin` fields) counts UTF-16 code units, which is JavaScript's string `length`: `"é".length` is 1, `"😀".length` is 2. The inflated limit of the API (4,194,304 bytes) counts UTF-8 bytes of the JSON.

Times are ISO-8601 UTC with `Z` or an offset (`2026-10-01T01:00:00Z`, `2026-10-01T03:00:00+02:00`, nanoseconds allowed) or decimal nanoseconds since 1970 as a string. Within 1900-01-01 … 2262-04-11.

### Alignment

`align` is one of `{"mode": "start"}`, `{"mode": "end"}`, `{"mode": "anchor"}` or `{"mode": "event", "event": {"kind": "dtc", "source": "BMS", "name": "P0CA700"}}` (`event` also takes `text`, which then must match too, e.g. the state a change goes to). On every step each chart keeps its offset from the session's alignment point: its start, its end, its `anchor`, or its first matching event. A session without an anchor or a matching event is aligned to its start, and the user is told.

### Field mapping

How a search tool's session fields typically map to the catalog:

| Search tool | Catalog |
|---|---|
| the session's own ID | `id` |
| the vehicle (VIN) | `object` |
| the session's kind (drive, charge, idle) | `kind` |
| start and end (UTC, half-open) | `from`, `to` |
| a display name such as the fleet number | `title` |
| attributes | `meta` (the attribute name as the key) |
| the padding a plot shows around a session | `pad` (e.g. `"60s"`) |

## Order

KIPscope never sorts. The order of `cases` as sent is the only order of previous and next, of the positions (`3 / 17`) and of the catalog list. Sessions of different vehicles in any order are fine (D-085): send them in the order your result list shows them.

## Signature

On a server (any `KIPSCOPE_IDENTITY` other than `none`) KIPscope accepts a catalog only when it is signed by the finder: the signature is the access decision. The vehicles of a signed catalog become the new workspace's grant, with no time limit (D-086).

The signed form is a JWS in compact serialisation, `<header>.<payload>.<signature>`, all base64url:

- **Protected header:** `{"alg": "EdDSA", "kid": "<key id>", "typ": "kipscope-cases"}`. `alg` is `EdDSA` (Ed25519) or `ES256` (P-256) by default; the server allows what `KIPSCOPE_FINDER_ALGS` lists. `none` and `HS*` are never accepted.
- **Payload:** the bytes are **deflate-raw** (RFC 1951, no zlib or gzip header) of the UTF-8 JSON of the claims below, so the link is base64url once, not twice.
- **Claims:**

| Claim | Meaning |
|---|---|
| `iss` | Your issuer, compared exactly with `KIPSCOPE_FINDER_ISSUER`. |
| `aud` | The KIPscope server (string or array); must contain `KIPSCOPE_FINDER_AUDIENCE`. |
| `sub` | The Ping user the catalog is for. It must equal the user signed in to KIPscope (the claim named by `KIPSCOPE_FINDER_USER_CLAIM`, default `sub`), so a forwarded link opens for nobody else. |
| `iat` | Issued at, seconds since 1970. |
| `exp` | Expiry, seconds since 1970. |
| `cases` | The catalog document above. |

**Lifetime:** `exp − iat` must be at most `KIPSCOPE_FINDER_MAX_AGE` (default 1 h); sign with a lifetime of **10 minutes**, just before the user clicks. Clocks may differ by 30 s. The link is a one-click capability for its user: never log it, and do not put it in a URL query (the fragment `#cases=` never reaches a server log).

Example claims:

```json
{ "iss": "https://finder.example", "aud": "https://kipscope.example", "sub": "alice",
  "iat": 1792488000, "exp": 1792488600, "cases": { "kipscope": "cases", "version": 1, "cases": [ … ] } }
```

### Signing in Node with `jose`

```js
import { deflateRawSync } from "node:zlib";
import { CompactSign, importPKCS8 } from "jose";

const key = await importPKCS8(process.env.KIPSCOPE_SIGNING_KEY, "EdDSA"); // PKCS#8 PEM, Ed25519

export async function signCatalog(user, catalog) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: "https://finder.example",
    aud: "https://kipscope.example",
    sub: user,
    iat: now,
    exp: now + 600, // 10 min
    cases: catalog,
  };
  const payload = deflateRawSync(Buffer.from(JSON.stringify(claims), "utf8"));
  return new CompactSign(payload)
    .setProtectedHeader({ alg: "EdDSA", kid: "finder-2026-10", typ: "kipscope-cases" })
    .sign(key);
}
```

For P-256 use `importPKCS8(pem, "ES256")` and `alg: "ES256"`.

### Publishing the keys (JWKS)

KIPscope verifies against a JSON Web Key Set with your public keys, each with its `kid`:

```json
{ "keys": [ { "kty": "OKP", "crv": "Ed25519", "x": "…", "kid": "finder-2026-10", "alg": "EdDSA", "use": "sig" } ] }
```

Give it to the KIPscope operator as a file, or serve it at an `https` URL (`KIPSCOPE_FINDER_JWKS`). A URL is fetched again on an unknown `kid` (at most every 30 s), so rotation is: publish the new key next to the old one, sign with the new `kid`, drop the old key after the longest lifetime has passed.

### Server variables

What the KIPscope operator sets (details in the README):

| Variable | Default | Meaning |
|---|---|---|
| `KIPSCOPE_FINDER_JWKS` | unset | JWKS file path or `https` URL. Unset on a server: every catalog open answers `finder_not_configured`. |
| `KIPSCOPE_FINDER_ISSUER` | — | Required with the JWKS; the exact `iss`. |
| `KIPSCOPE_FINDER_AUDIENCE` | — | Required with the JWKS; must be in `aud`. |
| `KIPSCOPE_FINDER_ALGS` | `EdDSA,ES256` | Allowed algorithms, a subset of `EdDSA ES256 ES384 PS256 RS256`. |
| `KIPSCOPE_FINDER_USER_CLAIM` | `sub` | The claim compared with the signed-in user. |
| `KIPSCOPE_FINDER_MAX_AGE` | `1h` | Largest `exp − iat`, 1 min … 1 d. |
| `KIPSCOPE_FINDER_ORIGINS` | empty | Comma list of `http(s)://host[:port]` that `origin.url` may point to. With `KIPSCOPE_IDENTITY=none` a back link to `localhost`, `127.0.0.1` or `[::1]` on any port is kept without it. |
| `KIPSCOPE_CASE_DATAREF` | `{object}` | Template of a session's data ref; `{object}` is replaced by the object (`fleet-{object}`). |
| `KIPSCOPE_CASE_PAD` | `60s` | Pad when the catalog has none, 0 … 1 d. |

### Unsigned catalogs

With `KIPSCOPE_IDENTITY=none` (one local user, everything granted) KIPscope also takes the plain document and the unsigned code: base64url (no padding) of deflate-raw of the document's JSON, the same encoding as `#view=` links. A JWS is still verified there when `KIPSCOPE_FINDER_JWKS` is set. On a server both unsigned forms answer `signature_required`.

## The link

```
<KIPscope origin>/open#cases=<JWS or unsigned code>
```

- At most **8,192 characters** in all. Measured: 50 sessions unsigned are about 1,900 characters, 200 about 5,800.
- **Trimming (balanced trim):** if the link would be longer, drop, while it is too long, the far end of the longer side around `current` (on a tie the side before), keeping the order and every other key, and lower `current` by the number dropped before it; sign again. A short side is never emptied while the long side has more, so the neighbours on both sides stay as long as they can. Example: `current` 2 of 3,540 sessions with room for 213 keeps sessions 0 … 212 with `current` 2 (3,327 dropped after, none before). A catalog that does not fit with `current` alone cannot be linked (`link_too_long`). `trimCases` in `packages/shared/src/caseTrim.ts` implements the rule (it takes your encoder and bisects, about ⌈log2 n⌉ + 2 encodes; port it or call it), and `kipscope case url FILE --trim` prints the trimmed link of an unsigned catalog. For more sessions (up to 2,000) use a file or the API.
- **Open it in the named tab** `target="kipscope"` (`<a href="…" target="kipscope">` or `window.open(url, "kipscope")`), so every "Open in KIPscope" reuses one KIPscope tab instead of piling up tabs.
- **Opener rule:** KIPscope sets no `Cross-Origin-Opener-Policy`. The browser reuses the named tab only while the finder keeps the opener relationship to it, so do not use `noopener` (`rel="noopener"`, `window.open(url, "kipscope", "noopener")`) and do not send `Cross-Origin-Opener-Policy: same-origin` on the finder page (nor on a proxy in front of KIPscope); otherwise every click opens a new tab.
- Each open makes a new workspace; the catalog cannot be changed afterwards. KIPscope replaces the address with `/w/<id>`, so a reload stays in that workspace.

## File, CLI and API

The same string (JWS or unsigned code), or in `none` mode the plain document, also opens by:

- **File:** drop it on the KIPscope window.
- **CLI:** `kipscope case open FILE` or `… | kipscope case open -`; `kipscope case url FILE` prints the link, `--trim` trims an unsigned catalog that is too long (see "Trimming").
- **API:** `POST /api/workspaces` with `{"open": {"cases": "<JWS or code>"}}` (or the document as an object), at most 4,000,000 characters; the inflated JSON at most 4,194,304 bytes. The answer holds the new workspace and `case` (`count`, `current`, `dataRefs`, `missing`, `warnings`).

## Errors the user may see

A refused open shows the page "Could not open the sessions" with the code and message, and a button to the user's latest workspace.

| Code | HTTP | Cause | Fix in the finder |
|---|---|---|---|
| `invalid_catalog` | 400 | The document is malformed; the message names the first bad path (`cases[3].to: must be after from`), or it is too large. | Fix the payload; trim it. |
| `signature_required` | 403 | Unsigned catalog on a server. | Sign it. |
| `invalid_signature` | 403 | The JWS did not verify; `reason` is `bad_signature`, `unknown_key`, `algorithm`, `expired`, `not_yet_valid`, `lifetime`, `issuer`, `audience` or `malformed`. | Check key, `kid`, `alg`, clocks, lifetime, `iss`, `aud`, the deflate-raw payload. |
| `wrong_user` | 403 | `sub` is not the signed-in user (a forwarded link). | Sign for the user who clicks. |
| `finder_not_configured` | 503 | The server has no `KIPSCOPE_FINDER_JWKS`. | Ask the operator. |
| `finder_keys_unavailable` | 503 | The JWKS URL could not be fetched and never loaded. | Check the JWKS URL. |
| `catalog_unavailable` | 503 | The first session's signal list could not be loaded. | Retry later. |
| `workspace_limit` | 409 | The user holds the most workspaces and none can make room. | The user closes a KIPscope tab. |

`invalid_catalog` refuses the catalog as a whole: one bad session refuses them all, no session is skipped. Check every entry before you sign.
