import type { CaseOpenReport } from "@kipscope/shared";

/**
 * The open report of a dropped catalog, carried across the page load to its workspace
 * (fix-handoff-findings X4). `sessionStorage` is per tab and survives `location.assign` in that
 * tab; every access goes through try/catch, so a missing or blocked storage only loses the report.
 */

export const CASE_REPORT_KEY = "kipscope.caseOpenReport";

type ReportStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function tabStore(): ReportStore | undefined {
  try {
    return globalThis.sessionStorage ?? undefined;
  } catch {
    return undefined;
  }
}

/** Stores {workspace, report} for the next page load of this tab; never throws. Default store: sessionStorage. */
export function stashCaseReport(
  workspaceId: string,
  report: CaseOpenReport,
  store: ReportStore | undefined = tabStore(),
): void {
  try {
    store?.setItem(CASE_REPORT_KEY, JSON.stringify({ workspace: workspaceId, report }));
  } catch {
    // Blocked or full: the report is not shown after the page load.
  }
}

/** The stored report when it belongs to `workspaceId`; removes the entry in every case; never throws. */
export function takeCaseReport(
  workspaceId: string,
  store: ReportStore | undefined = tabStore(),
): CaseOpenReport | undefined {
  let text: string | null = null;
  try {
    text = store?.getItem(CASE_REPORT_KEY) ?? null;
  } catch {
    // Blocked: nothing to take.
  }
  try {
    store?.removeItem(CASE_REPORT_KEY);
  } catch {
    // Blocked: the entry stays, and the next take for another workspace ignores it.
  }
  if (text === null) return undefined;
  try {
    const entry: unknown = JSON.parse(text);
    if (typeof entry !== "object" || entry === null) return undefined;
    const { workspace, report } = entry as { workspace?: unknown; report?: unknown };
    if (workspace !== workspaceId || !isReport(report)) return undefined;
    return report;
  } catch {
    return undefined;
  }
}

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string");

/** The shape the start-up and `caseOpenEvents` read; anything else is dropped. */
function isReport(v: unknown): v is CaseOpenReport {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Partial<Record<keyof CaseOpenReport, unknown>>;
  return (
    typeof r.count === "number" &&
    typeof r.current === "number" &&
    isStrings(r.dataRefs) &&
    isStrings(r.missing) &&
    isStrings(r.warnings) &&
    (r.alignFallback === undefined || r.alignFallback === true)
  );
}
