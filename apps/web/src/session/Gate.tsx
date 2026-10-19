import { sessionPath } from "@kipscope/shared";
import { useState } from "react";
import { createSession } from "../api.ts";
import { type Gate, LATEST_SESSION, NEW_SESSION } from "./gate.ts";
import "./session.css";

/** Opens a new session in this tab. */
export async function openNewSession(): Promise<void> {
  const answer = await createSession({});
  if (!answer.session) throw new Error("no session was created");
  location.assign(sessionPath(answer.session.id));
}

/**
 * The page shown instead of the workspace (add-multiuser M12 "Gate pages"): a title, a text, and
 * for a missing or forbidden session "My latest session" (the start-up page `/`) and "New session".
 */
export function GatePage({ gate }: { gate: Gate }) {
  const [error, setError] = useState<string | undefined>();
  return (
    <div className="gate">
      <div className="gate-card" role="alert">
        <h1>{gate.title}</h1>
        {gate.text && <p>{gate.text}</p>}
        {gate.actions.length > 0 && (
          <div className="gate-actions">
            {gate.actions.includes(LATEST_SESSION) && (
              <button type="button" className="primary" onClick={() => location.assign("/")}>
                {LATEST_SESSION}
              </button>
            )}
            {gate.actions.includes(NEW_SESSION) && (
              <button
                type="button"
                onClick={() =>
                  void openNewSession().catch((e: unknown) =>
                    setError(e instanceof Error ? e.message : String(e)),
                  )
                }
              >
                {NEW_SESSION}
              </button>
            )}
          </div>
        )}
        {error && <p className="gate-error">{error}</p>}
      </div>
    </div>
  );
}
