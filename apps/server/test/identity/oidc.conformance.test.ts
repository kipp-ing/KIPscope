import type { IdentityRequest } from "../../src/identity.ts";
import { claims, jwksServer, makeKey, signHs256, signToken, unsignedToken } from "../jwks.ts";
import { identityConformance } from "./conformance.ts";
import { AUDIENCE, oidcAdapter } from "./oidcKit.ts";

const request = (headers: Record<string, string>): IdentityRequest => ({
  headers,
  peer: "127.0.0.1",
  method: "GET",
  path: "/api/me",
});
const bearer = (token: string) => request({ authorization: `Bearer ${token}` });

identityConformance("oidc", async () => {
  const key = makeKey("RS256");
  const other = makeKey("RS256", key.kid);
  const jwks = await jwksServer([key]);
  const adapter = await oidcAdapter(jwks);
  const base = { iss: jwks.issuer, aud: AUDIENCE };
  const now = Math.floor(Date.now() / 1000);
  const pem = key.publicKey.export({ type: "spki", format: "pem" }) as string;
  return {
    adapter,
    signedIn: {
      request: bearer(
        signToken(key, claims({ sub: "alice", roles: ["testers", "viewers"] }, base)),
      ),
      user: "alice",
      roles: ["testers", "viewers"],
    },
    missing: request({}),
    forged: [
      bearer("garbage"),
      bearer("a.b.c"),
      // Signed by another key under the published key's ID.
      bearer(signToken(other, claims({}, base))),
      bearer(unsignedToken(claims({}, base))),
      bearer(signHs256(pem, claims({}, base), { kid: key.kid })),
      bearer(signToken(key, claims({ iss: "https://evil.example" }, base))),
      bearer(signToken(key, claims({ aud: "someone-else" }, base))),
      bearer(signToken(key, claims({ exp: now - 600 }, base))),
      bearer(signToken(key, claims({ nbf: now + 600 }, base))),
      bearer(signToken(key, claims({ sub: "../x" }, base))),
      request({ authorization: "Bearer" }),
      request({ authorization: "" }),
    ],
    close: () => jwks.close(),
  };
});
