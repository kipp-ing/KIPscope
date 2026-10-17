import {
  type CommandResult,
  type OpenView,
  PREVIOUS_VIEW,
  PREVIOUS_VIEW_TITLE,
  type ViewSummary,
  type Workspace,
} from "@kipscope/shared";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import {
  ApiRequestError,
  deleteView,
  importView,
  listViews,
  openView,
  saveView,
  viewFileUrl,
} from "../api.ts";
import { HINTS } from "../help/hints.ts";
import { copyViewLink } from "./link.ts";
import { existingTitle, rowDetails, saveEntries, saveTarget, titleMinChars } from "./model.ts";
import { SaveForm, type SaveOutcome } from "./SaveForm.tsx";
import "./views.css";

/**
 * App's tracked open: the request counts as this tab's open while in flight and its result's
 * revision as own, so its push is not "opened elsewhere" (V7 round 3).
 */
export type TrackOpen = <T>(
  request: () => Promise<T>,
  revisionOf: (result: T) => number | undefined,
) => Promise<T>;

export interface ViewsMenuProps {
  workspace: Workspace;
  /** Every open this menu sends goes through it. */
  trackOpen: TrackOpen;
  /** App: the open notice after the push, or the error of a refused open. */
  onOpened: (result: CommandResult, warnings?: readonly string[]) => void;
  /** Info notice in the strip. */
  onNotice: (text: string, title?: string) => void;
  /** Error in the strip. */
  onMessage: (text: string) => void;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The title a 409 `view_exists` names; the given title when the answer names none. */
function conflictTitle(e: unknown, fallback: string): string | undefined {
  const title = existingTitle(e);
  if (title !== undefined) return title;
  return e instanceof ApiRequestError && e.code === "view_exists" ? fallback : undefined;
}

const SAVE_KEY =
  typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform)
    ? "Cmd+S"
    : "Ctrl+S";
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Bookmark glyph of the Views button, alone once the top row is short (V7 give-way step 3). */
const BookmarkIcon = () => (
  <svg className="views-icon" width="12" height="14" viewBox="0 0 12 14" aria-hidden="true">
    <path
      d="M2 1.5h8v11L6 9.6 2 12.5z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * "Views" in the top row (add-saved-views V7): the save entries ("Save" and "Save as…" for a named
 * open view, else "Save view…"; Ctrl/Cmd+S runs the first), the saved views, "Before last open"
 * last, "Import file…" and "Copy link". A row click opens the view; hovering shows Download and
 * Delete (inline confirm) over the row's title line. Esc or a pointer down outside closes it.
 */
export function ViewsMenu({ workspace, trackOpen, onOpened, onNotice, onMessage }: ViewsMenuProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [views, setViews] = useState<ViewSummary[] | undefined>();
  const [listError, setListError] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>();
  // An import onto an existing name waits for "Replace".
  const [importing, setImporting] = useState<{ text: string; title: string } | undefined>();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setSaving(false);
    setConfirmDelete(undefined);
    setImporting(undefined);
  }, []);

  const reload = useCallback(async () => {
    try {
      setViews(await listViews());
      setListError(undefined);
    } catch (e) {
      setListError(errorText(e));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void reload();
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close();
      button.current?.focus();
    };
    // Capture phase: the plot's own pointer handling must not hide the click from us.
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, reload, close]);

  const save = useCallback(
    async (
      title: string,
      note: string,
      overwrite: boolean,
      name?: string,
    ): Promise<SaveOutcome> => {
      try {
        await saveView({
          title,
          ...(note.trim() !== "" ? { note } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(overwrite ? { overwrite: true } : {}),
        });
      } catch (e) {
        const exists = conflictTitle(e, title);
        return exists !== undefined ? { exists } : { error: errorText(e) };
      }
      onNotice(`Saved "${title}"`);
      close();
      return { saved: true };
    },
    [onNotice, close],
  );

  // "Save": the open named view in place, at once, no form and no prompt (V7).
  const saveInPlace = useCallback(
    async (view: OpenView) => {
      const target = saveTarget(view, view.title);
      const outcome = await save(view.title, view.note ?? "", target.overwrite, target.name);
      if ("error" in outcome) onMessage(outcome.error);
    },
    [save, onMessage],
  );

  // Ctrl/Cmd+S (V7, no key in keys.ts) runs the first save entry: "Save" in place, or the form of
  // "Save view…"; preventDefault keeps the browser's own save dialog shut.
  const latest = useRef({ view: workspace.view, saveInPlace });
  latest.current = { view: workspace.view, saveInPlace };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "s")
        return;
      e.preventDefault();
      const { view, saveInPlace: saveNow } = latest.current;
      if (view && saveEntries(view)[0] === "save") {
        void saveNow(view);
        return;
      }
      setOpen(true);
      setSaving(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const openNamed = async (name: string) => {
    close();
    try {
      onOpened(
        await trackOpen(
          () => openView({ name }),
          (r) => (r.ok ? r.revision : undefined),
        ),
      );
    } catch (e) {
      onMessage(errorText(e));
    }
  };

  const remove = async (name: string) => {
    setConfirmDelete(undefined);
    try {
      await deleteView(name);
    } catch (e) {
      onMessage(errorText(e));
    }
    await reload();
  };

  const runImport = async (text: string, overwrite: boolean) => {
    try {
      const result = await trackOpen(
        () => importView({ text, open: true, ...(overwrite ? { overwrite } : {}) }),
        (r) => (r.opened?.ok ? r.opened.revision : undefined),
      );
      close();
      if (result.opened) onOpened(result.opened, result.warnings);
      else onNotice(`Imported "${result.view.title}"`, result.warnings.join("\n") || undefined);
    } catch (e) {
      const exists = conflictTitle(e, "The view");
      if (exists !== undefined) setImporting({ text, title: exists });
      else {
        close();
        onMessage(errorText(e));
      }
    }
  };

  const copyLink = async () => {
    close();
    try {
      onNotice(await copyViewLink(workspace));
    } catch (e) {
      onMessage(`Copy link: ${errorText(e)}`);
    }
  };

  const view = workspace.view;
  const entryLabel = { save: "Save", saveAs: "Save as…", saveNew: "Save view…" } as const;

  // The title is a sibling of the menu, so it is a flex item of the option bar and shrinks there.
  return (
    <>
      <div className="views-menu" ref={root}>
        <button
          type="button"
          ref={button}
          className="views-button"
          title={HINTS.views}
          aria-label="Views"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <BookmarkIcon />
          <span className="views-label">Views</span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".yaml,.yml,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void file.text().then((text) => runImport(text, false), close);
          }}
        />
        {open && (
          <div className="views-popover" role="menu">
            {saving ? (
              <SaveForm
                view={view}
                title={view?.title ?? workspace.measurement?.name ?? ""}
                note={view?.note ?? ""}
                onSave={(title, note, target) => save(title, note, target.overwrite, target.name)}
                onCancel={() => setSaving(false)}
              />
            ) : importing ? (
              <div className="views-confirm">
                <span>"{importing.title}" exists. Replace?</span>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void runImport(importing.text, true)}
                >
                  Replace
                </button>
                <button type="button" onClick={() => setImporting(undefined)}>
                  Cancel
                </button>
              </div>
            ) : (
              <>
                {saveEntries(view).map((entry, i) => (
                  <button
                    key={entry}
                    type="button"
                    role="menuitem"
                    className="views-item"
                    onClick={() => {
                      if (entry === "save" && view) {
                        close();
                        void saveInPlace(view);
                      } else setSaving(true);
                    }}
                  >
                    {entryLabel[entry]}
                    {i === 0 && <span className="views-key">{SAVE_KEY}</span>}
                  </button>
                ))}
                <div className="views-list">
                  {listError && <p className="views-error">{listError}</p>}
                  {views?.length === 0 && <p className="views-empty">No saved views</p>}
                  {views?.map((v) => (
                    <div
                      key={v.name}
                      className={`views-row${v.error ? " broken" : ""}${v.name === PREVIOUS_VIEW ? " previous" : ""}${confirmDelete === v.name ? " confirming" : ""}`}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="views-open"
                        disabled={v.error !== undefined}
                        title={v.error ?? v.note}
                        onClick={() => void openNamed(v.name)}
                      >
                        <span className="views-row-title">
                          {v.name === view?.name && <span className="views-current">✓</span>}
                          {v.name === PREVIOUS_VIEW ? PREVIOUS_VIEW_TITLE : v.title}
                        </span>
                        <span className="views-row-details">{rowDetails(v, TIME_ZONE)}</span>
                      </button>
                      <span className="views-row-actions">
                        {confirmDelete === v.name ? (
                          <>
                            Delete?
                            <button type="button" onClick={() => void remove(v.name)}>
                              Yes
                            </button>
                            <button type="button" onClick={() => setConfirmDelete(undefined)}>
                              No
                            </button>
                          </>
                        ) : (
                          <>
                            <a
                              href={viewFileUrl(v.name, true)}
                              download={`${v.name}.kipscope.yaml`}
                            >
                              Download
                            </a>
                            <button type="button" onClick={() => setConfirmDelete(v.name)}>
                              Delete
                            </button>
                          </>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="views-divider" />
                <button
                  type="button"
                  role="menuitem"
                  className="views-item"
                  onClick={() => fileInput.current?.click()}
                >
                  Import file…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="views-item"
                  title={HINTS.copyLink}
                  onClick={() => void copyLink()}
                >
                  Copy link
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {view && (
        <span
          className="view-title"
          title={view.note ? `${view.title}\n${view.note}` : view.title}
          style={{ "--title-min": `${titleMinChars(view.title)}ch` } as CSSProperties}
        >
          <span className="view-title-text">{view.title}</span>
          {view.modified && (
            <span className="view-modified" title={HINTS.viewModified}>
              •
            </span>
          )}
        </span>
      )}
    </>
  );
}
