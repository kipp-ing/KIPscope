import type { Me, WorkspaceShare, WorkspaceSummary } from "@kipscope/shared";
import { HINTS } from "../help/hints.ts";

/** One share level of "Invite to this workspace". */
export interface ShareLevel {
  share: WorkspaceShare;
  label: string;
  disabled: boolean;
  /** The tooltip of a disabled level. */
  title?: string;
}

/** What Share… offers (add-multiuser M12): labels and lines say what the receiver gets. */
export interface ShareItems {
  /** "Copy link (own copy)": a link holding this layout as a view. */
  copy: { label: string; lines: string[] };
  /** "Invite to this workspace": the share level for the owner on a server, and its link. */
  invite: {
    label: string;
    /** Absent: no radio. */
    levels?: ShareLevel[];
    lines: string[];
    /** The label of the button that copies `<origin>/w/<id>`. */
    button: string;
  };
}

export const COPY_OWN_LINK = "Copy link (own copy)";
export const INVITE = "Invite to this workspace";

const LEVELS: readonly { share: WorkspaceShare; label: string }[] = [
  { share: "private", label: "Private" },
  { share: "read", label: "Read" },
  { share: "write", label: "Write" },
];

/**
 * The parts of Share… for `me` on the workspace of `summary` (design M12 "Share…"). Without
 * `summary` (before the live channel's first `summary`) it offers no level and names no owner.
 */
export function shareItems(
  me: Pick<Me, "identity"> & Partial<Pick<Me, "canShare">>,
  summary: Pick<WorkspaceSummary, "owner" | "share" | "rights"> | undefined,
): ShareItems {
  const server = me.identity !== "none";
  const copy = {
    label: COPY_OWN_LINK,
    lines: [
      "The receiver gets their own copy of this layout; changes stay apart.",
      ...(server
        ? ["On this server they see data only for vehicles KI.ping opened for them."]
        : []),
    ],
  };
  if (!server) {
    return {
      copy,
      invite: { label: INVITE, lines: [], button: "Copy workspace link (same live workspace)" },
    };
  }
  const button = "Copy workspace link";
  if (summary?.rights?.owner) {
    const canShare = me.canShare === true;
    return {
      copy,
      invite: {
        label: INVITE,
        levels: LEVELS.map((l) => {
          const disabled = l.share !== "private" && !canShare;
          return { ...l, disabled, ...(disabled ? { title: HINTS.sharingOff } : {}) };
        }),
        lines: ["Read: they watch this workspace live.", "Write: they change it with you."],
        button,
      },
    };
  }
  const lines =
    summary && summary.share !== "private" ? [`Shared by ${summary.owner} (${summary.share})`] : [];
  return { copy, invite: { label: INVITE, lines, button } };
}
