import type { SessionSummary } from "@kipscope/shared";
import "./session.css";

/** The tooltip of the Read-only pill (add-multiuser M12). */
export const readOnlyTitle = (owner: string) =>
  `${owner} shares this session read-only. Copy link opens your own copy.`;

/** Shown in the top row while the user may open but not change the session. */
export function ReadOnlyPill({ session }: { session: SessionSummary | undefined }) {
  if (!session?.rights || session.rights.change) return null;
  return (
    <span className="read-only-pill" title={readOnlyTitle(session.owner)}>
      Read-only
    </span>
  );
}
