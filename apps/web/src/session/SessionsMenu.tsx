import { type Me, type SessionShare, type SessionSummary, sessionPath } from "@kipscope/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { deleteSession, listSessions, shareSession } from "../api.ts";
import { writeClipboard } from "../views/link.ts";
import { openNewSession } from "./Gate.tsx";
import { SESSION_HINTS } from "./hints.ts";
import { sessionTitle, sinceText } from "./title.ts";
import "./session.css";

export interface SessionsMenuProps {
  /** The page's session. */
  current: string;
  /** The page's session as the live channel reports it, with this user's rights. */
  session: SessionSummary | undefined;
  me: Me;
  /** Info notice in the strip. */
  onNotice: (text: string) => void;
  /** Error in the strip. */
  onMessage: (text: string) => void;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const SHARES: readonly { share: SessionShare; label: string }[] = [
  { share: "private", label: "Private" },
  { share: "read", label: "Read" },
  { share: "write", label: "Write" },
];

/** Stacked pages, alone once the top row is short (as the Views button's bookmark). */
const SessionsIcon = () => (
  <svg className="sessions-icon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path
      d="M4 1.5h8.5V10M1.5 4h8.5v8.5H1.5z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * "Sessions" in the top row (add-multiuser M12): the user's own sessions, latest first, as plain
 * links to `/s/<id>` (a middle or Ctrl click opens a new tab), the current one marked, one without
 * open right greyed; "New session", "Copy session link", the share level for the owner, and delete
 * with a confirm for every session but the current one.
 */
export function SessionsMenu({ current, session, me, onNotice, onMessage }: SessionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[] | undefined>();
  const [listError, setListError] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>();
  // The share level shown: the owner's own rights do not change with it, so the live channel may
  // send no `session` message after a share change; the answer of the change sets it too.
  const [share, setShareShown] = useState<SessionShare>(session?.share ?? "private");
  const liveShare = session?.share;
  useEffect(() => {
    if (liveShare !== undefined) setShareShown(liveShare);
  }, [liveShare]);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setConfirmDelete(undefined);
  }, []);

  const reload = useCallback(async () => {
    try {
      setSessions((await listSessions()).sessions);
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

  const newSession = async () => {
    close();
    try {
      await openNewSession();
    } catch (e) {
      onMessage(`New session: ${errorText(e)}`);
    }
  };

  const copyLink = async () => {
    close();
    try {
      await writeClipboard(`${location.origin}${sessionPath(current)}`);
      onNotice("Session link copied");
    } catch (e) {
      onMessage(`Copy session link: ${errorText(e)}`);
    }
  };

  const setShare = async (share: SessionShare) => {
    try {
      setShareShown((await shareSession(current, share)).session.share);
    } catch (e) {
      onMessage(errorText(e));
    }
  };

  const remove = async (id: string) => {
    setConfirmDelete(undefined);
    try {
      await deleteSession(id);
    } catch (e) {
      onMessage(errorText(e));
    }
    await reload();
  };

  const owner = session?.rights?.owner === true;

  return (
    <div className="sessions-menu" ref={root}>
      <button
        type="button"
        ref={button}
        className="sessions-button"
        title={SESSION_HINTS.sessions}
        aria-label="Sessions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <SessionsIcon />
        <span className="sessions-label">Sessions</span>
      </button>
      {open && (
        <div className="views-popover sessions-popover" role="menu">
          <div className="views-list">
            {listError && <p className="views-error">{listError}</p>}
            {sessions?.map((s) => {
              const title = sessionTitle(s);
              const details = [
                sinceText(s.lastActiveAt),
                `${s.windows} window${s.windows === 1 ? "" : "s"}`,
              ].join(" · ");
              const inner = (
                <>
                  <span className="views-row-title">
                    {s.id === current && <span className="views-current">✓</span>}
                    {title}
                  </span>
                  <span className="views-row-details">
                    {details}
                    {s.clients > 0 && (
                      <span className="sessions-clients" title={`${s.clients} open`}>
                        {" ●"}
                      </span>
                    )}
                  </span>
                </>
              );
              return (
                <div
                  key={s.id}
                  className={`views-row${s.rights ? "" : " broken"}${s.id === current ? " current" : ""}${confirmDelete === s.id ? " confirming" : ""}`}
                >
                  {s.rights ? (
                    <a
                      role="menuitem"
                      className="views-open"
                      href={sessionPath(s.id)}
                      aria-current={s.id === current ? "page" : undefined}
                      title={title}
                    >
                      {inner}
                    </a>
                  ) : (
                    <span className="views-open" title={SESSION_HINTS.noAccess}>
                      {inner}
                    </span>
                  )}
                  {s.id !== current && (
                    <span className="views-row-actions">
                      {confirmDelete === s.id ? (
                        <>
                          Delete?
                          <button type="button" onClick={() => void remove(s.id)}>
                            Yes
                          </button>
                          <button type="button" onClick={() => setConfirmDelete(undefined)}>
                            No
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Delete session ${title}`}
                          title={SESSION_HINTS.delete}
                          onClick={() => setConfirmDelete(s.id)}
                        >
                          ×
                        </button>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="views-divider" />
          <button
            type="button"
            role="menuitem"
            className="views-item"
            onClick={() => void newSession()}
          >
            New session
          </button>
          <button
            type="button"
            role="menuitem"
            className="views-item"
            title={SESSION_HINTS.copySessionLink}
            onClick={() => void copyLink()}
          >
            Copy session link
          </button>
          {owner && (
            <fieldset className="sessions-share">
              <legend>Share</legend>
              {SHARES.map((s) => {
                const allowed = s.share === "private" || me.rights.share;
                return (
                  <label
                    key={s.share}
                    className={allowed ? undefined : "disabled"}
                    title={allowed ? undefined : SESSION_HINTS.noShareRight}
                  >
                    <input
                      type="radio"
                      name="session-share"
                      value={s.share}
                      checked={share === s.share}
                      disabled={!allowed}
                      onChange={() => void setShare(s.share)}
                    />
                    {s.label}
                  </label>
                );
              })}
            </fieldset>
          )}
        </div>
      )}
    </div>
  );
}
