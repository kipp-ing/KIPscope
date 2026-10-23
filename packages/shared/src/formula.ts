/**
 * The formula language of computed signals (improve-formula-editor F1): signal names (bare or in
 * double quotes), numbers, `+ - * /`, parentheses, `abs(x)`, `min(x, y, …)`, `max(x, y, …)`.
 * Parsed here and nowhere else; the server compiles the AST, never the text (D-102). Pure; imports
 * nothing, so computed.ts and workspace.ts can use it without a cycle.
 */

export const MAX_FORMULA_LENGTH = 500;
export const MAX_FORMULA_NODES = 64;
/** Distinct source signals of a formula, nested ones resolved (D-106). */
export const MAX_FORMULA_SIGNALS = 8;
/** Limits of a flattened formula (F4) and of the server's `formula` parameter (F8). */
export const MAX_FLAT_LENGTH = 2_000;
export const MAX_FLAT_NODES = 256;
export const FORMULA_FUNCTIONS = ["abs", "min", "max"] as const;
/** MAX_COMPUTED_NAME of computed.ts, repeated so this file imports nothing. */
const NAME_LIMIT = 60;

type FormulaFunction = (typeof FORMULA_FUNCTIONS)[number];
export type FormulaNode =
  | { op: "num"; value: number }
  /** `at`: 1-based position of the name token (a quoted name: its opening quote). */
  | { op: "sig"; name: string; at: number }
  | { op: "neg" | "abs"; arg: FormulaNode }
  | { op: "+" | "-" | "*" | "/"; left: FormulaNode; right: FormulaNode }
  /** Two or more arguments (D-107 Q-2). */
  | { op: "min" | "max"; args: FormulaNode[] };
export type ParsedFormula =
  /** `names` = formulaInputs(ast). */
  | { ok: true; ast: FormulaNode; names: readonly string[] }
  | { ok: false; message: string; at?: number };
/** Default {500, 64}; the server parses flattened formulas with {2000, 256}. */
export interface FormulaLimits {
  length: number;
  nodes: number;
}
const DEFAULT_LIMITS: FormulaLimits = { length: MAX_FORMULA_LENGTH, nodes: MAX_FORMULA_NODES };

/** 0-based, end exclusive; the tokens of a text cover it without gaps. */
export type FormulaToken = { start: number; end: number } & (
  | { kind: "name"; name: string; quoted: boolean; closed: boolean }
  | { kind: "func"; name: FormulaFunction }
  | { kind: "num" | "op" | "open" | "close" | "comma" | "space" | "bad" }
);

const FUNCTIONS: ReadonlySet<string> = new Set(FORMULA_FUNCTIONS);
const NUMBER = /(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const BARE = /[A-Za-z_][A-Za-z0-9_.]*/y;
const BARE_NAME = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const SPACE = /\s+/y;
const OPS = new Set(["+", "-", "*", "/", "−"]);

/** A quoted name from its opening quote at `i`: the unescaped name, its end, where it went wrong. */
function scanQuoted(
  text: string,
  i: number,
): { name: string; end: number; closed: boolean; badEscape?: number } {
  let name = "";
  let badEscape: number | undefined;
  let j = i + 1;
  while (j < text.length) {
    const c = text[j] as string;
    if (c === '"')
      return { name, end: j + 1, closed: true, ...(badEscape !== undefined && { badEscape }) };
    if (c === "\\") {
      const e = text[j + 1];
      if (e === '"' || e === "\\") {
        name += e;
        j += 2;
        continue;
      }
      badEscape ??= j;
    }
    name += c;
    j++;
  }
  return { name, end: j, closed: false, ...(badEscape !== undefined && { badEscape }) };
}

/** The character (code point) at `i`. */
const charAt = (text: string, i: number) => String.fromCodePoint(text.codePointAt(i) as number);

const match = (re: RegExp, text: string, i: number) => {
  re.lastIndex = i;
  return re.exec(text)?.[0];
};

/** Tokens for the editor's tint and completion (F11); never throws, covers the text. */
export function tokenizeFormula(text: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let i = 0;
  while (i < text.length) {
    const start = i;
    const c = text[i] as string;
    const space = match(SPACE, text, i);
    const number = space ? undefined : match(NUMBER, text, i);
    const bare = space || number ? undefined : match(BARE, text, i);
    if (space) {
      i += space.length;
      tokens.push({ kind: "space", start, end: i });
    } else if (number) {
      i += number.length;
      tokens.push({ kind: "num", start, end: i });
    } else if (bare) {
      i += bare.length;
      tokens.push(
        FUNCTIONS.has(bare)
          ? { kind: "func", name: bare as FormulaFunction, start, end: i }
          : { kind: "name", name: bare, quoted: false, closed: true, start, end: i },
      );
    } else if (c === '"') {
      const q = scanQuoted(text, i);
      i = q.end;
      tokens.push({ kind: "name", name: q.name, quoted: true, closed: q.closed, start, end: i });
    } else {
      const kind = OPS.has(c)
        ? "op"
        : c === "("
          ? "open"
          : c === ")"
            ? "close"
            : c === ","
              ? "comma"
              : "bad";
      i += kind === "bad" ? charAt(text, i).length : 1;
      tokens.push({ kind, start, end: i });
    }
  }
  return tokens;
}

type Token =
  | { kind: "num"; text: string; value: number; at: number }
  | { kind: "name"; text: string; name: string; at: number }
  | { kind: "func"; text: FormulaFunction; at: number }
  | { kind: "sym"; text: "+" | "-" | "*" | "/" | "(" | ")" | ","; at: number }
  | { kind: "end"; text: ""; at: number }
  /** A bad character, name or number; its error is thrown when the parser reaches it. */
  | { kind: "bad"; error: FormulaError };

/** Thrown inside the parser only; parseFormula turns it into a result. */
class FormulaError extends Error {
  readonly at: number | undefined;
  constructor(message: string, at?: number) {
    super(message);
    this.at = at;
  }
}

/**
 * Tokens with 1-based positions; U+2212 reads as "-" outside quotes. Stops at the first bad token,
 * so an earlier syntax error is reported first (`X.A + 1); …` → `Unexpected ")" at 8`).
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  try {
    scan(text, tokens);
  } catch (error) {
    if (!(error instanceof FormulaError)) throw error;
    tokens.push({ kind: "bad", error });
  }
  return tokens;
}

function scan(text: string, tokens: Token[]): void {
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    const space = match(SPACE, text, i);
    if (space) {
      i += space.length;
      continue;
    }
    const at = i + 1;
    const number = match(NUMBER, text, i);
    if (number) {
      const value = Number(number);
      if (!Number.isFinite(value)) throw new FormulaError(`Number too large at ${at}`, at);
      tokens.push({ kind: "num", text: number, value, at });
      i += number.length;
      continue;
    }
    const bare = match(BARE, text, i);
    if (bare) {
      tokens.push(
        FUNCTIONS.has(bare)
          ? { kind: "func", text: bare as FormulaFunction, at }
          : { kind: "name", text: bare, name: bare, at },
      );
      i += bare.length;
      continue;
    }
    if (c === '"') {
      const q = scanQuoted(text, i);
      if (!q.closed) throw new FormulaError(`Missing closing " at ${at}`, at);
      if (q.badEscape !== undefined)
        throw new FormulaError(`Unexpected "\\" at ${q.badEscape + 1}`, q.badEscape + 1);
      if (q.name === "") throw new FormulaError(`Empty name at ${at}`, at);
      tokens.push({ kind: "name", text: text.slice(i, q.end), name: q.name, at });
      i = q.end;
      continue;
    }
    const sym = c === "−" ? "-" : c;
    if (!OPS.has(sym) && sym !== "(" && sym !== ")" && sym !== ",")
      throw new FormulaError(`Unexpected "${charAt(text, i)}" at ${at}`, at);
    tokens.push({ kind: "sym", text: sym as "+", at });
    i++;
  }
  tokens.push({ kind: "end", text: "", at: text.length + 1 });
}

/** Recursive descent over the F1 grammar. */
function parseTokens(tokens: Token[], maxNodes: number): FormulaNode {
  let pos = 0;
  let nodes = 0;
  type Good = Exclude<Token, { kind: "bad" }>;
  const peek = (): Good => {
    const t = tokens[pos] as Token;
    if (t.kind === "bad") throw t.error;
    return t;
  };
  const next = () => {
    const t = peek();
    pos++;
    return t;
  };
  const node = <N extends FormulaNode>(n: N): N => {
    nodes++;
    return n;
  };
  const unexpected = (t: Good) =>
    t.kind === "end"
      ? new FormulaError(`Unexpected end at ${t.at}`, t.at)
      : new FormulaError(`Unexpected "${t.text}" at ${t.at}`, t.at);
  const isSym = (t: Good, s: string) => t.kind === "sym" && t.text === s;
  const closing = () => {
    const t = next();
    if (!isSym(t, ")")) throw new FormulaError(`Missing ")" at ${t.at}`, t.at);
  };

  const sum = (): FormulaNode => {
    let left = product();
    for (let t = peek(); isSym(t, "+") || isSym(t, "-"); t = peek()) {
      next();
      left = node({ op: t.text as "+" | "-", left, right: product() });
    }
    return left;
  };
  const product = (): FormulaNode => {
    let left = unary();
    for (let t = peek(); isSym(t, "*") || isSym(t, "/"); t = peek()) {
      next();
      left = node({ op: t.text as "*" | "/", left, right: unary() });
    }
    return left;
  };
  const unary = (): FormulaNode => {
    if (isSym(peek(), "-")) {
      next();
      return node({ op: "neg", arg: unary() });
    }
    return primary();
  };
  const primary = (): FormulaNode => {
    const t = next();
    if (t.kind === "num") return node({ op: "num", value: t.value });
    if (t.kind === "name") return node({ op: "sig", name: t.name, at: t.at });
    if (isSym(t, "(")) {
      const inner = sum();
      closing();
      return inner;
    }
    if (t.kind !== "func") throw unexpected(t);
    const open = next();
    if (!isSym(open, "(")) throw unexpected(open);
    const args = [sum()];
    if (t.text === "abs") {
      if (isSym(peek(), ",")) throw new FormulaError("abs takes one value: abs(x)", peek().at);
      closing();
      return node({ op: "abs", arg: args[0] as FormulaNode });
    }
    if (isSym(peek(), ")"))
      throw new FormulaError(`${t.text} takes two or more values: ${t.text}(x, y, …)`, peek().at);
    while (isSym(peek(), ",")) {
      next();
      args.push(sum());
    }
    closing();
    return node({ op: t.text, args });
  };

  const ast = sum();
  const end = peek();
  if (end.kind !== "end") throw unexpected(end);
  if (nodes > maxNodes) throw new FormulaError(`Too complex: at most ${maxNodes} parts`);
  return ast;
}

/** F1: the AST and its names, or the first error with its 1-based position. */
export function parseFormula(text: string, limits: FormulaLimits = DEFAULT_LIMITS): ParsedFormula {
  if (text.trim() === "") return { ok: false, message: "Enter a formula" };
  if (text.length > limits.length)
    return { ok: false, message: `At most ${limits.length.toLocaleString("en-US")} characters` };
  try {
    const ast = parseTokens(tokenize(text), limits.nodes);
    const names = formulaInputs(ast);
    if (names.length === 0) return { ok: false, message: "Use at least one signal" };
    return { ok: true, ast, names };
  } catch (error) {
    if (!(error instanceof FormulaError)) throw error;
    return {
      ok: false,
      message: error.message,
      ...(error.at !== undefined && { at: error.at }),
    };
  }
}

/** F1: bare when an identifier other than abs, min, max; else quoted with `\` and `"` escaped. */
export function quoteName(name: string): string {
  if (BARE_NAME.test(name) && !FUNCTIONS.has(name)) return name;
  return `"${name.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

/** Binding strength for parentheses: sums 1, products 2, unary minus 3, the rest 4. */
const precedence = (n: FormulaNode) =>
  n.op === "+" || n.op === "-" ? 1 : n.op === "*" || n.op === "/" ? 2 : n.op === "neg" ? 3 : 4;

/**
 * The printer behind formulaText and formulaName: parentheses only where needed (left-associative
 * operators); `operand(n)` says whether a name node must be wrapped as an operand.
 */
function print(
  ast: FormulaNode,
  name: (n: string) => string,
  ops: Record<"+" | "-" | "*" | "/", string>,
  operand: (text: string) => boolean,
): string {
  const wrap = (n: FormulaNode, needed: boolean) => {
    const text = write(n);
    return needed || (n.op === "sig" && operand(text)) ? `(${text})` : text;
  };
  const write = (n: FormulaNode): string => {
    switch (n.op) {
      case "num":
        return String(n.value);
      case "sig":
        return name(n.name);
      case "neg":
        return `-${wrap(n.arg, precedence(n.arg) < 3)}`;
      case "abs":
        return `abs(${write(n.arg)})`;
      case "min":
      case "max":
        return `${n.op}(${n.args.map(write).join(", ")})`;
      default: {
        const p = precedence(n);
        const right = precedence(n.right);
        const tight = n.op === "-" || n.op === "/";
        return `${wrap(n.left, precedence(n.left) < p)}${ops[n.op]}${wrap(n.right, right < p || (tight && right === p))}`;
      }
    }
  };
  return write(ast);
}

const TEXT_OPS = { "+": " + ", "-": " - ", "*": " * ", "/": " / " } as const;
const SHOWN_OPS = { "+": " + ", "-": " − ", "*": " × ", "/": " / " } as const;

/** F1 canonical print: names by quoteName, ` + `, ` - `, ` * `, ` / `, parentheses where needed. */
export function formulaText(ast: FormulaNode): string {
  return print(ast, quoteName, TEXT_OPS, () => false);
}

/** The distinct names in first appearance (depth first, left to right). */
export function formulaInputs(ast: FormulaNode): string[] {
  const names = new Set<string>();
  const walk = (n: FormulaNode): void => {
    switch (n.op) {
      case "num":
        return;
      case "sig":
        names.add(n.name);
        return;
      case "neg":
      case "abs":
        walk(n.arg);
        return;
      case "min":
      case "max":
        for (const a of n.args) walk(a);
        return;
      default:
        walk(n.left);
        walk(n.right);
    }
  };
  walk(ast);
  return [...names];
}

/** IEEE double; may be non-finite (callers map that to null, C2). */
export function evalFormula(ast: FormulaNode, value: (name: string) => number): number {
  const ev = (n: FormulaNode): number => {
    switch (n.op) {
      case "num":
        return n.value;
      case "sig":
        return value(n.name);
      case "neg":
        return -ev(n.arg);
      case "abs":
        return Math.abs(ev(n.arg));
      case "+":
        return ev(n.left) + ev(n.right);
      case "-":
        return ev(n.left) - ev(n.right);
      case "*":
        return ev(n.left) * ev(n.right);
      case "/":
        return ev(n.left) / ev(n.right);
      case "min":
        return Math.min(...n.args.map(ev));
      case "max":
        return Math.max(...n.args.map(ev));
    }
  };
  return ev(ast);
}

/** For hot loops: values in formulaInputs(ast) order. */
export function compileFormula(ast: FormulaNode): (values: readonly number[]) => number {
  const index = new Map(formulaInputs(ast).map((name, i) => [name, i]));
  type Fn = (v: readonly number[]) => number;
  const compile = (n: FormulaNode): Fn => {
    switch (n.op) {
      case "num": {
        const value = n.value;
        return () => value;
      }
      case "sig": {
        const i = index.get(n.name) as number;
        return (v) => v[i] as number;
      }
      case "neg": {
        const arg = compile(n.arg);
        return (v) => -arg(v);
      }
      case "abs": {
        const arg = compile(n.arg);
        return (v) => Math.abs(arg(v));
      }
      case "min":
      case "max": {
        const args = n.args.map(compile);
        const pick = n.op === "min" ? Math.min : Math.max;
        return (v) => {
          let r = (args[0] as Fn)(v);
          for (let i = 1; i < args.length; i++) r = pick(r, (args[i] as Fn)(v));
          return r;
        };
      }
      default: {
        const l = compile(n.left);
        const r = compile(n.right);
        switch (n.op) {
          case "+":
            return (v) => l(v) + r(v);
          case "-":
            return (v) => l(v) - r(v);
          case "*":
            return (v) => l(v) * r(v);
          case "/":
            return (v) => l(v) / r(v);
        }
      }
    }
  };
  return compile(ast);
}

export interface FormulaNames {
  /** The list in use, full names. */
  signals: readonly { name: string; unit?: string; states: boolean }[];
  /** The workspace's definitions. */
  computed: readonly { name: string; unit?: string }[];
}
export type NameResolution =
  /** `name`: the canonical name. */
  | { ok: true; kind: "signal" | "computed"; name: string }
  | { ok: false; reason: "unknown" | "ambiguous" | "states"; candidates?: string[] };

/**
 * F2 typed name: a definition ignoring case; else a listed signal by exact full name; else the
 * listed signals whose full or short name equals the text ignoring case (one, or ambiguous).
 */
export function resolveName(text: string, names: FormulaNames): NameResolution {
  const lower = text.toLowerCase();
  const def = names.computed.find((d) => d.name.toLowerCase() === lower);
  if (def) return { ok: true, kind: "computed", name: def.name };
  const found = (s: { name: string; states: boolean }): NameResolution =>
    s.states
      ? { ok: false, reason: "states", candidates: [s.name] }
      : { ok: true, kind: "signal", name: s.name };
  const exact = names.signals.find((s) => s.name === text);
  if (exact) return found(exact);
  const matches = new Map<string, { name: string; states: boolean }>();
  for (const s of names.signals) {
    if (matches.has(s.name)) continue;
    if (s.name.toLowerCase() === lower || shortSignalName(s.name).toLowerCase() === lower)
      matches.set(s.name, s);
  }
  if (matches.size === 0) return { ok: false, reason: "unknown" };
  if (matches.size === 1)
    return found([...matches.values()][0] as { name: string; states: boolean });
  return { ok: false, reason: "ambiguous", candidates: [...matches.keys()].sort() };
}

export type ResolvedFormula =
  /** Canonical text; the AST's names are canonical (positions those of the typed text). */
  | { ok: true; formula: string; ast: FormulaNode }
  | {
      ok: false;
      message: string;
      at?: number;
      code: "invalid_formula" | "unknown_signal" | "ambiguous_signal" | "not_numeric_signal";
      candidates?: string[];
    };

/** Every name node of the AST rewritten by `rename`. */
function mapNames(
  ast: FormulaNode,
  rename: (n: { name: string; at: number }) => string,
): FormulaNode {
  const walk = (n: FormulaNode): FormulaNode => {
    switch (n.op) {
      case "num":
        return n;
      case "sig":
        return { ...n, name: rename(n) };
      case "neg":
      case "abs":
        return { ...n, arg: walk(n.arg) };
      case "min":
      case "max":
        return { ...n, args: n.args.map(walk) };
      default:
        return { ...n, left: walk(n.left), right: walk(n.right) };
    }
  };
  return walk(ast);
}

/**
 * F5 rename: the formula with every name `from` written `to`, canonical; unchanged when it does
 * not parse or does not use `from`. The one rename rule of the editor's check and the commands.
 */
export function renameInFormula(formula: string, from: string, to: string): string {
  const parsed = parseFormula(formula);
  if (!parsed.ok || !parsed.names.includes(from)) return formula;
  return formulaText(mapNames(parsed.ast, ({ name }) => (name === from ? to : name)));
}

/** F2: the typed text parsed, every name resolved; the first error in text order. */
export function resolveFormula(text: string, names: FormulaNames): ResolvedFormula {
  const parsed = parseFormula(text);
  if (!parsed.ok) return { ...parsed, code: "invalid_formula" };
  let error: Extract<ResolvedFormula, { ok: false }> | undefined;
  const ast = mapNames(parsed.ast, ({ name, at }) => {
    if (error) return name;
    const r = resolveName(name, names);
    if (r.ok) return r.name;
    if (r.reason === "unknown")
      error = {
        ok: false,
        code: "unknown_signal",
        message: `Unknown signal "${name}" at ${at}`,
        at,
      };
    else if (r.reason === "states")
      error = {
        ok: false,
        code: "not_numeric_signal",
        message: `${r.candidates?.[0] ?? name} has states at ${at}: use a numeric signal`,
        at,
      };
    else {
      const candidates = r.candidates ?? [];
      const shown = candidates.slice(0, 5).join(", ") + (candidates.length > 5 ? ", …" : "");
      error = {
        ok: false,
        code: "ambiguous_signal",
        message: `Ambiguous "${name}" at ${at}: ${shown}`,
        at,
        candidates,
      };
    }
    return name;
  });
  return error ?? { ok: true, formula: formulaText(ast), ast };
}

/**
 * F7 auto name: `label(name)` per name; ` + `, ` − `, ` × `, ` / `; a label with a space wrapped as
 * an operand of an operator or unary minus, not as a function argument; cut to 60 with "…".
 */
export function formulaName(ast: FormulaNode, label: (name: string) => string): string {
  const text = print(ast, label, SHOWN_OPS, (t) => /\s/.test(t));
  return text.length > NAME_LIMIT ? `${text.slice(0, NAME_LIMIT - 1)}…` : text;
}

/** F7 auto unit (D-105 Q-6); undefined = none. */
export function inferUnit(
  ast: FormulaNode,
  unitOf: (name: string) => string | undefined,
): string | undefined {
  // "const": only numbers, which adopt the other operands' unit; else the unit, undefined = none.
  type U = "const" | { unit: string | undefined };
  const none: U = { unit: undefined };
  const same = (us: U[]): U => {
    let out: U = "const";
    for (const u of us) {
      if (u === "const") continue;
      if (out === "const") out = u;
      else if (out.unit !== u.unit) return none;
    }
    return out;
  };
  const infer = (n: FormulaNode): U => {
    switch (n.op) {
      case "num":
        return "const";
      case "sig":
        return { unit: unitOf(n.name)?.trim() || undefined };
      case "neg":
      case "abs":
        return infer(n.arg);
      case "*":
      case "/": {
        const l = infer(n.left);
        const r = infer(n.right);
        return l === "const" && r === "const" ? "const" : none;
      }
      case "min":
      case "max":
        return same(n.args.map(infer));
      default:
        return same([infer(n.left), infer(n.right)]);
    }
  };
  const u = infer(ast);
  return u === "const" ? undefined : u.unit;
}

/** Shown name after its first "." ("MS_312h.DNMOT" → "DNMOT"); whole when none or empty after. */
export function shortSignalName(shown: string): string {
  const dot = shown.indexOf(".");
  const short = dot < 0 ? "" : shown.slice(dot + 1);
  return short || shown;
}
