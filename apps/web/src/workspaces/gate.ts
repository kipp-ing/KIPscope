import {
  CLOSE_NO_ACCESS,
  CLOSE_WORKSPACE_GONE,
  type Me,
  type WorkspaceSummary,
} from "@kipscope/shared";

/**
 * What stops the page: an API answer (status and error code, e.g. an `ApiRequestError`), a live
 * close code (also as a bare number), or the workspace's summary (its grant).
 */
export type GateCause =
  | { status: number; code: string }
  | { close: number }
  | { summary: Pick<WorkspaceSummary, "granted"> }
  | number;

/** A page shown instead of the workspace (add-multiuser M12). */
export interface Gate {
  title: string;
  text?: string;
  /** Labels of the buttons: "My latest workspace" and "New workspace", or none. */
  actions: readonly string[];
}

export const LATEST_WORKSPACE = "My latest workspace";
export const NEW_WORKSPACE = "New workspace";
const WORKSPACE_ACTIONS = [LATEST_WORKSPACE, NEW_WORKSPACE] as const;

const NOT_FOUND: Gate = { title: "Workspace not found", actions: WORKSPACE_ACTIONS };
const NO_ACCESS: Gate = { title: "No access to this workspace", actions: WORKSPACE_ACTIONS };
const EMPTY_GRANT: Gate = {
  title: "Open a session from KI.ping",
  text: "This workspace has no data yet. KI.ping decides which vehicles you may see: open a session there and it opens here.",
  actions: [],
};

/**
 * The gate page for an answer, a close code or a summary (design M12 "Gate pages"); undefined when
 * it is none of them (the caller shows the error as before). The empty grant gates only with an
 * identity other than `none`; it lifts once a summary with a grant arrives.
 */
export function gateOf(cause: GateCause, me?: Pick<Me, "identity">): Gate | undefined {
  if (typeof cause === "number" || "close" in cause) {
    const close = typeof cause === "number" ? cause : cause.close;
    if (close === CLOSE_WORKSPACE_GONE) return NOT_FOUND;
    if (close === CLOSE_NO_ACCESS) return NO_ACCESS;
    return undefined;
  }
  if ("summary" in cause) {
    const server = me !== undefined && me.identity !== "none";
    return server && cause.summary.granted === 0 ? EMPTY_GRANT : undefined;
  }
  const { status, code } = cause;
  if (status === 404 && code === "unknown_workspace") return NOT_FOUND;
  if (status === 403 && code === "forbidden") return NO_ACCESS;
  if (status === 401) return { title: "Not signed in", text: "Reload to sign in.", actions: [] };
  if (status === 503 && code === "identity_unavailable") {
    return { title: "Sign-in service unreachable", text: "Try again later.", actions: [] };
  }
  return undefined;
}
