import { type Me, workspacePath } from "@kipscope/shared";
import { useState } from "react";
import { createWorkspace } from "../api.ts";
import { userItem } from "../footer/items.ts";
import { type Gate, LATEST_WORKSPACE, NEW_WORKSPACE } from "./gate.ts";
import "./workspaces.css";

/** Opens a new workspace in this tab. */
export async function openNewWorkspace(): Promise<void> {
  const answer = await createWorkspace({});
  if (!answer.workspace) throw new Error("no workspace was created");
  location.assign(workspacePath(answer.workspace.id));
}

/**
 * The page shown instead of the workspace (add-multiuser M12 "Gate pages"): a title, a text, and
 * for a missing or forbidden workspace "My latest workspace" (the start-up page `/`) and "New
 * workspace". Below the card, as the footer's user item says it, who the user is signed in as.
 */
export function GatePage({ gate, me }: { gate: Gate; me?: Me | undefined }) {
  const [error, setError] = useState<string | undefined>();
  const user = userItem(me);
  return (
    <div className="gate">
      <div className="gate-card" role="alert">
        <h1>{gate.title}</h1>
        {gate.text && <p>{gate.text}</p>}
        {gate.actions.length > 0 && (
          <div className="gate-actions">
            {gate.actions.includes(LATEST_WORKSPACE) && (
              <button type="button" className="primary" onClick={() => location.assign("/")}>
                {LATEST_WORKSPACE}
              </button>
            )}
            {gate.actions.includes(NEW_WORKSPACE) && (
              <button
                type="button"
                onClick={() =>
                  void openNewWorkspace().catch((e: unknown) =>
                    setError(e instanceof Error ? e.message : String(e)),
                  )
                }
              >
                {NEW_WORKSPACE}
              </button>
            )}
          </div>
        )}
        {error && <p className="gate-error">{error}</p>}
      </div>
      {user && <footer className="gate-user">{user.title}</footer>}
    </div>
  );
}
