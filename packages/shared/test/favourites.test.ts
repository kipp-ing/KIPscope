import { describe, expect, it } from "vitest";
import {
  applyFavouritesChange,
  FavouritesChange,
  favouritesDoc,
  MAX_FAVOURITES,
  parseFavouritesDoc,
  toggleFavourites,
} from "../src/favourites.ts";

describe("favourites", () => {
  it("parses the favourites file tolerantly", () => {
    const doc = { kipscope: "favourites", version: 1, names: ["A.B", "C.D", "A.B"], extra: 1 };
    // Unknown keys ignored, a repeated name dropped (first kept).
    expect(parseFavouritesDoc(doc)).toEqual({ ok: true, names: ["A.B", "C.D"] });

    const refused = (data: unknown) => {
      const result = parseFavouritesDoc(data);
      expect(result.ok, String(JSON.stringify(data)).slice(0, 80)).toBe(false);
      if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
    };
    refused({ ...doc, version: 2 });
    refused({ ...doc, kipscope: "view" });
    refused({ ...doc, names: ["", "A.B"] });
    refused({ ...doc, names: [" A.B"] });
    // 1001 distinct names are one over the limit; 1000 are fine.
    const names = (n: number) => Array.from({ length: n }, (_, i) => `N${i}.X`);
    expect(MAX_FAVOURITES).toBe(1000);
    refused({ ...doc, names: names(1001) });
    expect(parseFavouritesDoc({ ...doc, names: names(1000) })).toEqual({
      ok: true,
      names: names(1000),
    });

    // Not a document at all, names not an array, a name that is not a string.
    refused(undefined);
    refused("favourites");
    refused({ kipscope: "favourites", version: 1, names: "A.B" });
    refused({ kipscope: "favourites", version: 1, names: [1] });
    // No names key is not a list.
    refused({ kipscope: "favourites", version: 1 });
  });

  it("builds the canonical document from names", () => {
    expect(favouritesDoc(["A.B", "C.D"])).toEqual({
      kipscope: "favourites",
      version: 1,
      names: ["A.B", "C.D"],
    });
    const back = parseFavouritesDoc(favouritesDoc(["A.B", "C.D"]));
    expect(back).toEqual({ ok: true, names: ["A.B", "C.D"] });
  });

  it("validates the names and the body of a change", () => {
    const ok = (body: unknown) => FavouritesChange.safeParse(body).success;
    expect(ok({ add: ["A.B"] })).toBe(true);
    expect(ok({ remove: ["A.B"] })).toBe(true);
    expect(ok({ add: ["A.B"], remove: ["C.D"] })).toBe(true);
    expect(ok({ add: ["x".repeat(200)] })).toBe(true);
    expect(ok({ add: ["Sna_800h.RPM", "Name with space.X"] })).toBe(true);
    // At least one non-empty list.
    expect(ok({})).toBe(false);
    expect(ok({ add: [] })).toBe(false);
    expect(ok({ add: [], remove: [] })).toBe(false);
    // Name rules: 1-200 characters, no control characters, no leading or trailing whitespace.
    expect(ok({ add: [""] })).toBe(false);
    expect(ok({ add: ["x".repeat(201)] })).toBe(false);
    expect(ok({ add: ["A\u0007B"] })).toBe(false);
    expect(ok({ add: ["A\nB"] })).toBe(false);
    expect(ok({ add: [" A.B"] })).toBe(false);
    expect(ok({ add: ["A.B "] })).toBe(false);
    // Strict: no other key. Not a string.
    expect(ok({ add: ["A.B"], grant: 1 })).toBe(false);
    expect(ok({ add: [1] })).toBe(false);
    // More than 1000 names in one list.
    expect(ok({ add: Array.from({ length: 1001 }, (_, i) => `N${i}.X`) })).toBe(false);
  });

  it("applies a change: removes, then appends new names once", () => {
    const start = ["A.B", "C.D"];
    expect(applyFavouritesChange(start, { add: ["E.F", "A.B", "E.F"] })).toEqual([
      "A.B",
      "C.D",
      "E.F",
    ]);
    expect(applyFavouritesChange(start, { remove: ["A.B", "X.Y"] })).toEqual(["C.D"]);
    // Removes first: a name removed and added in one change moves to the end.
    expect(applyFavouritesChange(start, { remove: ["C.D"], add: ["C.D"] })).toEqual(["A.B", "C.D"]);
    expect(applyFavouritesChange(["C.D", "A.B"], { remove: ["C.D"], add: ["C.D"] })).toEqual([
      "A.B",
      "C.D",
    ]);
    // The input list is not changed.
    expect(start).toEqual(["A.B", "C.D"]);
  });

  it("toggles a selection: adds unless all are starred", () => {
    expect(toggleFavourites(new Set(["A.B"]), ["A.B", "C.D"])).toEqual({ add: ["C.D"] });
    expect(toggleFavourites(new Set(["A.B", "C.D"]), ["A.B", "C.D"])).toEqual({
      remove: ["A.B", "C.D"],
    });
    expect(toggleFavourites(new Set(["A.B", "C.D"]), [])).toBeUndefined();
    expect(toggleFavourites(new Set(), [])).toBeUndefined();
    // None starred: all are added, in the given order.
    expect(toggleFavourites(new Set(), ["C.D", "A.B"])).toEqual({ add: ["C.D", "A.B"] });
    // A starred name outside the targets does not matter.
    expect(toggleFavourites(new Set(["Z.Z"]), ["A.B"])).toEqual({ add: ["A.B"] });
    expect(toggleFavourites(new Set(["A.B", "Z.Z"]), ["A.B"])).toEqual({ remove: ["A.B"] });
  });
});
