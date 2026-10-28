import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type CasesDocument,
  type CreateWorkspaceAnswer,
  casesLinkUrl,
  DAY_NS,
  type Density,
  decodeCasesLink,
  encodeCasesLink,
  floorDiv,
  formatLocal,
  isSignedCases,
  MAX_CASES_TEXT,
  MAX_LINK_CHARS,
  toIso,
  trimCases,
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
  | { kind: "case"; action: "url"; file: string; trim?: true }
  | { kind: "case"; action: "drives"; dataRef: string; from: bigint; to: bigint };

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
      if (invocation.trim) {
        await trimmedUrl(cases, new URL(server).origin, body);
        return;
      }
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
      const ref = invocation.dataRef;
      const drives = await drivesOf(client, ref, invocation.from, invocation.to);
      if (drives.length === 0) {
        throw new CliError(
          "rejected",
          "no_data",
          `no drive of ${ref} in ${toIso(invocation.from)} … ${toIso(invocation.to)}`,
        );
      }
      const doc = {
        kipscope: "cases",
        version: 1,
        origin: { tool: "kipscope case drives" },
        cases: drives.map((d, i) => {
          const from = toIso(d.from);
          return {
            id: `${ref}|drive|${from}`,
            object: ref,
            kind: "driving",
            from,
            to: toIso(d.to),
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

const PART_NS = 6n * 3_600_000_000_000n;

/**
 * The drives of `ref` in [from, to) (cli "Catalog from drives", design B10): one bounded density
 * per UTC day cut to the range, one request at a time; a day answering too_wide again as four 6 h
 * parts; drives that touch at a day or part edge merged, their rows summed.
 */
async function drivesOf(
  client: Client,
  ref: string,
  from: bigint,
  to: bigint,
): Promise<{ from: bigint; to: bigint; rows: number }[]> {
  const drives: { from: bigint; to: bigint; rows: number }[] = [];
  const edges = new Set<bigint>();
  const ask = (a: bigint, b: bigint) =>
    client.get<Density>("/api/density", { dataRef: ref, from: toIso(a), to: toIso(b) });
  const add = (density: Density, a: bigint, b: bigint) => {
    edges.add(a);
    for (const d of density.drives) {
      const drive = { from: BigInt(d.from), to: BigInt(d.to), rows: d.rows };
      const last = drives[drives.length - 1];
      if (last !== undefined && last.to === drive.from && edges.has(drive.from)) {
        last.to = drive.to;
        last.rows += drive.rows;
      } else drives.push(drive);
    }
    edges.add(b);
  };
  for (let day = floorDiv(from, DAY_NS) * DAY_NS; day < to; day += DAY_NS) {
    const a = from > day ? from : day;
    const b = to < day + DAY_NS ? to : day + DAY_NS;
    try {
      add(await ask(a, b), a, b);
    } catch (error) {
      if (!(error instanceof CliError && error.code === "too_wide")) throw error;
      for (let part = day; part < day + DAY_NS; part += PART_NS) {
        const pa = a > part ? a : part;
        const pb = b < part + PART_NS ? b : part + PART_NS;
        if (pa < pb) add(await ask(pa, pb), pa, pb);
      }
    }
  }
  return drives;
}

/** `case url --trim` (design X2): the balanced trim of a document or an unsigned code. */
async function trimmedUrl(
  cases: string | Record<string, unknown>,
  origin: string,
  body: Body,
): Promise<void> {
  let doc: unknown = cases;
  if (typeof cases === "string") {
    if (isSignedCases(cases)) {
      throw new CliError(
        "usage",
        "usage",
        "a signed catalog cannot be trimmed: trim the document before signing",
      );
    }
    try {
      doc = await decodeCasesLink(cases);
    } catch (error) {
      throw new CliError("usage", "usage", `not a catalog link code: ${(error as Error).message}`);
    }
  }
  if (!isRecord(doc) || !Array.isArray(doc.cases) || doc.cases.length === 0) {
    throw new CliError("usage", "usage", "the catalog has no non-empty cases array");
  }
  const n = doc.cases.length;
  const current = doc.current ?? 0;
  if (typeof current !== "number" || !Number.isInteger(current) || current < 0 || current >= n) {
    throw new CliError(
      "usage",
      "usage",
      `current ${String(current)} is not an index into ${n} cases`,
    );
  }
  const checked = doc as Record<string, unknown> & { cases: unknown[]; current?: number };
  const result = await trimCases(checked, {
    maxChars: MAX_LINK_CHARS,
    encode: async (d) => casesLinkUrl(origin, await encodeCasesLink(d as CasesDocument)),
  });
  if (!result.ok) {
    throw new CliError(
      "usage",
      "link_too_long",
      `the link has ${result.chars} characters with the current entry alone, more than ${MAX_LINK_CHARS}: send the file with case open instead`,
    );
  }
  body.local = {
    url: result.text,
    dropped: result.dropped,
    position: `${(result.doc.current ?? 0) + 1} / ${result.doc.cases.length}`,
  };
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
