import type { LiveServerMessage, OpenReport, OpenView, Workspace } from "@kipscope/shared";

const NOTICE_NAMES = 3;

/** Signal name without its data ref. */
function shortName(id: string): string {
  return id.slice(id.indexOf("/") + 1);
}

/**
 * The open notice (V7): `Opened "<title>"`, then how many signals were not found (first three names)
 * and left out; the tooltip lists every ID and warning.
 */
export function openNotice(
  title: string,
  report: OpenReport | undefined,
  extraWarnings: readonly string[] = [],
): { text: string; title: string } {
  const missing = report?.missing ?? [];
  const skipped = report?.skipped ?? [];
  const warnings = [...extraWarnings, ...(report?.warnings ?? [])];
  let text = `Opened "${title}"`;
  if (missing.length > 0) {
    const names = missing.slice(0, NOTICE_NAMES).map(shortName).join(", ");
    const more = missing.length > NOTICE_NAMES ? ", …" : "";
    text += ` · ${missing.length} signal${missing.length === 1 ? "" : "s"} not found: ${names}${more}`;
  }
  if (skipped.length > 0) text += ` · ${skipped.length} left out (limits)`;
  const lines = [
    text,
    ...missing.map((id) => `not found: ${id}`),
    ...skipped.map((s) => `left out: ${s.signalId} (${s.reason.replaceAll("_", " ")})`),
    ...warnings,
  ];
  return { text, title: lines.join("\n") };
}

/** Browser tab title (V7): `<title> · KIPscope` with an open view, else `KIPscope`. */
export function documentTitle(ws: Workspace | undefined): string {
  return ws?.view ? `${ws.view.title} · KIPscope` : "KIPscope";
}

/**
 * The open view's title in the top row (V7): its text, whether the modified dot shows, and the
 * tooltip (the title, the note on a second line). No view → undefined, nothing is shown.
 */
export function titleParts(
  view: OpenView | undefined,
): { text: string; dot: boolean; tooltip: string } | undefined {
  if (!view) return undefined;
  return {
    text: view.title,
    dot: view.modified,
    tooltip: view.note ? `${view.title}\n${view.note}` : view.title,
  };
}

/** The strip's message slot (V7): one item, an error or an info notice. */
export interface StripItem {
  tone: "error" | "info";
  text: string;
  /** Tooltip; defaults to the text. */
  title?: string;
}

/**
 * What reaches the slot: an error, a notice, an open (shown as its open notice) or a dismiss. A
 * dismiss with `tone` or `text` clears only an item that matches them (e.g. a command's or Go to's
 * own error), else the slot.
 */
export type StripEvent =
  | { kind: "error"; text: string }
  | { kind: "notice"; text: string; title?: string }
  | {
      kind: "opened";
      title: string;
      report?: OpenReport | undefined;
      warnings?: readonly string[];
    }
  | { kind: "dismiss"; tone?: StripItem["tone"]; text?: string };

/** The slot after one event (V7 round 2): any new error or notice replaces the item. */
export function nextStrip(slot: StripItem | undefined, event: StripEvent): StripItem | undefined {
  switch (event.kind) {
    case "error":
      return { tone: "error", text: event.text };
    case "notice":
      return {
        tone: "info",
        text: event.text,
        ...(event.title !== undefined ? { title: event.title } : {}),
      };
    case "opened":
      return { tone: "info", ...openNotice(event.title, event.report, event.warnings) };
    case "dismiss": {
      if (!slot) return undefined;
      if (event.tone !== undefined && slot.tone !== event.tone) return slot;
      if (event.text !== undefined && slot.text !== event.text) return slot;
      return undefined;
    }
  }
}

/**
 * The notice for a state push that is a `view.open` this tab did not send (V7 round 2): its
 * revision is not one of the tab's own open results. Else undefined. The push carries no report.
 */
export function openedElsewhere(
  push: LiveServerMessage,
  own: ReadonlySet<number>,
): string | undefined {
  if (push.type !== "state" || push.command !== "view.open" || own.has(push.revision)) return;
  return `"${push.workspace.view?.title ?? "view"}" opened elsewhere`;
}
