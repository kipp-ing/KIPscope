import {
  attributionText,
  type Command,
  type CursorName,
  DisplayMode,
  parseDuration,
  parseTime,
  ValuesMode,
} from "@kipscope/shared";
import { CliError } from "./output.ts";

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
}
export type Invocation =
  | { kind: "help" }
  | { kind: "state" }
  | { kind: "search"; query: string; limit?: number }
  | { kind: "extent"; signal: SignalArg }
  | { kind: "value"; signal: SignalArg; t: TimeArg; mode?: ValuesMode }
  | { kind: "wait"; revision?: number }
  /** raw: a `command JSON`, sent as parsed without resolving anything. */
  | { kind: "command"; template: CommandTemplate; raw?: true };

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
  command JSON                     (one command of the shared command model, sent as is)

Reads:
  state
  search QUERY... [--limit N]
  extent SIGNAL
  value SIGNAL TIME [--mode line|step]
  wait [REVISION]

Options (anywhere on the line; "--" ends options):
  --server URL        http(s) server address (default: $KIPSCOPE_URL, else ${DEFAULT_SERVER})
  --wait              after an accepted command, wait until an open UI has rendered it
  --timeout DURATION  deadline of the whole call (default ${DEFAULT_TIMEOUT})
  --pretty            indent the JSON output
  -h, --help          print this text

W        window ID (w1, w2, ...)
M        line|step|markers
TIME     decimal ns; YYYY-MM-DD[T| ]HH:MM[:SS[.f{1,9}]] with Z or +HH:MM, or without zone
         as local time (TZ); a or b, optionally +DURATION or -DURATION (cursor anchor)
DURATION [+|-]<decimal><unit>, unit ns|us|µs|ms|s|min|h (e.g. +500ms, -1.5s)
SIGNAL   full ID (dataRef/name) or a unique bare name (V_ANZ)
REF      assignment ID (a3) or a SIGNAL shown in window W

Output: one JSON line on stdout. Exit codes: 0 ok, 1 rejected, 2 usage, 3 unreachable,
4 timeout, 5 render_error, 6 no_ui, 7 unavailable.

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
]);
const FLAG_OPTIONS = new Set(["--wait", "--pretty", "--help", "--values", "--copy"]);
const GLOBAL_OPTIONS = new Set(["--server", "--timeout", "--wait", "--pretty", "--help"]);

function usage(message: string): never {
  throw new CliError("usage", "usage", message);
}

/** Splits argv into options and positionals; `-<digit>` and `-.` tokens are values. */
function tokenize(argv: string[]): { opts: Map<string, string | true>; pos: string[] } {
  const opts = new Map<string, string | true>();
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (token === "--") {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith("-") || token === "-" || /^-[\d.]/.test(token)) {
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

function displayMode(text: string): DisplayMode {
  const mode = DisplayMode.safeParse(text);
  return mode.success ? mode.data : usage(`--mode must be line, step or markers, got "${text}"`);
}

function valuesMode(text: string): ValuesMode {
  const mode = ValuesMode.safeParse(text);
  return mode.success ? mode.data : usage(`--mode must be line or step, got "${text}"`);
}

function globalOptions(
  opts: Map<string, string | true>,
  env: Record<string, string | undefined>,
): GlobalOptions {
  const server = (opts.get("--server") as string | undefined) ?? env.KIPSCOPE_URL ?? DEFAULT_SERVER;
  // `localhost:7310` parses as a URL with protocol "localhost:", so the protocol is checked too.
  if (!URL.canParse(server) || !["http:", "https:"].includes(new URL(server).protocol)) {
    usage(`server address is not an http(s) URL: "${server}"`);
  }
  const timeout = (opts.get("--timeout") as string | undefined) ?? DEFAULT_TIMEOUT;
  const ns = duration(timeout, "--timeout");
  if (ns <= 0n) usage("--timeout must be greater than 0");
  return {
    server,
    wait: opts.has("--wait"),
    timeoutMs: Number(ns) / 1e6,
    pretty: opts.has("--pretty"),
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
  return { options, invocation: invocation(pos, opts) };
}

function invocation(pos: string[], opts: Map<string, string | true>): Invocation {
  const [first, second] = pos;
  if (first === undefined) usage("no command given (see --help)");
  const group = ["window", "signal", "cursor", "measurement"].includes(first);
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
