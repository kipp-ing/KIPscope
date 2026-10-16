import type { GroupRule } from "./groups.ts";

/** Compiled template (design N3): literal text and placeholders of named groups. */
export type Template = readonly (string | { group: string })[];

/** One entry of `display.names` (design N2, N3), compiled by `project.ts`. */
export interface DisplayRule {
  /** Position in `display.names`, for messages. */
  index: number;
  match: RegExp;
  show: Template;
  collision?: Template;
}

/** Display-name rules of the project file (D-035). */
export interface DisplayRules {
  rules: readonly DisplayRule[];
  /** Full source name (without data reference) → shown name; beats every rule. */
  rename: ReadonlyMap<string, string>;
  /** Explorer group rules of `display.groups` (design G3), in file order. */
  groups: readonly GroupRule[];
}

/** No project file: every signal shows its full name and has no group. */
export const NO_RULES: DisplayRules = { rules: [], rename: new Map(), groups: [] };

/** Replaces each placeholder with its group's text, `""` for a group that did not take part. */
export function renderTemplate(
  t: Template,
  groups: Record<string, string | undefined> | undefined,
): string {
  return t.map((part) => (typeof part === "string" ? part : (groups?.[part.group] ?? ""))).join("");
}

export interface DisplayResult {
  /** Source name → shown name; every input name is a key (shown === name when unchanged). */
  shown: Map<string, string>;
  /** Source names that show their full name because of a collision left after N5 step 3, sorted. */
  fellBack: string[];
}

/** How a name was made (design N4); `rule` keeps its collision render for N5 step 3. */
type Assigned =
  | { kind: "rename" | "none"; shown: string }
  | { kind: "rule"; shown: string; collision: string };

/** Shown name of one source name (design N4): rename, first matching rule, full name. */
function assignOne(name: string, rules: DisplayRules): Assigned {
  const renamed = rules.rename.get(name);
  if (renamed !== undefined) return { kind: "rename", shown: renamed };
  for (const rule of rules.rules) {
    const m = rule.match.exec(name);
    if (!m) continue;
    const shown = renderTemplate(rule.show, m.groups);
    if (shown.trim() === "") return { kind: "none", shown: name };
    const collision = rule.collision ? renderTemplate(rule.collision, m.groups) : "";
    return { kind: "rule", shown, collision: collision.trim() === "" ? "" : collision };
  }
  return { kind: "none", shown: name };
}

/** Source names per shown name, only shown names held by two or more. */
function collisions(shown: ReadonlyMap<string, string>): string[][] {
  const groups = new Map<string, string[]>();
  for (const [name, s] of shown) {
    const group = groups.get(s);
    if (group) group.push(name);
    else groups.set(s, [name]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** Pure; `names` are distinct source names (without data reference), any order. */
export function assignDisplayNames(names: readonly string[], rules: DisplayRules): DisplayResult {
  const assigned = new Map(names.map((n) => [n, assignOne(n, rules)]));
  const shown = new Map([...assigned].map(([n, a]) => [n, a.shown]));
  // N5 step 3: rule-made members of a shared name take their collision render.
  for (const group of collisions(shown)) {
    for (const name of group) {
      const a = assigned.get(name);
      if (a?.kind === "rule" && a.collision !== "") shown.set(name, a.collision);
    }
  }
  // N5 step 4: members of a still-shared name fall back to their full name until none is shared.
  const fellBack = new Set<string>();
  for (let groups = collisions(shown); groups.length > 0; groups = collisions(shown)) {
    for (const name of groups.flat()) {
      if (shown.get(name) === name) continue;
      shown.set(name, name);
      fellBack.add(name);
    }
  }
  return { shown, fellBack: [...fellBack].sort() };
}
