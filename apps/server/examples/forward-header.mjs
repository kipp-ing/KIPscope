// Example identity adapter (add-multiuser M1): trusts the user and groups a forward-auth proxy
// sets, but only on requests from that proxy. Load it with
// KIPSCOPE_IDENTITY=module:apps/server/examples/forward-header.mjs (a path relative to the
// server's working directory, or absolute). Copy it to write your own adapter.
//
//   KIPSCOPE_TRUSTED_PROXIES  IPs and CIDRs of the proxy, comma-separated; default 127.0.0.1,::1
//   X-Forwarded-User          the user (letters, digits, . _ @ -; at most 64 characters)
//   X-Forwarded-Groups        the roles, comma-separated
//
// Only the proxy may reach KIPscope's port: anyone else could send these headers too, which is
// why the peer (the TCP connection, never X-Forwarded-For) is checked.
import { BlockList, isIP } from "node:net";

const USER = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/;

/** IPv4-mapped IPv6 (`::ffff:10.1.2.3`) as IPv4. */
const plain = (address) => address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");

function trustedProxies(list) {
  const proxies = new BlockList();
  for (const entry of list
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)) {
    const [address, prefix] = entry.split("/");
    const family = isIP(address) === 6 ? "ipv6" : isIP(address) === 4 ? "ipv4" : undefined;
    if (family === undefined)
      throw new Error(`KIPSCOPE_TRUSTED_PROXIES: not an IP or CIDR: ${entry}`);
    if (prefix === undefined) proxies.addAddress(address, family);
    else proxies.addSubnet(address, Number(prefix), family);
  }
  return proxies;
}

/** @type {import("../src/identity.ts").IdentityFactory} */
export default function forwardHeader({ env, log }) {
  const list = env.KIPSCOPE_TRUSTED_PROXIES || "127.0.0.1,::1";
  const proxies = trustedProxies(list);
  log.info(`forward-header: trusting X-Forwarded-User from ${list}`);
  return {
    kind: "forward-header",
    async identify(request) {
      const peer = plain(request.peer);
      const family = isIP(peer) === 6 ? "ipv6" : isIP(peer) === 4 ? "ipv4" : undefined;
      if (family === undefined || !proxies.check(peer, family))
        return { refused: "unauthenticated" };
      const user = request.headers["x-forwarded-user"]?.trim();
      if (!user) return { refused: "unauthenticated" };
      if (!USER.test(user)) return { refused: "invalid_token", reason: "bad user" };
      const groups = request.headers["x-forwarded-groups"] ?? "";
      const roles = [
        ...new Set(
          groups
            .split(",")
            .map((g) => g.trim())
            .filter(Boolean),
        ),
      ];
      return { user, roles };
    },
  };
}
