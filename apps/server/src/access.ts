/**
 * Access guard: only requests addressed to this machine or a configured origin, and from local
 * pages or a configured origin (design H3, add-multiuser M10).
 */
import type { IdentityConfig } from "./config.ts";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** 127.0.0.1, localhost, ::1 and [::1], case-insensitive. 0.0.0.0 and :: are not loopback. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host.toLowerCase());
}

export interface AccessOptions {
  /** KIPSCOPE_HOST when neither loopback nor 0.0.0.0/::. */
  extraHost?: string;
  /** KIPSCOPE_ORIGINS, normalised by `parseOrigins` (`https://h`, `http://h:8080`). */
  origins?: readonly string[];
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

/** Loopback name or extraHost, any port. */
function localHost(name: string, options: AccessOptions): boolean {
  if (isLoopbackHost(name)) return true;
  return options.extraHost !== undefined && name === hostName(options.extraHost);
}

/** Host header, port ignored: loopback name, extraHost or the host of a configured origin. Undefined → false. */
export function hostAllowed(host: string | undefined, options: AccessOptions): boolean {
  if (!host) return false;
  const name = hostName(host);
  if (localHost(name, options)) return true;
  return (options.origins ?? []).some((origin) => hostName(new URL(origin).host) === name);
}

/**
 * Undefined → true. Else an http:/https: URL with a loopback or extraHost name, any port, or
 * exactly a configured origin (scheme, host, port; default ports normalised). "null" → false.
 */
export function originAllowed(origin: string | undefined, options: AccessOptions): boolean {
  if (origin === undefined) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (localHost(hostName(url.host), options)) return true;
  return (options.origins ?? []).includes(url.origin);
}

/** What the start log needs of the config (a `Config` fits). */
export interface AccessLogConfig {
  host: string;
  port?: number;
  identity: IdentityConfig;
  /** KIPSCOPE_SHARE (M2). */
  share: boolean;
  origins: readonly string[];
}

const WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "[::]"]);

/** The access lines logged at start (add-multiuser M10); pure, so tests read them. */
export function accessLog(config: AccessLogConfig): { level: "info" | "warn"; message: string }[] {
  const lines: { level: "info" | "warn"; message: string }[] = [];
  const loopback = isLoopbackHost(config.host);
  const wildcard = WILDCARD_HOSTS.has(config.host);
  const { identity } = config;
  if (identity.kind === "none") {
    if (!loopback)
      lines.push({
        level: "warn",
        message:
          `KIPSCOPE_HOST ${config.host} is not loopback: every machine that reaches it can read signals and change the workspace` +
          (wildcard ? "; only loopback names pass the Host check" : ""),
      });
    return lines;
  }
  const who =
    identity.kind === "oidc"
      ? `identity oidc (issuer ${identity.oidc.issuer}, audience ${identity.oidc.audience})`
      : `identity module ${identity.path}`;
  lines.push({
    level: "info",
    message: `${who}; sharing ${config.share ? "on" : "off"}; origins ${config.origins.join(", ")}`,
  });
  if (!loopback)
    lines.push({
      level: "warn",
      message: `KIPSCOPE_HOST ${config.host} is not loopback: only the proxy should reach ${config.host}:${config.port ?? "its port"}`,
    });
  return lines;
}
