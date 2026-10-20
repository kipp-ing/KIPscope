import {
  type Me,
  type Workspace,
  type WorkspaceShare,
  type WorkspaceSummary,
  workspacePath,
} from "@kipscope/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { shareWorkspace } from "../api.ts";
import { HINTS } from "../help/hints.ts";
import { copyViewLink, writeClipboard } from "../views/link.ts";
import { shareItems } from "./share.ts";
import "./workspaces.css";

export interface ShareMenuProps {
  workspace: Workspace;
  /** The page's workspace. */
  workspaceId: string;
  /** The page's workspace from the live channel, with this user's rights and its owner. */
  summary: WorkspaceSummary | undefined;
  me: Me | undefined;
  /** Info notice in the strip. */
  onNotice: (text: string) => void;
  /** Error in the strip. */
  onMessage: (text: string) => void;
  /** In the "⋯" menu: closes it after a copy. Absent in the row, where it is an overflow item. */
  after?: () => void;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * "Share…" (add-multiuser M12): an overflow item of the top row, in the row or in "⋯". Its popover
 * offers "Copy link (own copy)", a link holding this layout as a view, and "Invite to this
 * workspace": the share level for the owner on a server, and the link of this live workspace.
 * Esc closes the popover only (an open "⋯" menu stays), with focus back on "Share…".
 */
export function ShareMenu({
  workspace,
  workspaceId,
  summary,
  me,
  onNotice,
  onMessage,
  after,
}: ShareMenuProps) {
  const [open, setOpen] = useState(false);
  // The share level shown: the owner's own rights do not change with it, so the live channel may
  // send no `summary` after a share change; the answer of the change sets it too.
  const [share, setShareShown] = useState<WorkspaceShare>(summary?.share ?? "private");
  const liveShare = summary?.share;
  useEffect(() => {
    if (liveShare !== undefined) setShareShown(liveShare);
  }, [liveShare]);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("button, input")?.focus();
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    // Capture phase, stopped there: the first Esc closes this popover, not the "⋯" menu around it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    // Capture phase: the plot's own pointer handling must not hide the click from us.
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  const done = () => {
    close();
    after?.();
  };

  const copyOwn = async () => {
    done();
    try {
      onNotice(await copyViewLink(workspace));
    } catch (e) {
      onMessage(`Copy link: ${errorText(e)}`);
    }
  };

  const copyWorkspaceLink = async () => {
    done();
    try {
      await writeClipboard(`${location.origin}${workspacePath(workspaceId)}`);
      onNotice("Workspace link copied");
    } catch (e) {
      onMessage(`Copy workspace link: ${errorText(e)}`);
    }
  };

  const setShare = async (level: WorkspaceShare) => {
    try {
      setShareShown((await shareWorkspace(workspaceId, level)).workspace.share);
    } catch (e) {
      onMessage(errorText(e));
    }
  };

  const items = me ? shareItems(me, summary) : undefined;

  return (
    <div className={`share-menu${after ? "" : " overflow-item"}`} ref={root}>
      <button
        type="button"
        ref={button}
        className="share-button"
        title={HINTS.share}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!items}
        onClick={() => (open ? close() : setOpen(true))}
      >
        Share…
      </button>
      {open && items && (
        <div ref={panel} className="views-popover share-popover" role="dialog" aria-label="Share">
          <button
            type="button"
            className="views-item"
            title={HINTS.copyOwnLink}
            onClick={() => void copyOwn()}
          >
            {items.copy.label}
          </button>
          {items.copy.lines.map((line) => (
            <p key={line} className="share-line">
              {line}
            </p>
          ))}
          <div className="views-divider" />
          <p className="share-heading">{items.invite.label}</p>
          {items.invite.levels && (
            <fieldset className="share-levels">
              <legend className="share-hidden">Share level</legend>
              {items.invite.levels.map((l) => (
                <label
                  key={l.share}
                  className={l.disabled ? "disabled" : undefined}
                  title={l.title}
                >
                  <input
                    type="radio"
                    name="workspace-share"
                    value={l.share}
                    checked={share === l.share}
                    disabled={l.disabled}
                    onChange={() => void setShare(l.share)}
                  />
                  {l.label}
                </label>
              ))}
            </fieldset>
          )}
          {items.invite.lines.map((line) => (
            <p key={line} className="share-line">
              {line}
            </p>
          ))}
          <button
            type="button"
            className="views-item"
            title={HINTS.copyWorkspaceLink}
            onClick={() => void copyWorkspaceLink()}
          >
            {items.invite.button}
          </button>
        </div>
      )}
    </div>
  );
}
