import type { WorkspaceSummary } from "@kipscope/shared";

const pad = (n: string | undefined) => (n ?? "").padStart(2, "0");

/** Milliseconds of a time as the workspace holds it: decimal ns, or ISO-8601. */
function epochMs(time: string): number {
  return /^-?\d+$/.test(time) ? Number(BigInt(time) / 1_000_000n) : new Date(time).getTime();
}

/** `YYYY-MM-DD HH:MM` of a time in `timeZone` (default: the browser's); the input when it is no time. */
function localMinute(time: string, timeZone?: string): string {
  const date = new Date(epochMs(time));
  if (Number.isNaN(date.getTime())) return time;
  const parts: Record<string, string> = {};
  const format = new Intl.DateTimeFormat("en-CA", {
    ...(timeZone ? { timeZone } : {}),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (const p of format.formatToParts(date)) parts[p.type] = p.value;
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * A workspace's title in the Recent list (add-multiuser M12): the open view's title, else the
 * measurement name, else `<dataRef> <scope start, local>`, else `New workspace`.
 */
export function workspaceTitle(
  summary: Pick<WorkspaceSummary, "view" | "measurement" | "scope">,
  timeZone?: string,
): string {
  if (summary.view?.title) return summary.view.title;
  if (summary.measurement) return summary.measurement;
  if (summary.scope) return `${summary.scope.dataRef} ${localMinute(summary.scope.from, timeZone)}`;
  return "New workspace";
}

/** "just now", "5 min ago", "3 h ago", "2 days ago" from an ISO instant. */
export function sinceText(iso: string, now: number = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  if (Number.isNaN(ms)) return iso;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.floor(h / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
