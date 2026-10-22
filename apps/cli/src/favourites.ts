import type { Favourites, FavouritesChange } from "@kipscope/shared";
import type { Client } from "./client.ts";
import { CliError } from "./output.ts";
import { type Lookups, NAME_LIMIT, nameMatches } from "./refs.ts";
import type { Body } from "./run.ts";

/** The `fav …` forms (add-favourites F11); NAMEs as given, resolved when the call runs. */
export type FavInvocation =
  | { kind: "fav"; action: "list" }
  | { kind: "fav"; action: "add" | "rm"; names: string[] };

const PATH = "/api/favourites";

/** Executes one fav form and fills `body`; refusals throw CliError before anything is sent. */
export async function runFavourites(
  invocation: FavInvocation,
  client: Client,
  lookups: Lookups,
  body: Body,
): Promise<void> {
  switch (invocation.action) {
    case "list":
      body.data = await client.get<Favourites>(PATH);
      return;
    case "add": {
      const unlisted: string[] = [];
      const names: string[] = [];
      for (const name of invocation.names) names.push(await nameToStar(name, lookups, unlisted));
      const before = new Set((await client.get<Favourites>(PATH)).names);
      const after = await change(client, { add: unique(names) });
      const added = unique(names).filter((n) => !before.has(n) && after.includes(n));
      body.data = {
        names: after,
        added,
        ...(unlisted.length > 0 && {
          warnings: [`not in this list: ${unique(unlisted).join(", ")}`],
        }),
      };
      return;
    }
    case "rm": {
      const current = await client.get<Favourites>(PATH);
      if (current.error !== undefined) {
        throw new CliError("rejected", "favourites_unreadable", current.error);
      }
      const names = unique(invocation.names.map((name) => favouriteOf(name, current.names)));
      const after = await change(client, { remove: names });
      body.data = { names: after, removed: names.filter((n) => !after.includes(n)) };
      return;
    }
  }
}

async function change(client: Client, request: FavouritesChange): Promise<string[]> {
  return (await client.post<Favourites>(PATH, request)).names;
}

/**
 * The favourite of a `fav add` NAME: a full ID's part after the first "/"; a bare name's one
 * listed name (several: ambiguous_signal); no match: NAME as given, noted in `unlisted` (D-103).
 */
async function nameToStar(name: string, l: Lookups, unlisted: string[]): Promise<string> {
  const slash = name.indexOf("/");
  if (slash >= 0) return name.slice(slash + 1);
  const page = await l.search(name, NAME_LIMIT);
  const names = unique(page.items.filter((s) => nameMatches(s.name, name)).map((s) => s.name));
  if (names.length === 1) return names[0] as string;
  if (names.length === 0) {
    unlisted.push(name);
    return name;
  }
  const candidates = names.sort();
  throw new CliError(
    "rejected",
    "ambiguous_signal",
    `"${name}" names ${candidates.length} signals: ${candidates.join(", ")}`,
    candidates,
  );
}

/**
 * The member of `list` a `fav rm` NAME names: an exact member; else members equal ignoring case
 * or by the part after the first "." (several: ambiguous_favourite); else a full ID whose name is
 * a member; else unknown_favourite.
 */
function favouriteOf(name: string, list: readonly string[]): string {
  if (list.includes(name)) return name;
  const hits = list.filter((n) => nameMatches(n, name));
  if (hits.length === 1) return hits[0] as string;
  if (hits.length > 1) {
    const candidates = [...hits].sort();
    throw new CliError(
      "rejected",
      "ambiguous_favourite",
      `"${name}" names ${candidates.length} favourites: ${candidates.join(", ")}`,
      candidates,
    );
  }
  const slash = name.indexOf("/");
  if (slash >= 0 && list.includes(name.slice(slash + 1))) return name.slice(slash + 1);
  throw new CliError("rejected", "unknown_favourite", `"${name}" is not a favourite`);
}

function unique(names: readonly string[]): string[] {
  return [...new Set(names)];
}
