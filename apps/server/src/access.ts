/** Access guard: only requests addressed to this machine and from local pages (design H3). */

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** 127.0.0.1, localhost, ::1 and [::1], case-insensitive. 0.0.0.0 and :: are not loopback. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host.toLowerCase());
}

export interface AccessOptions {
  /** KIPSCOPE_HOST when neither loopback nor 0.0.0.0/::. */
  extraHost?: string;
}

/** Host name without port and IPv6 brackets, lower case. */
function hostName(host: string): string {
  const lower = host.toLowerCase();
  if (lower.startsWith("[")) {
    const end = lower.indexOf("]");
    return end < 0 ? lower : lower.slice(1, end);
  }
  // One colon separates the port; more than one is a bare IPv6 address.
  const colon = lower.indexOf(":");
  return colon >= 0 && colon === lower.lastIndexOf(":") ? lower.slice(0, colon) : lower;
}

/** Host header without port: loopback name or extraHost. Undefined → false. */
export function hostAllowed(host: string | undefined, options: AccessOptions): boolean {
  if (!host) return false;
  const name = hostName(host);
  if (isLoopbackHost(name)) return true;
  return options.extraHost !== undefined && name === hostName(options.extraHost);
}

/** Undefined → true. Else http:/https: URL whose hostname passes hostAllowed. "null" → false. */
export function originAllowed(origin: string | undefined, options: AccessOptions): boolean {
  if (origin === undefined) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return hostAllowed(url.hostname, options);
}
