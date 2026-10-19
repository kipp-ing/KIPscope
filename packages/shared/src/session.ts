import { z } from "zod";
import type { CommandResult, WorkspaceScope } from "./workspace.ts";

/** Session ID: 10 × [a-z0-9] (add-multiuser M4). */
export const SESSION_ID = /^[a-z0-9]{10}$/;
/** A user as an identity adapter names it (M1); also a folder name under `<stateDir>/users/`. */
export const USER_ID = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/;
/** The one user of `KIPSCOPE_IDENTITY=none` (D-084). */
export const LOCAL_USER = "local";
export const MAX_SESSIONS_PER_USER = 200;
/** Header naming the session an answer served (lower-case, as Node reports it). */
export const SESSION_HEADER = "x-kipscope-session";
/** Live channel close codes. */
export const CLOSE_NO_ACCESS = 4403;
export const CLOSE_SESSION_GONE = 4404;

export const SessionShare = z.enum(["private", "read", "write"]);
export type SessionShare = z.infer<typeof SessionShare>;

export interface SessionRights {
  open: true;
  change: boolean;
  owner: boolean;
}

export interface SessionSummary {
  id: string;
  owner: string;
  share: SessionShare;
  /** ISO */
  createdAt: string;
  /** ISO */
  lastActiveAt: string;
  revision: number;
  windows: number;
  scope?: WorkspaceScope;
  view?: { name?: string; title: string; modified: boolean };
  /** Measurement name. */
  measurement?: string;
  /** Open live connections. */
  clients: number;
  /** Of the requester; absent when they may not open it (an own session holding hidden data). */
  rights?: SessionRights;
}

/** The body of POST /api/views/open. */
export const OpenViewRequest = z.union([
  z.object({ name: z.string() }),
  z.object({ view: z.record(z.string(), z.unknown()) }),
]);
export type OpenViewRequest = z.infer<typeof OpenViewRequest>;
export const CreateSessionRequest = z.strictObject({ open: OpenViewRequest.optional() });
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;
export const ShareRequest = z.strictObject({ share: SessionShare });
export type ShareRequest = z.infer<typeof ShareRequest>;

export interface Me {
  user: string;
  /** "none", "oidc" or the module adapter's kind. */
  identity: string;
  roles: string[];
  rights: { data: string[]; share: boolean };
}
/** Own sessions, latest lastActiveAt first. */
export interface SessionList {
  sessions: SessionSummary[];
}
export interface SessionAnswer {
  session: SessionSummary;
}
export interface CreateSessionAnswer {
  session: SessionSummary;
  /** Of the open. */
  result?: CommandResult;
}

const LINK_PATH = /^\/(?:api\/)?s\/([^/]+)(\/.*)?$/;

/** "https://h/s/abc…" or "https://h/api/s/abc…/x" → {origin, session}; else undefined. */
export function parseSessionLink(url: string): { origin: string; session: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  const m = LINK_PATH.exec(parsed.pathname);
  if (m === null) return undefined;
  const id = m[1] ?? "";
  const rest = m[2];
  if (!SESSION_ID.test(id)) return undefined;
  // The UI path is the session page itself; only the API prefix carries a rest.
  if (!parsed.pathname.startsWith("/api/") && rest !== undefined && rest !== "/") return undefined;
  return { origin: parsed.origin, session: id };
}

export const sessionPath = (id: string) => `/s/${id}`;
export const sessionApi = (id: string) => `/api/s/${id}`;
