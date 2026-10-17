import {
  type CommandResult,
  formatLocal,
  fromIso,
  PREVIOUS_VIEW,
  PREVIOUS_VIEW_TITLE,
  type ViewSummary,
  type Workspace,
} from "@kipscope/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiRequestError,
  deleteView,
  importView,
  listViews,
  openView,
  saveView,
  viewFileUrl,
} from "../api.ts";
import { copyViewLink } from "./link.ts";
import { SaveForm, type SaveOutcome } from "./SaveForm.tsx";
import "./views.css";

export interface ViewsMenuProps {
  workspace: Workspace;
  /** App: the open notice after the push, or the error of a refused open. */
  onOpened: (result: CommandResult, warnings?: readonly string[]) => void;
  /** Info notice in the strip. */
  onNotice: (text: string, title?: string) => void;
  /** Error in the strip. */
  onMessage: (text: string) => void;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Title of the existing view in a 409 `view_exists` (V6), else undefined. */
function existingTitle(e: unknown, fallback: string): string | undefined {
  if (!(e instanceof ApiRequestError) || e.code !== "view_exists") return undefined;
  const existing = e.details?.existing as { title?: unknown } | undefined;
  return typeof existing?.title === "string" ? existing.title : fallback;
}

/** Second line of a row: saved local time, window count, data refs. */
function rowDetails(v: ViewSummary): string {
  let saved: string | undefined;
  try {
    saved = v.saved ? formatLocal(fromIso(v.saved)) : undefined;
  } catch {
    saved = v.saved;
  }
  const windows = `${v.windows} window${v.windows === 1 ? "" : "s"}`;
  return [saved, windows, v.data.join(", ")].filter(Boolean).join(" · ");
}

/** The view name Ctrl+S saves to directly; "Before last open" and link views have none. */
function savedName(workspace: Workspace): string | undefined {
  const name = workspace.view?.name;
  return name !== undefined && name !== PREVIOUS_VIEW ? name : undefined;
}

/**
 * "Views" in the top row (add-saved-views V7): "Save view…" (Ctrl/Cmd+S), the saved views, "Before
 * last open" last, "Import file…" and "Copy link". A row click opens the view; hovering shows
 * Download and Delete (inline confirm). Esc or a pointer down outside closes it.
 */
export function ViewsMenu({ workspace, onOpened, onNotice, onMessage }: ViewsMenuProps) {
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
        const exists = existingTitle(e, title);
        return exists !== undefined ? { exists } : { error: errorText(e) };
      }
      onNotice(`Saved "${title}"`);
      close();
      return { saved: true };
    },
    [onNotice, close],
  );

  // Ctrl/Cmd+S (V7, no key in keys.ts): a named open view is saved at once, else the form opens;
  // preventDefault keeps the browser's own save dialog shut.
  const latest = useRef({ workspace, save, onMessage });
  latest.current = { workspace, save, onMessage };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "s")
        return;
      e.preventDefault();
      const { workspace: ws, save: saveNow, onMessage: fail } = latest.current;
      const name = savedName(ws);
      if (name !== undefined && ws.view) {
        void saveNow(ws.view.title, ws.view.note ?? "", true, name).then((outcome) => {
          if ("error" in outcome) fail(outcome.error);
        });
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
      onOpened(await openView({ name }));
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
      const result = await importView({ text, open: true, ...(overwrite ? { overwrite } : {}) });
      close();
      if (result.opened) onOpened(result.opened, result.warnings);
      else onNotice(`Imported "${result.view.title}"`, result.warnings.join("\n") || undefined);
    } catch (e) {
      const exists = existingTitle(e, "The view");
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
  const formName = savedName(workspace);

  // The title is a sibling of the menu, so it is a flex item of the option bar and shrinks there.
  return (
    <>
      <div className="views-menu" ref={root}>
        <button
          type="button"
          ref={button}
          className="views-button"
          title="Save, open and share views · Ctrl+S saves"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => (open ? close() : setOpen(true))}
        >
          Views
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
                title={view?.title ?? workspace.measurement?.name ?? ""}
                note={view?.note ?? ""}
                onSave={(title, note, overwrite) =>
                  // The open view's own name while its title is kept, else the name from the title.
                  save(title, note, overwrite, title === view?.title ? formName : undefined)
                }
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
                <button
                  type="button"
                  role="menuitem"
                  className="views-item"
                  onClick={() => setSaving(true)}
                >
                  Save view…<span className="views-key">Ctrl+S</span>
                </button>
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
                        <span className="views-row-details">{v.error ?? rowDetails(v)}</span>
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
                  title="Link holding this view; works where a KIPscope server with the same data runs"
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
        <span className="view-title" title={view.note ? `${view.title}\n${view.note}` : view.title}>
          <span className="view-title-text">{view.title}</span>
          {view.modified && (
            <span className="view-modified" title="Changed since saved or opened">
              •
            </span>
          )}
        </span>
      )}
    </>
  );
}
