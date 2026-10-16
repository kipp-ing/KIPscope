import { groupOf, OTHER_GROUP, type SignalMatch } from "@kipscope/shared";

/** One line of the explorer list: a group header or a signal row (design G6). */
export type ExplorerItem =
  | { kind: "group"; name: string; count: number; open: boolean }
  | { kind: "signal"; match: SignalMatch };

/**
 * grouped false → one signal item per match, as today.
 * grouped true → per group a header, then its matches if open. Groups: on an empty query all
 * groups of the catalog, by name (`localeCompare(b, "en")`), Other last; while searching only
 * groups with a match, by the rank of their first match, Other last. Matches keep their rank order
 * inside a group. `toggled` holds group names the user flipped since the last query change:
 * open = searching ? !toggled.has(name) : toggled.has(name).
 */
export function explorerItems(
  matches: readonly SignalMatch[],
  searching: boolean,
  grouped: boolean,
  toggled: ReadonlySet<string>,
): ExplorerItem[] {
  if (!grouped) return matches.map((match) => ({ kind: "signal", match }));
  // One pass: Map keeps insertion order, i.e. the rank of each group's first match.
  const byGroup = new Map<string, SignalMatch[]>();
  for (const m of matches) {
    const name = groupOf(m.signal);
    const list = byGroup.get(name);
    if (list) list.push(m);
    else byGroup.set(name, [m]);
  }
  const names = [...byGroup.keys()].filter((n) => n !== OTHER_GROUP);
  if (!searching) names.sort((a, b) => a.localeCompare(b, "en"));
  if (byGroup.has(OTHER_GROUP)) names.push(OTHER_GROUP);

  const items: ExplorerItem[] = [];
  for (const name of names) {
    const list = byGroup.get(name) as SignalMatch[];
    const open = searching ? !toggled.has(name) : toggled.has(name);
    items.push({ kind: "group", name, count: list.length, open });
    if (open) for (const match of list) items.push({ kind: "signal", match });
  }
  return items;
}

/** Index of the first signal item, 0 when none. */
export function firstSignal(items: readonly ExplorerItem[]): number {
  const i = items.findIndex((it) => it.kind === "signal");
  return i < 0 ? 0 : i;
}
