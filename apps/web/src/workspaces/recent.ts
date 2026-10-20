import { RECENT_WORKSPACES, type WorkspaceSummary, workspacePath } from "@kipscope/shared";
import { sinceText, workspaceTitle } from "./title.ts";

export { sinceText, workspaceTitle };

/** One row of "Recent workspaces" in the Views menu (add-multiuser M12). */
export interface RecentRow {
  id: string;
  /** `/w/<id>`: a plain link, so a middle or Ctrl click opens a new tab. */
  href: string;
  title: string;
  /** The relative last-active time. */
  since: string;
  /** The page's own workspace. */
  current: boolean;
  /** It has open live connections: the row shows `●`. */
  dot: boolean;
}

/**
 * The first `RECENT_WORKSPACES` of the user's own workspaces in list order (the server's, latest
 * first), the current one marked.
 */
export function recentRows(
  summaries: readonly WorkspaceSummary[],
  currentId: string | undefined,
  now: number = Date.now(),
  timeZone?: string,
): RecentRow[] {
  return summaries.slice(0, RECENT_WORKSPACES).map((s) => ({
    id: s.id,
    href: workspacePath(s.id),
    title: workspaceTitle(s, timeZone),
    since: sinceText(s.lastActiveAt, now),
    current: s.id === currentId,
    dot: s.clients > 0,
  }));
}
