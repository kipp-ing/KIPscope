import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type CommandResult,
  encodeViewLink,
  type ImportViewRequest,
  MAX_VIEW_BYTES,
  type SaveViewRequest,
  type ViewSummary,
  type Workspace,
  workspaceToView,
} from "@kipscope/shared";
import type { Client } from "./client.ts";
import { CliError } from "./output.ts";
import type { Body } from "./run.ts";

type Opened = Extract<CommandResult, { ok: true }>;

/** The `view …` forms (design V8); `request` holds the body as sent. */
export type ViewInvocation =
  | { kind: "view"; action: "list" }
  | { kind: "view"; action: "save"; request: SaveViewRequest }
  | { kind: "view"; action: "open"; request: { name: string } }
  | { kind: "view"; action: "delete"; name: string }
  | { kind: "view"; action: "export"; name: string; out?: string }
  /** FILE is read when the call runs; its text completes the request. */
  | { kind: "view"; action: "import"; file: string; request: Omit<ImportViewRequest, "text"> }
  /** page: --page, else the --server address; query and fragment are dropped when the link is built. */
  | { kind: "view"; action: "link"; page: string };

/**
 * Executes one view form and fills `body`; failures throw CliError. Returns the revision to wait
 * for when the call opened a view (`open`, `import --open`), else undefined. `export` without
 * --out leaves the YAML text itself in `body.data` (run prints it instead of the JSON line).
 */
export async function runView(
  invocation: ViewInvocation,
  client: Client,
  body: Body,
): Promise<number | undefined> {
  switch (invocation.action) {
    case "list":
      body.data = await client.get<{ views: ViewSummary[] }>("/api/views");
      return undefined;
    case "save": {
      const answer = await client.post<{ view: ViewSummary; revision: number }>(
        "/api/views",
        invocation.request,
      );
      body.revision = answer.revision;
      body.data = { view: answer.view };
      return undefined;
    }
    case "open": {
      const answer = await opened(
        client.postCommandAt("/api/views/open", invocation.request),
        body,
      );
      body.data = { report: answer.report };
      return answer.revision;
    }
    case "delete":
      body.data = await client.delete<{ deleted: string }>(viewPath(invocation.name));
      return undefined;
    case "export": {
      const text = await client.getText(viewPath(invocation.name));
      if (invocation.out === undefined) {
        body.data = text;
        return undefined;
      }
      const path = resolve(invocation.out);
      try {
        await writeFile(path, text);
      } catch (error) {
        throw new CliError("usage", "usage", `--out: cannot write ${path}: ${reason(error)}`);
      }
      body.data = { name: invocation.name, path, bytes: Buffer.byteLength(text) };
      return undefined;
    }
    case "import": {
      // Read before anything is sent: an unreadable or oversized FILE is a usage error.
      const text = await readViewFile(invocation.file);
      const request: ImportViewRequest = { ...invocation.request, text };
      const answer = await client.post<{
        view: ViewSummary;
        warnings: string[];
        opened?: CommandResult;
      }>("/api/views/import", request);
      body.data = answer;
      if (answer.opened === undefined) return undefined;
      // A refused open after the store is rejected like a command; the stored view stays.
      return (await opened(Promise.resolve(answer.opened), body)).revision;
    }
    case "link": {
      // The document of the UI's "Copy link" (V7): same title rule, no saved time, no note.
      const { workspace } = await client.get<{ workspace: Workspace }>("/api/workspace");
      const title = workspace.view?.title ?? workspace.measurement?.name ?? "Shared view";
      const code = await encodeViewLink(workspaceToView(workspace, { title }));
      const page = new URL(invocation.page);
      const url = `${page.origin}${page.pathname}#view=${code}`;
      body.data = { url, chars: url.length };
      return undefined;
    }
  }
}

/** Maps the answer of an open like a command: accepted, revision; a refusal throws rejected. */
async function opened(send: Promise<CommandResult>, body: Body): Promise<Opened> {
  let answer: CommandResult;
  try {
    answer = await send;
  } catch (e) {
    // 4xx (unknown_view, invalid_view, …): nothing was opened. Transport failures leave it out.
    if (e instanceof CliError && e.outcome === "rejected") body.accepted = false;
    throw e;
  }
  if (!answer.ok) {
    body.accepted = false;
    throw new CliError("rejected", answer.code, answer.message);
  }
  body.accepted = true;
  body.revision = answer.revision;
  return answer;
}

function viewPath(name: string): string {
  return `/api/views/${encodeURIComponent(name)}`;
}

async function readViewFile(file: string): Promise<string> {
  try {
    const { size } = await stat(file);
    if (size > MAX_VIEW_BYTES) {
      throw new CliError(
        "usage",
        "usage",
        `FILE ${file} has ${size} bytes, more than ${MAX_VIEW_BYTES}`,
      );
    }
    return await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("usage", "usage", `cannot read FILE ${file}: ${reason(error)}`);
  }
}

function reason(error: unknown): string {
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") return code;
  return error instanceof Error ? error.message : String(error);
}
