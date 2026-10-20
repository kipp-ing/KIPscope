import { z } from "zod";
import { type CaseOpenReport, OpenCasesRequest } from "./case.ts";
import { type CommandResult, DataRef, type WorkspaceScope } from "./workspace.ts";

/** Workspace ID: 10 × [a-z0-9] (add-multiuser M4). */
export const WORKSPACE_ID = /^[a-z0-9]{10}$/;
/** A user as an identity adapter names it (M1); also a folder name under `<stateDir>/users/`. */
export const USER_ID = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/;
/** The one user of `KIPSCOPE_IDENTITY=none` (D-084). */
export const LOCAL_USER = "local";
export const MAX_WORKSPACES_PER_USER = 200;
/** Header naming the workspace an answer served (lower-case, as Node reports it). */
export const WORKSPACE_HEADER = "x-kipscope-workspace";
/** Rows of the Recent list in the Views menu (M12). */
export const RECENT_WORKSPACES = 10;
/** Live channel close codes. */
export const CLOSE_NO_ACCESS = 4403;
export const CLOSE_WORKSPACE_GONE = 4404;
/** The UI address of round 1; the web reads `/s/<id>` as `/w/<id>` (M5). */
export const LEGACY_UI_PATH = "/s/";

/** Most data refs one grant holds (M3). */
export const MAX_GRANT_OBJECTS = 2000;

/** Data refs one workspace may read (D-085: the search tool decides; D-086: whole objects, no time part). */
export type Grant = { readonly objects: "all" } | { readonly objects: readonly string[] };
export const Grant: z.ZodType<Grant> = z.union([
  z.strictObject({ objects: z.literal("all") }),
  z.strictObject({
    objects: z
      .array(DataRef)
      .max(MAX_GRANT_OBJECTS)
      .refine((refs) => new Set(refs).size === refs.length, { message: "data refs repeat" }),
  }),
]);
export const GRANT_ALL: Grant = { objects: "all" };
export const GRANT_NONE: Grant = { objects: [] };
/** What a client learns of a grant: "all", or the number of objects (0 = nothing granted). */
export type Granted = "all" | number;

export const WorkspaceShare = z.enum(["private", "read", "write"]);
export type WorkspaceShare = z.infer<typeof WorkspaceShare>;

export interface WorkspaceRights {
  open: true;
  change: boolean;
  owner: boolean;
}

export interface WorkspaceSummary {
  id: string;
  owner: string;
  share: WorkspaceShare;
  /** M3; 0 on a server before a handoff. */
  granted: Granted;
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
  /** Of the requester; absent when they may not open it. */
  rights?: WorkspaceRights;
}

/** The body of POST /api/views/open. */
export const OpenViewRequest = z.union([
  z.object({ name: z.string() }),
  z.object({ view: z.record(z.string(), z.unknown()) }),
]);
export type OpenViewRequest = z.infer<typeof OpenViewRequest>;
export const CreateWorkspaceRequest = z.strictObject({
  /** A view (name or document) or a catalog (add-case-open K2). */
  open: z.union([OpenViewRequest, OpenCasesRequest]).optional(),
  /** Reuse a free workspace (M4); not together with open (400 bad_request). */
  reuse: z.literal(true).optional(),
});
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequest>;
export const ShareRequest = z.strictObject({ share: WorkspaceShare });
export type ShareRequest = z.infer<typeof ShareRequest>;

export interface Me {
  user: string;
  /** "none", "oidc" or the module adapter's kind. */
  identity: string;
  /** Shown only; decide nothing (D-085). */
  roles: string[];
  /** identity none → true; else KIPSCOPE_SHARE === "on". */
  canShare: boolean;
}
/** Own workspaces, latest lastActiveAt first. */
export interface WorkspaceList {
  workspaces: WorkspaceSummary[];
}
export interface WorkspaceAnswer {
  workspace: WorkspaceSummary;
}
export interface CreateWorkspaceAnswer {
  workspace: WorkspaceSummary;
  /** A free workspace was reused (M4). */
  reused?: boolean;
  /** Of the open. */
  result?: CommandResult;
  /** Of an open with a catalog (add-case-open K10). */
  case?: CaseOpenReport;
}

/** `/w/<id>`, `/api/w/<id>/<rest>` or the legacy UI path `/s/<id>`. */
const LINK_PATH = new RegExp(`^(/api/w/|/w/|${LEGACY_UI_PATH})([^/]+)(/.*)?$`);

/** "https://h/w/<id>", "https://h/api/w/<id>/x", and the legacy "https://h/s/<id>" → {origin, workspace}; else undefined. */
export function parseWorkspaceLink(url: string): { origin: string; workspace: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  const m = LINK_PATH.exec(parsed.pathname);
  if (m === null) return undefined;
  const [, kind, id = "", rest] = m;
  const api = kind === "/api/w/";
  if (!WORKSPACE_ID.test(id)) return undefined;
  // The UI path is the workspace page itself; only the API prefix carries a rest.
  if (!api && rest !== undefined && rest !== "/") return undefined;
  return { origin: parsed.origin, workspace: id };
}

export const workspacePath = (id: string) => `/w/${id}`;
export const workspaceApi = (id: string) => `/api/w/${id}`;
