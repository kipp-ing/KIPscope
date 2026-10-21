import { isSignedCases, workspacePath } from "@kipscope/shared";
import { openCases } from "./api.ts";
import { stashCaseReport } from "./workspaces/caseReport.ts";

/**
 * Ignores files dragged onto the page (design H8): without this a dropped file navigates the tab
 * away. Signal drags are pointer-based, not HTML drag and drop, so they pass. With `onFiles` a
 * file drop is accepted and its files handed over (a catalog, add-case-open K14). Returns the
 * remover.
 */
export function ignoreFileDrops(
  target: EventTarget,
  onFiles?: (files: readonly File[]) => void,
): () => void {
  const onDrag = (event: Event) => {
    const transfer = (event as DragEvent).dataTransfer;
    if (!transfer || !Array.from(transfer.types).includes("Files")) return;
    event.preventDefault();
    if (event.type === "dragover") transfer.dropEffect = onFiles ? "copy" : "none";
    else if (onFiles && transfer.files) onFiles(Array.from(transfer.files));
  };
  target.addEventListener("dragover", onDrag);
  target.addEventListener("drop", onDrag);
  return () => {
    target.removeEventListener("dragover", onDrag);
    target.removeEventListener("drop", onDrag);
  };
}

/**
 * What a dropped file's text opens as a catalog (K14): a catalog document (`kipscope: "cases"`)
 * as an object, a JWS (three dot-separated parts) as its text; undefined for anything else.
 */
export function catalogOfText(text: string): string | Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const doc: unknown = JSON.parse(trimmed);
      if (
        typeof doc === "object" &&
        doc !== null &&
        (doc as { kipscope?: unknown }).kipscope === "cases"
      )
        return doc as Record<string, unknown>;
    } catch {
      return undefined;
    }
    return undefined;
  }
  return trimmed !== "" && !/\s/.test(trimmed) && isSignedCases(trimmed) ? trimmed : undefined;
}

/**
 * Opens a dropped file holding a catalog (K14): posts it as `{open: {cases}}`, then goes to the
 * new workspace (`go`, a page load). The answer's open report is stashed in `store` (default
 * sessionStorage) first, so the workspace shows it after the load (fix-handoff-findings X4).
 * Resolves false when the file holds no catalog; rejects with the server's refusal.
 */
export async function openDroppedCatalog(
  file: Pick<File, "text">,
  deps: {
    open?: typeof openCases;
    go?: (path: string) => void;
    store?: Parameters<typeof stashCaseReport>[2];
  } = {},
): Promise<boolean> {
  const cases = catalogOfText(await file.text());
  if (cases === undefined) return false;
  const answer = await (deps.open ?? openCases)(cases);
  if (answer.case) stashCaseReport(answer.workspace.id, answer.case, deps.store);
  (deps.go ?? ((path) => location.assign(path)))(workspacePath(answer.workspace.id));
  return true;
}
