import {
  type CommandInput,
  parseSignalId,
  type SignalPage,
  TIME_MAX,
  TIME_MIN,
  type Workspace,
} from "@kipscope/shared";
import type { CommandTemplate, RefArg, SignalArg, TimeArg } from "./args.ts";
import { CliError } from "./output.ts";

export interface Lookups {
  /** Memoised per call by the caller (run.ts reads the workspace at most once). */
  workspace(): Promise<{ revision: number; workspace: Workspace }>;
  search(query: string, limit: number): Promise<SignalPage>;
}

/** Page size of a bare-name lookup; exact matches are search tier 0 and come first (D-022). */
export const NAME_LIMIT = 200;

/** Name equality of L6: the name, or the name after its first ".", ignoring case. */
export function nameMatches(name: string, wanted: string): boolean {
  const lower = wanted.toLowerCase();
  const dot = name.indexOf(".");
  return name.toLowerCase() === lower || (dot >= 0 && name.slice(dot + 1).toLowerCase() === lower);
}

/** Absolute time of an argument; an anchor on an off cursor rejects with cursor_off. */
export async function resolveTime(arg: TimeArg, l: Lookups): Promise<bigint> {
  if (arg.kind === "abs") return arg.t;
  const at = (await l.workspace()).workspace.cursors[arg.cursor];
  if (at === undefined) {
    throw new CliError("rejected", "cursor_off", `cursor ${arg.cursor.toUpperCase()} is off`);
  }
  const t = BigInt(at) + arg.offset;
  if (t < TIME_MIN || t > TIME_MAX) {
    throw new CliError("usage", "usage", `time ${t} is outside 1900-01-01 … 2262-04-11`);
  }
  return t;
}

/** Full ID unchanged; a bare name through the search (unknown_signal | ambiguous_signal). */
export async function resolveSignal(arg: SignalArg, l: Lookups): Promise<string> {
  if (arg.kind === "id") return arg.id;
  const page = await l.search(arg.name, NAME_LIMIT);
  const ids = page.items.filter((s) => nameMatches(s.name, arg.name)).map((s) => s.id);
  if (ids.length === 1) return ids[0] as string;
  if (ids.length === 0) {
    throw new CliError("rejected", "unknown_signal", `no signal named "${arg.name}"`);
  }
  const candidates = ids.sort();
  throw new CliError(
    "rejected",
    "ambiguous_signal",
    `"${arg.name}" names ${candidates.length} signals: ${candidates.join(", ")}`,
    candidates,
  );
}

/** Assignment ID of REF in window W (unknown_window | unknown_assignment | ambiguous_signal). */
export async function resolveRef(windowId: string, arg: RefArg, l: Lookups): Promise<string> {
  if (arg.kind === "assignment") return arg.id;
  const window = (await l.workspace()).workspace.windows.find((w) => w.id === windowId);
  if (window === undefined) {
    throw new CliError("rejected", "unknown_window", `no window ${windowId}`);
  }
  const matches = window.signals.filter((a) =>
    arg.kind === "id"
      ? a.signalId === arg.id
      : nameMatches(parseSignalId(a.signalId)?.name ?? a.signalId, arg.name),
  );
  const wanted = arg.kind === "id" ? arg.id : arg.name;
  if (matches.length === 1) return (matches[0] as { id: string }).id;
  if (matches.length === 0) {
    throw new CliError(
      "rejected",
      "unknown_assignment",
      `window ${windowId} does not show ${wanted}`,
    );
  }
  const candidates = matches.map((a) => a.signalId).sort();
  throw new CliError(
    "rejected",
    "ambiguous_signal",
    `"${wanted}" names ${candidates.length} signals in ${windowId}: ${candidates.join(", ")}`,
    candidates,
  );
}

const isArg = (value: unknown, kinds: string[]): boolean =>
  typeof value === "object" &&
  value !== null &&
  kinds.includes((value as { kind?: unknown }).kind as string);

/**
 * Replaces every TimeArg (→ decimal ns string), SignalArg and RefArg of a template built by
 * parseArgs; templates without refs need no lookup. A raw `command JSON` never comes here (run.ts
 * sends it as parsed).
 */
export async function resolveCommand(t: CommandTemplate, l: Lookups): Promise<CommandInput> {
  const out: Record<string, unknown> = { ...t };
  for (const key of ["t", "from", "to"]) {
    const value = out[key];
    if (isArg(value, ["abs", "anchor"]))
      out[key] = (await resolveTime(value as TimeArg, l)).toString();
  }
  if (isArg(out.signalId, ["id", "name"])) {
    out.signalId = await resolveSignal(out.signalId as SignalArg, l);
  }
  // `case link` without N: the session the workspace's catalog left (K15).
  if (isArg(out.index, ["current"])) {
    const held = (await l.workspace()).workspace.case;
    if (held === undefined) {
      throw new CliError("rejected", "no_case", "this workspace has no open catalog");
    }
    out.index = held.current;
  }
  if (isArg(out.assignmentId, ["assignment", "id", "name"])) {
    out.assignmentId = await resolveRef(String(out.windowId), out.assignmentId as RefArg, l);
  }
  return out as CommandInput;
}
