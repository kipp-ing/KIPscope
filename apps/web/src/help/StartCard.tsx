import type { HelpTab } from "./HelpPanel.tsx";
import "./help.css";

/**
 * "Start here" card (add-guidance H7, G-4 a): the four first steps at the top of the window list.
 * `empty` is the empty workspace's state, headed "No windows yet" and without ×. The texts are
 * pinned; keys are drawn as key caps without changing the text.
 */
export function StartCard({
  empty,
  onDismiss,
  onHelp,
}: {
  empty: boolean;
  onDismiss(): void;
  onHelp(t: HelpTab): void;
}) {
  return (
    <section className="start-card" aria-label={empty ? "No windows yet" : "Start here"}>
      <div className="start-card-head">
        <h2>{empty ? "No windows yet" : "Start here"}</h2>
        {!empty && (
          <button
            type="button"
            className="start-card-close"
            aria-label="Dismiss"
            onClick={onDismiss}
          >
            ×
          </button>
        )}
      </div>
      <ol>
        <li>
          <strong>Find a signal:</strong> type in the search on the left ( <kbd>/</kbd> ). Rest on a
          row for its details.
        </li>
        <li>
          <strong>Chart it:</strong> <kbd>+</kbd> or <kbd>Enter</kbd> adds to the window you last
          clicked (blue frame), else to a new one. Or drag the row onto a window.
        </li>
        <li>
          <strong>Measure:</strong> click a plot for cursor A, <kbd>Shift+click</kbd> for B, then
          Diff for B − A.
        </li>
        <li>
          <strong>Move in time:</strong> drag across a plot or the TIME strip to zoom; Back ({" "}
          <kbd>Backspace</kbd> ) undoes.
        </li>
      </ol>
      <div className="start-card-actions">
        <button type="button" onClick={() => onHelp("manual")}>
          Manual
        </button>
        <button type="button" onClick={() => onHelp("keys")}>
          Keys
        </button>
      </div>
    </section>
  );
}
