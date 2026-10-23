import {
  attributionText,
  type Command,
  type CursorName,
  DisplayMode,
  MAX_LINK_CHARS,
  parseDuration,
  parseTime,
  parseWorkspaceLink,
  ValuesMode,
  WORKSPACE_ID,
  WorkspaceShare,
} from "@kipscope/shared";
import type { CalcInvocation } from "./calc.ts";
import type { CaseInvocation } from "./case.ts";
import type { FavInvocation } from "./favourites.ts";
import { CliError } from "./output.ts";
import type { ViewInvocation } from "./views.ts";

export type TimeArg =
  | { kind: "abs"; t: bigint }
  | { kind: "anchor"; cursor: CursorName; offset: bigint };
export type SignalArg = { kind: "id"; id: string } | { kind: "name"; name: string };
export type RefArg = { kind: "assignment"; id: string } | SignalArg;
/** A command whose time, signal and assignment fields may still hold TimeArg/SignalArg/RefArg. */
export type CommandTemplate = { type: Command["type"] } & Record<string, unknown>;
export interface GlobalOptions {
  server: string;
  wait: boolean;
  timeoutMs: number;
  pretty: boolean;
  /** --workspace, else KIPSCOPE_WORKSPACE, else the workspace of a workspace link given as server (M13). */
  workspace?: string;
  /** --token, else KIPSCOPE_TOKEN; sent as `Authorization: Bearer`, never printed. */
  token?: string;
  /** KIPSCOPE_TOKEN_COMMAND when no token is given; run once per call (M13). */
  tokenCommand?: string;
}
export type Invocation =
  | { kind: "help" }
  | { kind: "state" }
  | { kind: "search"; query: string; limit?: number }
  | { kind: "extent"; signal: SignalArg }
  | { kind: "value"; signal: SignalArg; t: TimeArg; mode?: ValuesMode }
  | { kind: "wait"; revision?: number }
  /** filter: the FILTER words joined by one space, absent when none (the workspace filter applies). */
  | {
      kind: "events";
      filter?: string;
      dataRef?: string;
      from?: TimeArg;
      to?: TimeArg;
      table: boolean;
    }
  /** scope show reads workspace and meta; scope widen sends one scope.set (add-scope Z13). */
  | { kind: "scope"; action: "show" | "widen" }
  /** raw: a `command JSON`, sent as parsed without resolving anything. */
  | { kind: "command"; template: CommandTemplate; raw?: true }
  | { kind: "whoami" }
  /** Workspaces (add-multiuser M13); share acts on the call's workspace. */
  | { kind: "workspace"; action: "list" | "new" }
  | { kind: "workspace"; action: "share"; share: WorkspaceShare }
  | { kind: "workspace"; action: "delete"; id: string }
  | ViewInvocation
  | FavInvocation
  | CalcInvocation
  | CaseInvocation;

export const DEFAULT_SERVER = "http://localhost:7310";
const DEFAULT_TIMEOUT = "30s";

export const USAGE = `Usage: kipscope [options] <form>

Commands (each sends one command to the open workspace):
  window create [--values] [--title T] [--from TIME --to TIME] [--mode M] [--envelope on|off]
  window remove W
  window rename W TITLE            ("" clears the title)
  window height W PX
  window range W FROM TO
  window display W [--mode M] [--envelope on|off]
  link on|off
  signal add W SIGNAL
  signal remove W REF
  signal move W REF TARGET|new [--copy]
  cursor set a|b TIME
  cursor move a|b DURATION
  cursor remove a|b
  diff on|off
  digits 3|4                       (significant digits of values in the UI)
  measurement name TEXT            ("" clears the name)
  measurement object TEXT          (vehicle or device under test; "" clears it)
  measurement meta KEY VALUE       ("" removes the entry)
  measurement clear                (removes all measurement info)
  events filter FILTER...          (filter of the events line and list; "" for no filter words)
  events add SIGNAL                (state changes of SIGNAL on the events line)
  events remove SIGNAL
  scope set REF FROM TO            (bounds every query to one data ref and [FROM, TO))
  scope widen                      (one scope.set with the span added on each side)
  scope clear                      (removes the scope; refused in scoped catalog mode)
  command JSON                     (one command of the shared command model, sent as is)

Reads:
  state
  scope show                       (the scope and the catalog's mode, state and size)
  search QUERY... [--limit N]
  extent SIGNAL
  value SIGNAL TIME [--mode line|step]
  wait [REVISION]
  events list [FILTER...] [--ref DATAREF] [--from TIME --to TIME] [--table]
                                   (no FILTER: the workspace's; DATAREF: default that of the
                                   first signal shown; --table prints lines instead of JSON)

Workspaces (each with its own link; the default is your latest one):
  whoami                           (your user, identity, roles and whether you may share)
  workspace list                   (your workspaces, latest first)
  workspace new                    (a new empty workspace; local.url is its link)
  workspace share private|read|write
                                   (who else may open the call's workspace)
  workspace delete ID

Catalogs (ordered lists handed over by a search tool; N: 1-based position):
  case open FILE|-                 (a new workspace from a catalog document, a signed or
                                   unsigned code, or a CLI output holding one; - reads stdin;
                                   local.url is its link)
  case show                        (the open catalog's state; local.position "k / n")
  case next | case prev            (step to the next or previous catalog entry)
  case go N                        (go to entry N and link)
  case link [N]                    (link again: to entry N, default the entry left)
  case unlink                      (the whole vehicle of the current entry)
  case align start|end|anchor
  case align event KIND SOURCE NAME [TEXT]
                                   (align every entry to its first matching event)
  case url FILE|- [--trim]         (prints the link /open#cases=…; at most ${MAX_LINK_CHARS} characters;
                                   --trim drops entries far from current until it fits)
  case drives REF                  (test aid: prints a catalog of REF's drives in the strip)

Views (saved workspaces, stored by the server):
  view list
  view save TITLE [--name N] [--note TEXT] [--overwrite]
                                   (N: file name, default derived from TITLE)
  view open NAME                   (one command; honours --wait)
  view delete NAME
  view export NAME [--out FILE]    (prints the YAML text itself; --out writes FILE instead)
  view import FILE [--name N] [--overwrite] [--open]
                                   (FILE: YAML or JSON, at most 256 KiB)
  view link [--page URL]           (link to the open workspace, like "Copy link" in the UI;
                                   URL: the UI page, default the server address)

Favourites (your starred signals, by name on every vehicle and workspace):
  fav list
  fav add NAME...                  (NAME: a SIGNAL, stored by its name; a name not in this
                                   list is stored as given, with a warning)
  fav rm NAME...                   (a favourite, its part after the first ".", or a full ID)

Computed signals (formulas of up to 8 signals, stored in the workspace):
  calc list
  calc add FORMULA [--name NAME] [--unit UNIT]
                                   (FORMULA: signal and computed names, numbers, + - * / ( ),
                                   abs(x), min(x, y, ...), max(x, y, ...), e.g.
                                   "abs(DNMOT - PNHV_SupBat_Curr)"; a name is a full name, its
                                   part after the first "." when unique, or a computed signal's
                                   name; other names in double quotes; NAME and UNIT default to
                                   the auto name and unit)
  calc edit ID|NAME [--formula F] [--name NAME] [--unit UNIT]
                                   (replaces the given parts; prints the new ID as created)
  calc rm ID|NAME                  (ID: c7 as in calc list; NAME ignoring case; refused while
                                   another computed signal uses it)

Options (anywhere on the line; "--" ends options):
  --server URL        http(s) server address (default: $KIPSCOPE_URL, else ${DEFAULT_SERVER});
                      a workspace link (URL/w/ID) also names the workspace
  --workspace ID|LINK the workspace every request of the call goes to (default:
                      $KIPSCOPE_WORKSPACE, else the workspace of a --server link, else your
                      latest workspace, kept for the whole call)
  --token T           access token, sent as Authorization: Bearer (default: $KIPSCOPE_TOKEN,
                      else the output of $KIPSCOPE_TOKEN_COMMAND, run once per call, 10 s)
  --wait              after an accepted command, wait until an open UI has rendered it
  --timeout DURATION  deadline of the whole call (default ${DEFAULT_TIMEOUT})
  --pretty            indent the JSON output
  -h, --help          print this text

W        window ID (w1, w2, ...)
M        line|step|markers
TIME     decimal ns; YYYY-MM-DD[T| ]HH:MM[:SS[.f{1,9}]] with Z or +HH:MM, or without zone
         as local time (TZ); a or b, optionally +DURATION or -DURATION (cursor anchor)
DURATION [+|-]<decimal><unit>, unit ns|us|µs|ms|s|min|h (e.g. +500ms, -1.5s)
SIGNAL   full ID (dataRef/name) or a unique bare name (SPEED_DISP); value and extent also
         take a computed ID (dataRef/=c7)
REF      assignment ID (a3) or a SIGNAL shown in window W; of scope set: a data ref (testcar)
FILTER   words: active changes faults … all none; ecu:X name:X text:X "phrase"; -term excludes

Output: one JSON line on stdout (except events list --table and view export without --out).
Exit codes: 0 ok, 1 rejected (also unauthenticated, invalid_token, forbidden_data),
2 usage (also token_command_failed), 3 unreachable, 4 timeout, 5 render_error, 6 no_ui,
7 unavailable (also identity_unavailable).

${attributionText()}
`;

const VALUE_OPTIONS = new Set([
  "--server",
  "--timeout",
  "--title",
  "--from",
  "--to",
  "--mode",
  "--envelope",
  "--limit",
  "--ref",
  "--name",
  "--note",
  "--out",
  "--page",
  "--workspace",
  "--token",
  "--formula",
  "--unit",
]);
const FLAG_OPTIONS = new Set([
  "--wait",
  "--pretty",
  "--help",
  "--values",
  "--copy",
  "--table",
  "--overwrite",
  "--open",
  "--trim",
]);
const GLOBAL_OPTIONS = new Set([
  "--server",
  "--workspace",
  "--token",
  "--timeout",
  "--wait",
  "--pretty",
  "--help",
]);

function usage(message: string): never {
  throw new CliError("usage", "usage", message);
}

/**
 * Splits argv into options and positionals. Options are `--long` (and `-h`); any other token of one
 * `-` and a character other than `-` is positional (`-1.5s`, filter exclusions like `-snapshots`).
 */
function tokenize(argv: string[]): { opts: Map<string, string | true>; pos: string[] } {
  const opts = new Map<string, string | true>();
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (token === "--") {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith("-") || token === "-" || (/^-[^-]/.test(token) && token !== "-h")) {
      pos.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    let name = eq > 0 ? token.slice(0, eq) : token;
    if (name === "-h") name = "--help";
    if (opts.has(name)) usage(`option ${name} given twice`);
    if (VALUE_OPTIONS.has(name)) {
      if (eq > 0) opts.set(name, token.slice(eq + 1));
      else if (i + 1 < argv.length) opts.set(name, argv[++i] as string);
      else usage(`option ${name} needs a value`);
    } else if (FLAG_OPTIONS.has(name)) {
      if (eq > 0) usage(`option ${name} takes no value`);
      opts.set(name, true);
    } else {
      usage(`unknown option ${name}`);
    }
  }
  return { opts, pos };
}

function time(text: string, what: string): TimeArg {
  const anchor = /^([ab])([+-].*)?$/.exec(text);
  if (anchor) {
    const offset = anchor[2] === undefined ? 0n : duration(anchor[2], what);
    return { kind: "anchor", cursor: anchor[1] as CursorName, offset };
  }
  try {
    return { kind: "abs", t: parseTime(text) };
  } catch (error) {
    return usage(`${what}: ${(error as Error).message}`);
  }
}

function duration(text: string, what: string): bigint {
  try {
    return parseDuration(text);
  } catch (error) {
    return usage(`${what}: ${(error as Error).message}`);
  }
}

function signal(text: string): SignalArg {
  if (text === "") usage("SIGNAL is empty");
  return text.includes("/") ? { kind: "id", id: text } : { kind: "name", name: text };
}

function ref(text: string): RefArg {
  return /^a\d+$/.test(text) ? { kind: "assignment", id: text } : signal(text);
}

function cursorName(text: string): CursorName {
  if (text !== "a" && text !== "b") usage(`cursor must be a or b, got "${text}"`);
  return text;
}

function onOff(text: string, what: string): boolean {
  if (text === "on") return true;
  if (text === "off") return false;
  return usage(`${what} must be on or off, got "${text}"`);
}

function integer(text: string, what: string, signed: boolean): number {
  if (!(signed ? /^-?\d+$/ : /^\d+$/).test(text)) {
    usage(`${what} must be ${signed ? "an" : "a non-negative"} integer, got "${text}"`);
  }
  return Number(text);
}

/** A 1-based position N: an integer ≥ 1. */
function position(text: string): number {
  if (!/^\d+$/.test(text) || Number(text) < 1) {
    usage(`N must be a position, an integer ≥ 1, got "${text}"`);
  }
  return Number(text);
}

function displayMode(text: string): DisplayMode {
  const mode = DisplayMode.safeParse(text);
  return mode.success ? mode.data : usage(`--mode must be line, step or markers, got "${text}"`);
}

function valuesMode(text: string): ValuesMode {
  const mode = ValuesMode.safeParse(text);
  return mode.success ? mode.data : usage(`--mode must be line or step, got "${text}"`);
}

/** A workspace ID, or the ID of a workspace link; anything else is a usage error. */
function workspaceOf(text: string, what: string): string {
  if (WORKSPACE_ID.test(text)) return text;
  const link = parseWorkspaceLink(text);
  if (link === undefined) {
    usage(`${what} is neither a workspace ID nor a workspace link: "${text}"`);
  }
  return link.workspace;
}

function globalOptions(
  opts: Map<string, string | true>,
  env: Record<string, string | undefined>,
): GlobalOptions {
  let server = (opts.get("--server") as string | undefined) ?? env.KIPSCOPE_URL ?? DEFAULT_SERVER;
  // `localhost:7310` parses as a URL with protocol "localhost:", so the protocol is checked too.
  if (!URL.canParse(server) || !["http:", "https:"].includes(new URL(server).protocol)) {
    usage(`server address is not an http(s) URL: "${server}"`);
  }
  // A workspace link as the server: its origin is the server, its ID the default workspace.
  const link = parseWorkspaceLink(server);
  if (link !== undefined) server = link.origin;
  const workspaceOption = opts.get("--workspace") as string | undefined;
  const workspace =
    workspaceOption !== undefined
      ? workspaceOf(workspaceOption, "--workspace")
      : env.KIPSCOPE_WORKSPACE
        ? workspaceOf(env.KIPSCOPE_WORKSPACE, "KIPSCOPE_WORKSPACE")
        : link?.workspace;
  const tokenOption = opts.get("--token") as string | undefined;
  if (tokenOption !== undefined && tokenOption.trim() === "") usage("--token is empty");
  const token = tokenOption ?? (env.KIPSCOPE_TOKEN?.trim() || undefined);
  const tokenCommand = token === undefined ? env.KIPSCOPE_TOKEN_COMMAND || undefined : undefined;
  const timeout = (opts.get("--timeout") as string | undefined) ?? DEFAULT_TIMEOUT;
  const ns = duration(timeout, "--timeout");
  if (ns <= 0n) usage("--timeout must be greater than 0");
  return {
    server,
    wait: opts.has("--wait"),
    timeoutMs: Number(ns) / 1e6,
    pretty: opts.has("--pretty"),
    ...(workspace !== undefined && { workspace }),
    ...(token !== undefined && { token: token.trim() }),
    ...(tokenCommand !== undefined && { tokenCommand }),
  };
}

/** Throws CliError("usage", "usage", …). server: --server, else env.KIPSCOPE_URL, else http://localhost:7310. */
export function parseArgs(
  argv: string[],
  env: Record<string, string | undefined>,
): { options: GlobalOptions; invocation: Invocation } {
  const { opts, pos } = tokenize(argv);
  if (opts.has("--help")) {
    return {
      options: {
        server: (opts.get("--server") as string | undefined) ?? env.KIPSCOPE_URL ?? DEFAULT_SERVER,
        wait: false,
        timeoutMs: 30_000,
        pretty: opts.has("--pretty"),
      },
      invocation: { kind: "help" },
    };
  }
  const options = globalOptions(opts, env);
  return { options, invocation: invocation(pos, opts, options.server) };
}

/** server: the resolved --server address (default page of `view link`). */
function invocation(pos: string[], opts: Map<string, string | true>, server: string): Invocation {
  const [first, second] = pos;
  if (first === undefined) usage("no command given (see --help)");
  const group = [
    "window",
    "signal",
    "cursor",
    "measurement",
    "events",
    "view",
    "scope",
    "workspace",
    "case",
    "fav",
    "calc",
  ].includes(first);
  const form = group ? `${first} ${second ?? ""}`.trim() : first;
  const args = pos.slice(group ? 2 : 1);

  /** Checks the argument count and the form's own options; returns the option getter. */
  const take = (count: number | [number, number], allowed: string[] = []) => {
    const [min, max] = typeof count === "number" ? [count, count] : count;
    if (args.length < min || args.length > max) {
      usage(
        `${form} takes ${min === max ? min : `${min} to ${max}`} argument${max === 1 ? "" : "s"}, got ${args.length} (see --help)`,
      );
    }
    for (const name of opts.keys()) {
      if (!GLOBAL_OPTIONS.has(name) && !allowed.includes(name)) {
        usage(`option ${name} does not apply to ${form}`);
      }
    }
    return (name: string) => opts.get(name) as string | undefined;
  };
  const arg = (i: number) => args[i] as string;
  const command = (template: CommandTemplate): Invocation => ({ kind: "command", template });
  /** NAME of a view form; an empty one would address the list route. */
  const viewName = (i: number) => (arg(i) === "" ? usage("NAME is empty") : arg(i));

  switch (form) {
    case "state":
      take(0);
      return { kind: "state" };
    case "search": {
      const opt = take([1, Number.POSITIVE_INFINITY], ["--limit"]);
      const limit = opt("--limit");
      return {
        kind: "search",
        query: args.join(" "),
        ...(limit !== undefined && { limit: integer(limit, "--limit", false) }),
      };
    }
    case "extent":
      take(1);
      return { kind: "extent", signal: signal(arg(0)) };
    case "value": {
      const opt = take(2, ["--mode"]);
      const mode = opt("--mode");
      return {
        kind: "value",
        signal: signal(arg(0)),
        t: time(arg(1), "TIME"),
        ...(mode !== undefined && { mode: valuesMode(mode) }),
      };
    }
    case "wait":
      take([0, 1]);
      return args.length === 0
        ? { kind: "wait" }
        : { kind: "wait", revision: integer(arg(0), "REVISION", false) };
    case "window create": {
      const opt = take(0, ["--values", "--title", "--from", "--to", "--mode", "--envelope"]);
      const [title, from, to, mode, envelope] = [
        "--title",
        "--from",
        "--to",
        "--mode",
        "--envelope",
      ].map(opt);
      if ((from === undefined) !== (to === undefined))
        usage("--from and --to must be given together");
      return command({
        type: "window.create",
        ...(opts.has("--values") && { kind: "values" }),
        ...(title !== undefined && { title }),
        ...(from !== undefined && { from: time(from, "--from") }),
        ...(to !== undefined && { to: time(to, "--to") }),
        ...(mode !== undefined && { mode: displayMode(mode) }),
        ...(envelope !== undefined && { envelope: onOff(envelope, "--envelope") }),
      });
    }
    case "window remove":
      take(1);
      return command({ type: "window.remove", windowId: arg(0) });
    case "window rename":
      take(2);
      return command({ type: "window.rename", windowId: arg(0), title: arg(1) });
    case "window height":
      take(2);
      return command({
        type: "window.setHeight",
        windowId: arg(0),
        height: integer(arg(1), "PX", true),
      });
    case "window range":
      take(3);
      return command({
        type: "window.setRange",
        windowId: arg(0),
        from: time(arg(1), "FROM"),
        to: time(arg(2), "TO"),
      });
    case "window display": {
      const opt = take(1, ["--mode", "--envelope"]);
      const mode = opt("--mode");
      const envelope = opt("--envelope");
      if (mode === undefined && envelope === undefined) {
        usage("window display needs --mode or --envelope");
      }
      return command({
        type: "window.setDisplay",
        windowId: arg(0),
        ...(mode !== undefined && { mode: displayMode(mode) }),
        ...(envelope !== undefined && { envelope: onOff(envelope, "--envelope") }),
      });
    }
    case "link":
      take(1);
      return command({ type: "workspace.setLinkTime", linked: onOff(arg(0), "link") });
    case "signal add":
      take(2);
      return command({ type: "window.addSignal", windowId: arg(0), signalId: signal(arg(1)) });
    case "signal remove":
      take(2);
      return command({ type: "window.removeSignal", windowId: arg(0), assignmentId: ref(arg(1)) });
    case "signal move": {
      take(3, ["--copy"]);
      const target = arg(2);
      return command({
        type: "window.moveSignal",
        windowId: arg(0),
        assignmentId: ref(arg(1)),
        ...(target !== "new" && { targetWindowId: target }),
        ...(opts.has("--copy") && { copy: true }),
      });
    }
    case "cursor set":
      take(2);
      return command({ type: "cursor.set", cursor: cursorName(arg(0)), t: time(arg(1), "TIME") });
    case "cursor move":
      take(2);
      return command({
        type: "cursor.move",
        cursor: cursorName(arg(0)),
        by: duration(arg(1), "DURATION").toString(),
      });
    case "cursor remove":
      take(1);
      return command({ type: "cursor.remove", cursor: cursorName(arg(0)) });
    case "diff":
      take(1);
      return command({ type: "cursor.setDiff", diff: onOff(arg(0), "diff") });
    case "digits": {
      take(1);
      const digits = arg(0);
      if (digits !== "3" && digits !== "4") usage(`digits must be 3|4, got "${digits}"`);
      return command({ type: "workspace.setOptions", digits: Number(digits) });
    }
    case "measurement name":
      take(1);
      return command({ type: "measurement.set", name: arg(0) });
    case "measurement object":
      take(1);
      return command({ type: "measurement.set", object: arg(0) });
    case "measurement meta":
      take(2);
      return command({ type: "measurement.setMeta", key: arg(0), value: arg(1) });
    case "measurement clear":
      take(0);
      return command({ type: "measurement.clear" });
    case "events list": {
      const opt = take([0, Number.POSITIVE_INFINITY], ["--ref", "--from", "--to", "--table"]);
      const [dataRef, from, to] = ["--ref", "--from", "--to"].map(opt);
      if ((from === undefined) !== (to === undefined))
        usage("--from and --to must be given together");
      if (dataRef === "") usage("--ref is empty");
      return {
        kind: "events",
        ...(args.length > 0 && { filter: args.join(" ") }),
        ...(dataRef !== undefined && { dataRef }),
        ...(from !== undefined && { from: time(from, "--from") }),
        ...(to !== undefined && { to: time(to, "--to") }),
        table: opts.has("--table"),
      };
    }
    case "events filter":
      take([1, Number.POSITIVE_INFINITY]);
      return command({ type: "events.setFilter", filter: args.join(" ") });
    case "events add":
      take(1);
      return command({ type: "events.addSignal", signalId: signal(arg(0)) });
    case "events remove":
      take(1);
      return command({ type: "events.removeSignal", signalId: signal(arg(0)) });
    case "view list":
      take(0);
      return { kind: "view", action: "list" };
    case "view save": {
      const opt = take(1, ["--name", "--note", "--overwrite"]);
      const [name, note] = ["--name", "--note"].map(opt);
      return {
        kind: "view",
        action: "save",
        request: {
          title: arg(0),
          ...(note !== undefined && { note }),
          ...(name !== undefined && { name }),
          ...(opts.has("--overwrite") && { overwrite: true }),
        },
      };
    }
    case "view open":
      take(1);
      return { kind: "view", action: "open", request: { name: viewName(0) } };
    case "view delete":
      take(1);
      return { kind: "view", action: "delete", name: viewName(0) };
    case "view export": {
      const out = take(1, ["--out"])("--out");
      if (out === "") usage("--out is empty");
      return {
        kind: "view",
        action: "export",
        name: viewName(0),
        ...(out !== undefined && { out }),
      };
    }
    case "view import": {
      const name = take(1, ["--name", "--overwrite", "--open"])("--name");
      if (arg(0) === "") usage("FILE is empty");
      return {
        kind: "view",
        action: "import",
        file: arg(0),
        request: {
          ...(name !== undefined && { name }),
          ...(opts.has("--overwrite") && { overwrite: true }),
          ...(opts.has("--open") && { open: true }),
        },
      };
    }
    case "view link": {
      const page = take(0, ["--page"])("--page") ?? server;
      if (!URL.canParse(page) || !["http:", "https:"].includes(new URL(page).protocol)) {
        usage(`--page is not an http(s) URL: "${page}"`);
      }
      return { kind: "view", action: "link", page };
    }
    case "scope set":
      take(3);
      if (arg(0) === "") usage("REF is empty");
      return command({
        type: "scope.set",
        dataRef: arg(0),
        from: time(arg(1), "FROM"),
        to: time(arg(2), "TO"),
      });
    case "scope show":
      take(0);
      return { kind: "scope", action: "show" };
    case "scope widen":
      take(0);
      return { kind: "scope", action: "widen" };
    case "scope clear":
      take(0);
      return command({ type: "scope.clear" });
    case "whoami":
      take(0);
      return { kind: "whoami" };
    case "workspace list":
      take(0);
      return { kind: "workspace", action: "list" };
    case "workspace new":
      take(0);
      return { kind: "workspace", action: "new" };
    case "workspace share": {
      take(1);
      const share = WorkspaceShare.safeParse(arg(0));
      if (!share.success) usage(`workspace share takes private, read or write, got "${arg(0)}"`);
      return { kind: "workspace", action: "share", share: share.data };
    }
    case "workspace delete":
      take(1);
      if (!WORKSPACE_ID.test(arg(0))) usage(`not a workspace ID: "${arg(0)}"`);
      return { kind: "workspace", action: "delete", id: arg(0) };
    case "fav list":
      take(0);
      return { kind: "fav", action: "list" };
    case "fav add":
    case "fav rm":
      if (args.length === 0) usage(`${form} needs at least one NAME (see --help)`);
      take([1, Number.POSITIVE_INFINITY]);
      if (args.includes("")) usage("NAME is empty");
      return { kind: "fav", action: form === "fav add" ? "add" : "rm", names: args };
    case "calc list":
      take(0);
      return { kind: "calc", action: "list" };
    case "calc add": {
      if (args.length === 0) usage("calc add needs a FORMULA (see --help)");
      const opt = take(1, ["--name", "--unit"]);
      const [name, unit] = ["--name", "--unit"].map(opt);
      return {
        kind: "calc",
        action: "add",
        formula: arg(0),
        ...(name !== undefined && { name }),
        ...(unit !== undefined && { unit }),
      };
    }
    case "calc edit": {
      const parts = ["--formula", "--name", "--unit"];
      if (args.length === 0) usage("calc edit needs an ID or NAME (see --help)");
      const opt = take(1, parts);
      const [formula, name, unit] = parts.map(opt);
      if ([formula, name, unit].every((p) => p === undefined)) {
        usage("calc edit needs --formula, --name or --unit");
      }
      return {
        kind: "calc",
        action: "edit",
        target: arg(0),
        ...(formula !== undefined && { formula }),
        ...(name !== undefined && { name }),
        ...(unit !== undefined && { unit }),
      };
    }
    case "calc rm":
      if (args.length === 0) usage("calc rm needs an ID or NAME (see --help)");
      take(1);
      return { kind: "calc", action: "rm", target: arg(0) };
    case "case open":
      take(1);
      if (arg(0) === "") usage("FILE is empty");
      return { kind: "case", action: "open", file: arg(0) };
    case "case url":
      take(1, ["--trim"]);
      if (arg(0) === "") usage("FILE is empty");
      return {
        kind: "case",
        action: "url",
        file: arg(0),
        ...(opts.has("--trim") && { trim: true as const }),
      };
    case "case show":
      take(0);
      return { kind: "case", action: "show" };
    case "case next":
    case "case prev":
      take(0);
      return command({ type: "case.step", by: form === "case next" ? 1 : -1 });
    case "case go":
      take(1);
      return command({ type: "case.go", index: position(arg(0)) - 1 });
    case "case link":
      take([0, 1]);
      return command({
        type: "case.go",
        index: args.length === 0 ? { kind: "current" } : position(arg(0)) - 1,
      });
    case "case unlink":
      take(0);
      return command({ type: "case.unlink" });
    case "case align": {
      const mode = args[0];
      if (mode === "start" || mode === "end" || mode === "anchor") {
        take(1);
        return command({ type: "case.align", align: { mode } });
      }
      if (mode !== "event")
        usage(`case align takes start, end, anchor or event, got "${mode ?? ""}"`);
      take([4, 5]);
      return command({
        type: "case.align",
        align: {
          mode: "event",
          event: {
            kind: arg(1),
            source: arg(2),
            name: arg(3),
            ...(args.length === 5 && { text: arg(4) }),
          },
        },
      });
    }
    case "case drives":
      take(1);
      if (arg(0) === "") usage("REF is empty");
      return { kind: "case", action: "drives", dataRef: arg(0) };
    case "command": {
      take(1);
      try {
        return { kind: "command", template: JSON.parse(arg(0)) as CommandTemplate, raw: true };
      } catch (error) {
        return usage(`command: JSON does not parse: ${(error as Error).message}`);
      }
    }
    default:
      return usage(`unknown command "${form}" (see --help)`);
  }
}
