import { workspaceApi } from "@kipscope/shared";

// The workspace this page serves (add-multiuser M12): set once by the start-up, before the live
// channel opens; a page shows one workspace for its whole life (another workspace is another page).
let current: string | undefined;

/** Sets the page's workspace; every workspace-resolving call after it goes to `/api/w/<id>/…`. */
export function setWorkspace(id: string | undefined): void {
  current = id;
}

/** The page's workspace, undefined before the start-up chose one. */
export function currentWorkspace(): string | undefined {
  return current;
}

// Workspace-independent paths (design M6 levels public and user): the prefix stays off.
// `/api/views` and `/api/views/<name>` are the list, get and delete; save (`POST /api/views`)
// goes through `withWorkspace`. `/api/views/open` and `/api/views/import` act on the workspace.
const INDEPENDENT =
  /^\/api\/(?:license|me|workspaces(?:\/[^?]*)?|views(?:\/(?!open(?:[/?]|$)|import(?:[/?]|$))[^/?]+)?)(?:\?|$)/;

const PREFIXED = "/api/w/";

/** True for a path that serves one workspace (design M5 "Workspace-resolving routes"). */
export function resolvesWorkspace(path: string): boolean {
  return path.startsWith("/api/") && !path.startsWith(PREFIXED) && !INDEPENDENT.test(path);
}

/** `/api/<rest>` → `/api/w/<id>/<rest>`; unchanged without a workspace or for a prefixed path. */
export function withWorkspace(path: string, workspace: string | undefined = current): string {
  if (workspace === undefined || !path.startsWith("/api/") || path.startsWith(PREFIXED))
    return path;
  return `${workspaceApi(workspace)}${path.slice("/api".length)}`;
}

/** The address of an API call: prefixed with the workspace for workspace-resolving paths only. */
export function apiPath(path: string, workspace: string | undefined = current): string {
  return resolvesWorkspace(path) ? withWorkspace(path, workspace) : path;
}
