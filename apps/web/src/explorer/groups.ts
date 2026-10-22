import { groupOf, OTHER_GROUP, type SignalMatch } from "@kipscope/shared";

/** Name and toggle key of the user's Favourites group (add-favourites F5). */
export const FAVOURITES_GROUP = "★ Favourites";

/**
 * One line of the explorer list: a group header or a signal row (design G6). `favourites` marks
 * the Favourites header, `inFavourites` a favourite's copy under it (add-favourites F5).
 */
export type ExplorerItem =
  | { kind: "group"; name: string; count: number; open: boolean; favourites?: true }
  | { kind: "signal"; match: SignalMatch; inFavourites?: true };

/**
 * grouped false → one signal item per match, as today.
 * grouped true → per group a header, then its matches if open. Groups: on an empty query all
 * groups of the catalog, by name (`localeCompare(b, "en")`), Other last; while searching only
 * groups with a match, by the rank of their first match, Other last. Matches keep their rank order
 * inside a group. `toggled` holds group names the user flipped since the last query change:
 * open = searching ? !toggled.has(name) : toggled.has(name).
 * favourites (signal names, add-favourites F5): when a match's `signal.name` is one, the header
 * `★ Favourites` comes first (open unless toggled, also on an empty query), then a copy of each
 * favourite match (searching: rank order; else the order of `favourites`, data refs in catalog
 * order), then the items above unchanged.
 */
export function explorerItems(
  matches: readonly SignalMatch[],
  searching: boolean,
  grouped: boolean,
  toggled: ReadonlySet<string>,
  favourites: readonly string[] = [],
): ExplorerItem[] {
  const items = [...favouriteItems(matches, searching, toggled, favourites)];
  if (!grouped) {
    for (const match of matches) items.push({ kind: "signal", match });
    return items;
  }
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

  for (const name of names) {
    const list = byGroup.get(name) as SignalMatch[];
    const open = searching ? !toggled.has(name) : toggled.has(name);
    items.push({ kind: "group", name, count: list.length, open });
    if (open) for (const match of list) items.push({ kind: "signal", match });
  }
  return items;
}

/** The Favourites header and its copies (F5); none when no match is a favourite. */
function favouriteItems(
  matches: readonly SignalMatch[],
  searching: boolean,
  toggled: ReadonlySet<string>,
  favourites: readonly string[],
): ExplorerItem[] {
  if (favourites.length === 0) return [];
  // One Set lookup per match; per name its matches in the given (rank or catalog) order.
  const wanted = new Set(favourites);
  const byName = new Map<string, SignalMatch[]>();
  let count = 0;
  for (const m of matches) {
    const name = m.signal.name;
    if (!wanted.has(name)) continue;
    count++;
    const list = byName.get(name);
    if (list) list.push(m);
    else byName.set(name, [m]);
  }
  if (count === 0) return [];
  const open = !toggled.has(FAVOURITES_GROUP);
  const items: ExplorerItem[] = [
    { kind: "group", name: FAVOURITES_GROUP, count, open, favourites: true },
  ];
  if (!open) return items;
  if (searching) {
    for (const match of matches)
      if (wanted.has(match.signal.name)) items.push({ kind: "signal", match, inFavourites: true });
  } else {
    // A name listed twice by hand counts once (its first place).
    for (const name of wanted)
      for (const match of byName.get(name) ?? [])
        items.push({ kind: "signal", match, inFavourites: true });
  }
  return items;
}

/**
 * Active item after a query change (add-favourites F6): the first signal item with signal ID
 * `best` (the best-ranked match, its Favourites copy when it has one), else the first signal
 * item, else 0.
 */
export function firstSignal(items: readonly ExplorerItem[], best?: string): number {
  if (best !== undefined) {
    const b = items.findIndex((it) => it.kind === "signal" && it.match.signal.id === best);
    if (b >= 0) return b;
  }
  const i = items.findIndex((it) => it.kind === "signal");
  return i < 0 ? 0 : i;
}
