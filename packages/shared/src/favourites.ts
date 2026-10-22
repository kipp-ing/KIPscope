import { z } from "zod";

/** Most favourites a user keeps; only a guard against runaway scripts (add-favourites "Numbers"). */
export const MAX_FAVOURITES = 1000;
export const MAX_FAVOURITE_NAME = 200;

/** 1–200 chars, no control characters, no leading/trailing whitespace (F3). */
export const FavouriteName: z.ZodType<string> = z
  .string()
  .min(1)
  .max(MAX_FAVOURITE_NAME)
  .refine((s) => !/\p{Cc}/u.test(s), { message: "no control characters" })
  .refine((s) => s.trim() === s, { message: "no leading or trailing whitespace" });

/** Body of POST /api/favourites; strict; at least one of add/remove with one name or more. */
export const FavouritesChange = z
  .object({
    add: z.array(FavouriteName).max(MAX_FAVOURITES).optional(),
    remove: z.array(FavouriteName).max(MAX_FAVOURITES).optional(),
  })
  .strict()
  .refine((c) => (c.add?.length ?? 0) > 0 || (c.remove?.length ?? 0) > 0, {
    message: "add or remove at least one name",
  });
export type FavouritesChange = z.infer<typeof FavouritesChange>;

/** GET/POST answer and the live message's payload. */
export interface Favourites {
  names: string[];
  /** Set when the file cannot be read; `names` is then empty (F2). */
  error?: string;
}

/** `<stateDir>/users/<user>/favourites.yaml` (F2). */
export interface FavouritesDoc {
  kipscope: "favourites";
  version: 1;
  names: string[];
}

/** `names` without `remove`, then each `add` not yet present appended in order; never repeats. */
export function applyFavouritesChange(
  names: readonly string[],
  change: FavouritesChange,
): string[] {
  const removed = new Set(change.remove ?? []);
  const result = names.filter((name) => !removed.has(name));
  const present = new Set(result);
  for (const name of change.add ?? []) {
    if (present.has(name)) continue;
    present.add(name);
    result.push(name);
  }
  return result;
}

/** F8: undefined for no names; some unstarred → {add: those, in order}; else {remove: names}. */
export function toggleFavourites(
  starred: ReadonlySet<string>,
  names: readonly string[],
): FavouritesChange | undefined {
  if (names.length === 0) return undefined;
  const add = names.filter((name) => !starred.has(name));
  return add.length > 0 ? { add } : { remove: [...names] };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Tolerant: unknown keys ignored, repeated names dropped (first kept). Error: kipscope not
 * "favourites", version not 1, names not an array of FavouriteName, more than MAX_FAVOURITES.
 */
export function parseFavouritesDoc(
  data: unknown,
): { ok: true; names: string[] } | { ok: false; message: string } {
  if (!isRecord(data) || data.kipscope !== "favourites")
    return { ok: false, message: "not a KIPscope favourites file" };
  if (data.version !== 1)
    return {
      ok: false,
      message: `favourites version ${String(data.version)}; this KIPscope reads 1`,
    };
  if (!Array.isArray(data.names)) return { ok: false, message: "names: not a list" };
  const names: string[] = [];
  const seen = new Set<string>();
  for (const [i, name] of data.names.entries()) {
    const parsed = FavouriteName.safeParse(name);
    if (!parsed.success)
      return {
        ok: false,
        message: `names[${i}]: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
      };
    if (seen.has(parsed.data)) continue;
    seen.add(parsed.data);
    names.push(parsed.data);
  }
  if (names.length > MAX_FAVOURITES)
    return {
      ok: false,
      message: `${names.length} names; at most ${MAX_FAVOURITES}`,
    };
  return { ok: true, names };
}

export function favouritesDoc(names: readonly string[]): FavouritesDoc {
  return { kipscope: "favourites", version: 1, names: [...names] };
}
