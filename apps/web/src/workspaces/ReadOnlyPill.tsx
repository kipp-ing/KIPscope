import type { WorkspaceSummary } from "@kipscope/shared";
import "./workspaces.css";

/** The tooltip of the Read-only pill (add-multiuser M12). */
export const readOnlyTitle = (owner: string) =>
  `${owner} shares this workspace read-only. "Copy link (own copy)" gives you your own copy.`;

/** Shown in the top row while the user may open but not change the workspace. */
export function ReadOnlyPill({ summary }: { summary: WorkspaceSummary | undefined }) {
  if (!summary?.rights || summary.rights.change) return null;
  return (
    <span className="read-only-pill" title={readOnlyTitle(summary.owner)}>
      Read-only
    </span>
  );
}
