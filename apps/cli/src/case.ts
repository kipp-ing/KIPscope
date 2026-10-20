import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type CasesDocument,
  type CreateWorkspaceAnswer,
  casesLinkUrl,
  type Density,
  encodeCasesLink,
  formatLocal,
  isSignedCases,
  MAX_CASES_TEXT,
  MAX_LINK_CHARS,
  toIso,
  type Workspace,
  workspacePath,
} from "@kipscope/shared";
import type { Client } from "./client.ts";
import { CliError } from "./output.ts";
import type { Body } from "./run.ts";

/** The `case …` forms that are no plain command (add-case-open K15); FILE "-" is stdin. */
export type CaseInvocation =
  | { kind: "case"; action: "open"; file: string }
  | { kind: "case"; action: "show" }
  | { kind: "case"; action: "url"; file: string }
  | { kind: "case"; action: "drives"; dataRef: string };

/** Executes one of these forms and fills `body`; failures throw CliError. */
export async function runCase(
  invocation: CaseInvocation,
  client: Client,
  server: string,
  body: Body,
): Promise<void> {
  switch (invocation.action) {
    case "open": {
      const cases = catalogOf(await readInput(invocation.file));
      const answer = await client.post<CreateWorkspaceAnswer>("/api/workspaces", {
        open: { cases },
      });
      body.data = answer;
      body.local = { url: new URL(workspacePath(answer.workspace.id), server).href };
      return;
    }
    case "show": {
      const { revision, workspace } = await client.get<{ revision: number; workspace: Workspace }>(
        "/api/workspace",
      );
      body.revision = revision;
      const held = workspace.case;
      if (held === undefined)
        throw new CliError("rejected", "no_case", "this workspace has no open catalog");
      body.data = held;
      body.local = {
        position: `${held.current + 1} / ${held.count}`,
        from: local(held.entry.from),
        to: local(held.entry.to),
      };
      return;
    }
    case "url": {
      const cases = catalogOf(await readInput(invocation.file));
      const code =
        typeof cases === "string" ? cases : await encodeCasesLink(cases as CasesDocument);
      const url = casesLinkUrl(new URL(server).origin, code);
      if (url.length > MAX_LINK_CHARS) {
        throw new CliError(
          "usage",
          "link_too_long",
          `the link has ${url.length} characters, more than ${MAX_LINK_CHARS}: send the file with case open instead`,
        );
      }
      body.local = { url };
      return;
    }
    case "drives": {
      const density = await client.get<Density>("/api/density", { dataRef: invocation.dataRef });
      if (density.drives.length === 0) {
        throw new CliError("rejected", "no_data", `no drive in the strip of ${invocation.dataRef}`);
      }
      const ref = invocation.dataRef;
      const doc = {
        kipscope: "cases",
        version: 1,
        origin: { tool: "kipscope case drives" },
        cases: density.drives.map((d, i) => {
          const from = toIso(BigInt(d.from));
          return {
            id: `${ref}|drive|${from}`,
            object: ref,
            kind: "driving",
            from,
            to: toIso(BigInt(d.to)),
            title: `Drive ${i + 1}`,
            meta: { rows: d.rows },
          };
        }),
      };
      body.data = doc;
      return;
    }
  }
}

/** FILE's text, or stdin's for "-", trimmed; unreadable or too long is a usage error. */
async function readInput(file: string): Promise<string> {
  let text: string;
  try {
    text = file === "-" ? await readStdin() : await readFile(resolve(file), "utf8");
  } catch (error) {
    const what = file === "-" ? "stdin" : resolve(file);
    throw new CliError("usage", "usage", `cannot read ${what}: ${(error as Error).message}`);
  }
  text = text.trim();
  if (text === "")
    throw new CliError("usage", "usage", `${file === "-" ? "stdin" : file} is empty`);
  if (text.length > MAX_CASES_TEXT) {
    throw new CliError("usage", "usage", `a catalog holds at most ${MAX_CASES_TEXT} characters`);
  }
  return text;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * What `cases` carries (K3, K15): a JSON object as the document, a CLI output's `data` as the
 * document (`case drives … | case open -`), anything else (a JWS, an unsigned code) as the string.
 */
function catalogOf(text: string): string | Record<string, unknown> {
  if (isSignedCases(text) || !text.startsWith("{")) return text;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new CliError(
      "usage",
      "usage",
      `the catalog JSON does not parse: ${(error as Error).message}`,
    );
  }
  if (!isRecord(value)) throw new CliError("usage", "usage", "the catalog is not a JSON object");
  // A CLI output line: {ok, outcome, exitCode, …, data}.
  if ("outcome" in value && "exitCode" in value) {
    if (value.ok !== true || !isRecord(value.data)) {
      const error = isRecord(value.error) ? `: ${String(value.error.code)}` : "";
      throw new CliError("usage", "usage", `the piped CLI output holds no catalog${error}`);
    }
    return value.data;
  }
  return value;
}

/** Local time with offset (design L5), from decimal ns. */
function local(t: string): string {
  return formatLocal(BigInt(t), { offset: true });
}
