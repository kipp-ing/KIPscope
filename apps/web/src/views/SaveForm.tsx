import { MAX_VIEW_NOTE, MAX_VIEW_TITLE, type OpenView } from "@kipscope/shared";
import { useEffect, useRef, useState } from "react";
import { saveTarget } from "./model.ts";

export interface SaveFormProps {
  /** The open view; its own name is the target while the title names it (`saveTarget`). */
  view: OpenView | undefined;
  /** Prefill: the open view's title, else the measurement name, else empty. */
  title: string;
  note: string;
  /** Saves to `target`; after "Replace" with `overwrite: true`. */
  onSave: (
    title: string,
    note: string,
    target: { name?: string; overwrite: boolean },
  ) => Promise<SaveOutcome>;
  onCancel: () => void;
}

/** What a save attempt gave: saved, a 409 to confirm, or an error to show. */
export type SaveOutcome = { saved: true } | { exists: string } | { error: string };

/**
 * "Save view…" and "Save as…" (add-saved-views V7): title (required) and note. The open named view
 * saves in place while the title names it; a 409 therefore means another view and asks
 * `"<title>" exists. Replace?` with Replace and Cancel.
 */
export function SaveForm({ view, title, note, onSave, onCancel }: SaveFormProps) {
  const [titleText, setTitleText] = useState(title);
  const [noteText, setNoteText] = useState(note);
  const [exists, setExists] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.select(), []);

  const save = async (overwrite: boolean) => {
    if (busy || titleText.trim() === "") return;
    setBusy(true);
    const target = saveTarget(view, titleText.trim());
    const outcome = await onSave(titleText.trim(), noteText, {
      ...target,
      overwrite: overwrite || target.overwrite,
    });
    setBusy(false);
    if ("exists" in outcome) {
      setExists(outcome.exists);
      setError(undefined);
    } else if ("error" in outcome) {
      setExists(undefined);
      setError(outcome.error);
    }
  };

  return (
    <form
      className="views-save"
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      <label>
        Title
        <input
          ref={titleRef}
          type="text"
          required
          maxLength={MAX_VIEW_TITLE}
          value={titleText}
          onChange={(e) => {
            setTitleText(e.target.value);
            setExists(undefined);
          }}
        />
      </label>
      <label>
        Note
        <textarea
          rows={3}
          maxLength={MAX_VIEW_NOTE}
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
        />
      </label>
      {error && <p className="views-error">{error}</p>}
      {exists !== undefined ? (
        <div className="views-confirm">
          <span>"{exists}" exists. Replace?</span>
          <button type="button" className="primary" disabled={busy} onClick={() => save(true)}>
            Replace
          </button>
          <button type="button" onClick={() => setExists(undefined)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="views-actions">
          <button type="submit" className="primary" disabled={busy || titleText.trim() === ""}>
            Save
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </form>
  );
}
