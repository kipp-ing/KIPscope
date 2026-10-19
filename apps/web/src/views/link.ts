import { decodeViewLink, MAX_LINK_CHARS, viewLinkUrl, type Workspace } from "@kipscope/shared";

type Address = Pick<Location, "pathname" | "search" | "hash">;

/**
 * The view the page address asks for (add-saved-views V7): `#view=<code>` decoded to its document,
 * else `?view=<name>`. Rejects a code that does not decode; the caller shows the error.
 */
export async function startupView(
  location: Address,
): Promise<{ view: unknown } | { name: string } | undefined> {
  const code = new URLSearchParams(location.hash.replace(/^#/, "")).get("view");
  if (code !== null) return { view: await decodeViewLink(code) };
  const name = new URLSearchParams(location.search).get("view");
  return name !== null ? { name } : undefined;
}

/** The address without query and fragment, so a reload does not open the view again. */
export function cleanAddress(location: Address): string {
  return location.pathname;
}

/**
 * Link to the open workspace as a self-contained view: the shared `viewLinkUrl`, the CLI's `view
 * link` too. It is built on the page's origin, not its `/s/<id>` path, so it opens a new session
 * wherever it is opened, for whoever may see its data (add-multiuser M12).
 */
export function viewLink(
  workspace: Workspace,
  page: Pick<Location, "origin"> & Partial<Pick<Location, "pathname">>,
): Promise<string> {
  return viewLinkUrl(workspace, `${page.origin}/`);
}

/** The notice after "Copy link". */
export function linkCopiedText(length: number): string {
  const text = `Link copied (${length} characters)`;
  return length > MAX_LINK_CHARS ? `${text} · long link: send the file instead` : text;
}

/** Copies the link of the open workspace; resolves to the notice text. */
export async function copyViewLink(workspace: Workspace): Promise<string> {
  const link = await viewLink(workspace, location);
  await writeClipboard(link);
  return linkCopiedText(link.length);
}

/** Copies `text`; also the Sessions menu's "Copy session link". */
export async function writeClipboard(text: string): Promise<void> {
  // The Clipboard API needs a secure context; a tunnel host over http has none.
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("the browser refused to copy the link");
}
