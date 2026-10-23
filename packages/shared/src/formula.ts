/**
 * The formula language of computed signals (add-computed-signals C1): `a`, `b`, numbers,
 * `+ - * /`, parentheses, `abs(x)`, `min(x, y)`, `max(x, y)`. Parsed here and nowhere else; the
 * server compiles the AST, never the text (D-102). Pure; imports nothing, so computed.ts and
 * workspace.ts can use it without a cycle.
 */

export const MAX_FORMULA_LENGTH = 200;
export const MAX_FORMULA_NODES = 64;
/** MAX_COMPUTED_NAME of computed.ts, repeated so this file imports nothing. */
const NAME_LIMIT = 60;

export type FormulaVar = "a" | "b";
export type FormulaNode =
  | { op: "num"; value: number }
  | { op: "var"; name: FormulaVar }
  | { op: "neg" | "abs"; arg: FormulaNode }
  | { op: "+" | "-" | "*" | "/" | "min" | "max"; left: FormulaNode; right: FormulaNode };
export type ParsedFormula =
  | { ok: true; ast: FormulaNode; vars: ReadonlySet<FormulaVar> }
  | { ok: false; message: string; at?: number };

type Token =
  | { kind: "num"; text: string; value: number; at: number }
  | { kind: "name"; text: string; at: number }
  | { kind: "sym"; text: "+" | "-" | "*" | "/" | "(" | ")" | ","; at: number }
  | { kind: "end"; text: ""; at: number }
  /** A bad character, name or number; its error is thrown when the parser reaches it. */
  | { kind: "bad"; error: FormulaError };

const NAMES = new Set(["a", "b", "abs", "min", "max"]);
const SYMBOLS = new Set(["+", "-", "*", "/", "(", ")", ","]);
const NUMBER = /(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;

/** Thrown inside the parser only; parseFormula turns it into a result. */
class FormulaError extends Error {
  readonly at: number | undefined;
  constructor(message: string, at?: number) {
    super(message);
    this.at = at;
  }
}

const unknownName = (text: string, at: number) =>
  new FormulaError(`Unknown name "${text}": use a, b, numbers, + - * / ( ), abs, min, max`, at);

/**
 * Tokens with 1-based positions; U+2212 reads as "-". Stops at the first bad token, so an earlier
 * syntax error is reported first (`a + 1); …` → `Unexpected ")" at 6`).
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
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const at = i + 1;
    NUMBER.lastIndex = i;
    const number = NUMBER.exec(text);
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) throw new FormulaError(`Number too large at ${at}`, at);
      tokens.push({ kind: "num", text: number[0], value, at });
      i += number[0].length;
      continue;
    }
    NAME.lastIndex = i;
    const name = NAME.exec(text);
    if (name) {
      if (!NAMES.has(name[0])) throw unknownName(name[0], at);
      tokens.push({ kind: "name", text: name[0], at });
      i += name[0].length;
      continue;
    }
    const sym = c === "−" ? "-" : c;
    if (!SYMBOLS.has(sym)) throw new FormulaError(`Unexpected "${c}" at ${at}`, at);
    tokens.push({ kind: "sym", text: sym as "+", at });
    i++;
  }
  tokens.push({ kind: "end", text: "", at: text.length + 1 });
}

/** Recursive descent over the C1 grammar. */
function parseTokens(tokens: Token[]): { ast: FormulaNode; vars: Set<FormulaVar> } {
  let pos = 0;
  let nodes = 0;
  const vars = new Set<FormulaVar>();
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
    if (t.kind === "sym" && t.text === "(") {
      const inner = sum();
      closing();
      return inner;
    }
    if (t.kind !== "name") throw unexpected(t);
    if (t.text === "a" || t.text === "b") {
      vars.add(t.text);
      return node({ op: "var", name: t.text });
    }
    const open = next();
    if (!isSym(open, "(")) throw unexpected(open);
    const first = sum();
    if (t.text === "abs") {
      if (isSym(peek(), ",")) throw new FormulaError("abs takes one value: abs(x)", peek().at);
      closing();
      return node({ op: "abs", arg: first });
    }
    const arity = new FormulaError(`${t.text} takes two values: ${t.text}(x, y)`, peek().at);
    if (isSym(peek(), ")")) throw arity;
    const comma = next();
    if (!isSym(comma, ",")) throw unexpected(comma);
    const second = sum();
    if (isSym(peek(), ",")) throw arity;
    closing();
    return node({ op: t.text as "min" | "max", left: first, right: second });
  };

  const ast = sum();
  const end = peek();
  if (end.kind !== "end") throw unexpected(end);
  if (nodes > MAX_FORMULA_NODES)
    throw new FormulaError(`Too complex: at most ${MAX_FORMULA_NODES} parts`);
  return { ast, vars };
}

/** C1: the AST and the names used, or the first error with its 1-based position. */
export function parseFormula(text: string): ParsedFormula {
  if (text.trim() === "") return { ok: false, message: "Enter a formula" };
  if (text.length > MAX_FORMULA_LENGTH)
    return { ok: false, message: `At most ${MAX_FORMULA_LENGTH} characters` };
  try {
    const { ast, vars } = parseTokens(tokenize(text));
    if (!vars.has("a")) return { ok: false, message: "The formula must use a" };
    return { ok: true, ast, vars };
  } catch (error) {
    if (!(error instanceof FormulaError)) throw error;
    return {
      ok: false,
      message: error.message,
      ...(error.at !== undefined && { at: error.at }),
    };
  }
}

/** C1 binding: errors "Pick a signal for a|b"; drops b when unused. */
export function bindFormula(
  parsed: ParsedFormula,
  inputs: { a?: string; b?: string },
): { ok: true; ast: FormulaNode; a: string; b?: string } | { ok: false; message: string } {
  if (!parsed.ok) return { ok: false, message: parsed.message };
  if (!inputs.a) return { ok: false, message: "Pick a signal for a" };
  if (!parsed.vars.has("b")) return { ok: true, ast: parsed.ast, a: inputs.a };
  if (!inputs.b) return { ok: false, message: "Pick a signal for b" };
  return { ok: true, ast: parsed.ast, a: inputs.a, b: inputs.b };
}

/** IEEE double; may be non-finite (callers map that to null, C2). b ignored when unused. */
export function evalFormula(ast: FormulaNode, a: number, b?: number): number {
  const ev = (n: FormulaNode): number => {
    switch (n.op) {
      case "num":
        return n.value;
      case "var":
        return n.name === "a" ? a : (b ?? Number.NaN);
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
        return Math.min(ev(n.left), ev(n.right));
      case "max":
        return Math.max(ev(n.left), ev(n.right));
    }
  };
  return ev(ast);
}

/** Binding strength for parentheses: sums 1, products 2, unary minus 3, the rest 4. */
const precedence = (n: FormulaNode) =>
  n.op === "+" || n.op === "-" ? 1 : n.op === "*" || n.op === "/" ? 2 : n.op === "neg" ? 3 : 4;
const SHOWN_OP = { "+": " + ", "-": " − ", "*": " × ", "/": " / " } as const;

/**
 * The formula written out with the given input names, as formulaName but never cut: operators
 * ` + `, ` − `, ` × `, ` / `, parentheses only where needed. computedInfos' description (C11).
 */
export function formulaText(ast: FormulaNode, aName: string, bName?: string): string {
  const wrap = (n: FormulaNode, needed: boolean) => (needed ? `(${write(n)})` : write(n));
  const write = (n: FormulaNode): string => {
    switch (n.op) {
      case "num":
        return String(n.value);
      case "var":
        return n.name === "a" ? aName : (bName ?? "b");
      case "neg":
        return `−${wrap(n.arg, precedence(n.arg) < 3)}`;
      case "abs":
        return `abs(${write(n.arg)})`;
      case "min":
      case "max":
        return `${n.op}(${write(n.left)}, ${write(n.right)})`;
      default: {
        const p = precedence(n);
        const right = precedence(n.right);
        const tight = n.op === "-" || n.op === "/";
        return `${wrap(n.left, precedence(n.left) < p)}${SHOWN_OP[n.op]}${wrap(n.right, right < p || (tight && right === p))}`;
      }
    }
  };
  return write(ast);
}

/** C12 auto name; `aName`/`bName` already shortened; cut to MAX_COMPUTED_NAME with "…". */
export function formulaName(ast: FormulaNode, aName: string, bName?: string): string {
  const text = formulaText(ast, aName, bName);
  return text.length > NAME_LIMIT ? `${text.slice(0, NAME_LIMIT - 1)}…` : text;
}

/** C12 auto unit (lead pick 1); undefined = none. */
export function inferUnit(ast: FormulaNode, aUnit?: string, bUnit?: string): string | undefined {
  // "const": a number, which adopts the other side's unit; else the unit, undefined = none.
  type U = "const" | { unit: string | undefined };
  const none: U = { unit: undefined };
  const of = (unit: string | undefined): U => ({ unit: unit?.trim() || undefined });
  const infer = (n: FormulaNode): U => {
    switch (n.op) {
      case "num":
        return "const";
      case "var":
        return of(n.name === "a" ? aUnit : bUnit);
      case "neg":
      case "abs":
        return infer(n.arg);
      case "*":
      case "/": {
        const l = infer(n.left);
        const r = infer(n.right);
        return l === "const" && r === "const" ? "const" : none;
      }
      default: {
        const l = infer(n.left);
        const r = infer(n.right);
        if (l === "const") return r;
        if (r === "const") return l;
        return l.unit === r.unit ? l : none;
      }
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

export type PresetId =
  | "difference"
  | "sum"
  | "absolute"
  | "minimum"
  | "maximum"
  | "scale"
  | "custom";
/** The editor's preset select (C12), in its order. */
export const PRESETS: readonly { id: PresetId; label: string; formula?: string; inputs: 1 | 2 }[] =
  [
    { id: "difference", label: "Difference", formula: "a - b", inputs: 2 },
    { id: "sum", label: "Sum", formula: "a + b", inputs: 2 },
    { id: "absolute", label: "Absolute", formula: "abs(a)", inputs: 1 },
    { id: "minimum", label: "Minimum", formula: "min(a, b)", inputs: 2 },
    { id: "maximum", label: "Maximum", formula: "max(a, b)", inputs: 2 },
    { id: "scale", label: "Scale", formula: "a * 1", inputs: 1 },
    { id: "custom", label: "Custom", inputs: 2 },
  ];

const compact = (s: string) => s.replace(/\s+/g, "");

/** The preset whose formula equals `text` ignoring whitespace, else "custom". */
export function presetOf(text: string): PresetId {
  const t = compact(text);
  return PRESETS.find((p) => p.formula !== undefined && compact(p.formula) === t)?.id ?? "custom";
}
