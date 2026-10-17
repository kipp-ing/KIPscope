import type { OpenReport } from "@kipscope/shared";

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
