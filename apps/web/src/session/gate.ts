import { CLOSE_NO_ACCESS, CLOSE_SESSION_GONE, type Me } from "@kipscope/shared";

/** What stops the page: an API answer (status and error code, e.g. an `ApiRequestError`) or a live close code. */
export type GateCause = { status: number; code: string } | { close: number } | number;

/** A page shown instead of the workspace (add-multiuser M12). */
export interface Gate {
  title: string;
  text?: string;
  /** Labels of the buttons: "My latest session" and "New session", or none. */
  actions: readonly string[];
}

export const LATEST_SESSION = "My latest session";
export const NEW_SESSION = "New session";
const SESSION_ACTIONS = [LATEST_SESSION, NEW_SESSION] as const;

/**
 * The gate page for an answer or a close code (design M12 "Gate pages"); undefined when it is none
 * of them (the caller shows the error as before). A bare number is a live close code.
 */
export function gateOf(cause: GateCause, me?: Pick<Me, "roles">): Gate | undefined {
  if (typeof cause === "number" || "close" in cause) {
    const close = typeof cause === "number" ? cause : cause.close;
    if (close === CLOSE_SESSION_GONE)
      return { title: "Session not found", actions: SESSION_ACTIONS };
    if (close === CLOSE_NO_ACCESS) {
      return { title: "No access to this session", actions: SESSION_ACTIONS };
    }
    return undefined;
  }
  const { status, code } = cause;
  if (status === 404 && code === "unknown_session") {
    return { title: "Session not found", actions: SESSION_ACTIONS };
  }
  if (status === 403 && code === "forbidden") {
    return { title: "No access to this session", actions: SESSION_ACTIONS };
  }
  if (status === 403 && code === "no_rights") {
    const roles = me?.roles.length ? me.roles.join(", ") : "none";
    return {
      title: "No access rights",
      text: `Your roles (${roles}) match no rule of this KIPscope server.`,
      actions: [],
    };
  }
  if (status === 401) return { title: "Not signed in", text: "Reload to sign in.", actions: [] };
  if (status === 503 && code === "identity_unavailable") {
    return { title: "Sign-in service unreachable", text: "Try again later.", actions: [] };
  }
  return undefined;
}
