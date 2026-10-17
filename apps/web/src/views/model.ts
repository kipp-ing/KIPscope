import { type OpenView, PREVIOUS_VIEW, type ViewSummary, viewName } from "@kipscope/shared";
import { ApiRequestError } from "../api.ts";

/** The title's `min-width` in `ch` (V7 give-way rule): its length in characters, at most 10. */
export const TITLE_MIN_CHARS = 10;

export function titleMinChars(title: string): number {
  return Math.min([...title].length, TITLE_MIN_CHARS);
}

/** The open view's own name; "Before last open" and views from a link have none to save to. */
function ownName(view: OpenView | undefined): string | undefined {
  return view?.name !== undefined && view.name !== PREVIOUS_VIEW ? view.name : undefined;
}

export type SaveEntry = "save" | "saveAs" | "saveNew";

/** Save entries of the menu (V7): "Save" and "Save as…" for a named open view, else "Save view…". */
export function saveEntries(view: OpenView | undefined): SaveEntry[] {
  return ownName(view) !== undefined ? ["save", "saveAs"] : ["saveNew"];
}

/**
 * Where a save with `title` goes (V7): the open named view itself, in place and without a prompt,
 * when the title is unchanged or names the same file; else the name from the title, without
 * overwrite, so a 409 always means another view.
 */
export function saveTarget(
  view: OpenView | undefined,
  title: string,
): { name?: string; overwrite: boolean } {
  const own = ownName(view);
  const name = viewName(title);
  if (own !== undefined && (title === view?.title || name === own)) {
    return { name: own, overwrite: true };
  }
  return { name, overwrite: false };
}

const pad = (n: string | undefined) => (n ?? "").padStart(2, "0");

/** `YYYY-MM-DD HH:MM:SS` of an ISO time in `timeZone` (undefined: the browser's). */
function localTime(iso: string, timeZone: string | undefined): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts: Record<string, string> = {};
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (const p of format.formatToParts(date)) parts[p.type] = p.value;
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

/** A menu row's meta line: saved local time, window count, data refs; a broken file's error. */
export function rowDetails(summary: ViewSummary, timeZone?: string): string {
  if (summary.error !== undefined) return summary.error;
  const saved = summary.saved !== undefined ? localTime(summary.saved, timeZone) : undefined;
  const windows = `${summary.windows} window${summary.windows === 1 ? "" : "s"}`;
  return [saved, windows, summary.data.join(", ")].filter(Boolean).join(" · ");
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** `existing.title` of a 409 `view_exists` (V6): an `ApiRequestError`, its `error` object or the body. */
export function existingTitle(error: unknown): string | undefined {
  let body: unknown = error;
  if (error instanceof ApiRequestError) {
    if (error.code !== "view_exists") return undefined;
    body = error.details;
  } else if (isRecord(error) && isRecord(error.error)) {
    body = error.error;
  }
  const existing = isRecord(body) ? body.existing : undefined;
  return isRecord(existing) && typeof existing.title === "string" ? existing.title : undefined;
}
