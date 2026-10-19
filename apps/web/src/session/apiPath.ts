import { sessionApi } from "@kipscope/shared";

// The session this page serves (add-multiuser M12): set once by the start-up, before the live
// channel opens; a page shows one session for its whole life (another session is another page).
let current: string | undefined;

/** Sets the page's session; every session-resolving call after it goes to `/api/s/<id>/…`. */
export function setSession(id: string | undefined): void {
  current = id;
}

/** The page's session, undefined before the start-up chose one. */
export function currentSession(): string | undefined {
  return current;
}

// Session-independent paths (design M6 levels public, identity, user): the prefix stays off.
// `/api/views` and `/api/views/<name>` are the list, get and delete; save (`POST /api/views`)
// goes through `withSession`. `/api/views/open` and `/api/views/import` act on the session.
const INDEPENDENT =
  /^\/api\/(?:license|me|sessions(?:\/[^?]*)?|views(?:\/(?!open(?:[/?]|$)|import(?:[/?]|$))[^/?]+)?)(?:\?|$)/;

/** True for a path that serves one session (design M5 "Session-resolving routes"). */
export function resolvesSession(path: string): boolean {
  return path.startsWith("/api/") && !path.startsWith("/api/s/") && !INDEPENDENT.test(path);
}

/** `/api/<rest>` → `/api/s/<id>/<rest>`; unchanged without a session or for a prefixed path. */
export function withSession(path: string, session: string | undefined = current): string {
  if (session === undefined || !path.startsWith("/api/") || path.startsWith("/api/s/")) return path;
  return `${sessionApi(session)}${path.slice("/api".length)}`;
}

/** The address of an API call: prefixed with the session for session-resolving paths only. */
export function apiPath(path: string, session: string | undefined = current): string {
  return resolvesSession(path) ? withSession(path, session) : path;
}
