import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  applyFavouritesChange,
  type Favourites,
  type FavouritesChange,
  favouritesDoc,
  MAX_FAVOURITES,
  parseFavouritesDoc,
  USER_ID,
} from "@kipscope/shared";
import { stringify } from "yaml";
import { writeAtomic } from "./persist.ts";
import { parseViewText } from "./views.ts";

/** Largest favourites file read; a larger one counts as broken (add-favourites F2). */
export const MAX_FAVOURITES_BYTES = 262_144;
export const FAVOURITES_FILE = "favourites.yaml";

export type FavouritesResult =
  | { ok: true; names: string[]; changed: boolean }
  | {
      ok: false;
      status: 409 | 422 | 500;
      code: "favourites_unreadable" | "too_many_favourites" | "favourites_io_failed";
      message: string;
    };

/** Canonical YAML of a favourites file (F2 "Writing"). */
export function favouritesYaml(names: readonly string[]): string {
  return stringify(favouritesDoc(names), { lineWidth: 0 });
}

/**
 * One user's favourites file (add-favourites F2): read on every call, synchronously, no cache, so
 * a hand edit counts from the next request; a change is read, applied and written atomically in
 * one tick. A broken file is reported and never overwritten.
 */
export class FavouriteStore {
  readonly file: string;
  private readonly changed: ((favourites: Favourites) => void) | undefined;

  /** `changed` is called after each write that changed the list (`userFavourites`). */
  constructor(file: string, changed?: (favourites: Favourites) => void) {
    this.file = file;
    this.changed = changed;
  }

  /** The list; `{names: []}` without a file, `{names: [], error}` for a broken one. */
  get(): Favourites {
    const tooLarge: Favourites = {
      names: [],
      error: `file larger than ${MAX_FAVOURITES_BYTES} bytes`,
    };
    let text: string;
    try {
      // Size first, so a huge broken file is never read in full.
      if (statSync(this.file).size > MAX_FAVOURITES_BYTES) return tooLarge;
      text = readFileSync(this.file, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return { names: [] };
      return { names: [], error: `not readable: ${String(error)}` };
    }
    // Again after the read: the file may have grown in between.
    if (Buffer.byteLength(text) > MAX_FAVOURITES_BYTES) return tooLarge;
    const data = parseViewText(text);
    if (!data.ok) return { names: [], error: data.message };
    const parsed = parseFavouritesDoc(data.data);
    return parsed.ok ? { names: parsed.names } : { names: [], error: parsed.message };
  }

  /** Removes, then appends (F2); writes only when the list changed. */
  change(change: FavouritesChange): FavouritesResult {
    const current = this.get();
    if (current.error !== undefined)
      return {
        ok: false,
        status: 409,
        code: "favourites_unreadable",
        message: `favourites file not readable, left as it is: ${current.error}`,
      };
    const names = applyFavouritesChange(current.names, change);
    if (names.length > MAX_FAVOURITES)
      return {
        ok: false,
        status: 422,
        code: "too_many_favourites",
        message: `${names.length} favourites; at most ${MAX_FAVOURITES}`,
      };
    const same =
      names.length === current.names.length && names.every((n, i) => n === current.names[i]);
    if (same) return { ok: true, names, changed: false };
    try {
      writeAtomic(this.file, favouritesYaml(names));
    } catch (error) {
      return {
        ok: false,
        status: 500,
        code: "favourites_io_failed",
        message: `favourites not written: ${String(error)}`,
      };
    }
    this.changed?.({ names });
    return { ok: true, names, changed: true };
  }
}

/** Each user's favourites store, and who hears of a change (add-favourites F4). */
export interface FavouritesOf {
  /** Throws for a user not matching USER_ID, before any path. */
  (user: string): FavouriteStore;
  onChange(listener: (user: string, favourites: Favourites) => void): () => void;
}

/**
 * One cached `FavouriteStore` per user on `<stateDir>/users/<user>/favourites.yaml` (F2). The user
 * is checked against `USER_ID` before a path is built, as `userViews`. Listeners hear every
 * change after its write; a throwing listener does not fail the write or the other listeners.
 */
export function userFavourites(stateDir: string): FavouritesOf {
  const stores = new Map<string, FavouriteStore>();
  const listeners = new Set<(user: string, favourites: Favourites) => void>();
  const notify = (user: string, favourites: Favourites) => {
    for (const listener of [...listeners]) {
      try {
        listener(user, favourites);
      } catch (error) {
        console.warn(`favourites listener failed: ${String(error)}`);
      }
    }
  };
  const of = (user: string): FavouriteStore => {
    if (!USER_ID.test(user)) throw new Error(`invalid user: ${user}`);
    let store = stores.get(user);
    if (!store) {
      store = new FavouriteStore(join(stateDir, "users", user, FAVOURITES_FILE), (favourites) =>
        notify(user, favourites),
      );
      stores.set(user, store);
    }
    return store;
  };
  return Object.assign(of, {
    onChange(listener: (user: string, favourites: Favourites) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
}
