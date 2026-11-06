import type { SignalInfo, SignalPage } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import { CliError } from "../src/output.ts";
import { type Lookups, nameMatches, resolveSignal } from "../src/refs.ts";

// Scenarios of cli "Signal references" with a dictionary (signal-aliases).
const sig = (dataRef: string, name: string, alias?: string): SignalInfo => ({
  id: `${dataRef}/${name}`,
  dataRef,
  name,
  ...(alias === undefined ? {} : { alias, displayName: alias }),
});

/** Lookups whose search answers `page` for any query; the workspace is never read. */
const lookups = (page: Partial<SignalPage>): Lookups & { queries: string[] } => {
  const queries: string[] = [];
  return {
    queries,
    workspace: async () => {
      throw new Error("unexpected workspace lookup");
    },
    search: async (query) => {
      queries.push(query);
      return { items: [], total: page.items?.length ?? 0, more: false, ...page };
    },
  };
};

const rejection = async (promise: Promise<unknown>): Promise<CliError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error("expected a CliError");
};

const byName = (name: string) => ({ kind: "name" as const, name });

describe("resolveSignal with logical names", () => {
  it("resolves a logical name", async () => {
    const l = lookups({ items: [sig("testcar", "Fast_100h.SIG_A", "Speed")] });
    expect(await resolveSignal(byName("speed"), l)).toBe("testcar/Fast_100h.SIG_A");
    expect(await resolveSignal(byName("Speed"), l)).toBe("testcar/Fast_100h.SIG_A");
    // The search is asked with the typed text.
    expect(l.queries).toEqual(["speed", "Speed"]);
  });

  it("still resolves the source and the short name", async () => {
    const l = lookups({ items: [sig("testcar", "Fast_100h.SIG_A", "Speed")] });
    expect(await resolveSignal(byName("sig_a"), l)).toBe("testcar/Fast_100h.SIG_A");
    expect(await resolveSignal(byName("Fast_100h.SIG_A"), l)).toBe("testcar/Fast_100h.SIG_A");
  });

  it("lets a source name win over a logical name that equals it", async () => {
    // "Speed" is a whole source name and the logical name of another signal.
    const l = lookups({
      items: [sig("testcar", "Fast_100h.SIG_A", "Speed"), sig("testcar", "Speed")],
    });
    expect(await resolveSignal(byName("Speed"), l)).toBe("testcar/Speed");
    // A short name counts as a source name, too.
    const m = lookups({
      items: [sig("testcar", "Fast_100h.SIG_A", "Speed"), sig("testcar", "ICL_3A2h.Speed")],
    });
    expect(await resolveSignal(byName("speed"), m)).toBe("testcar/ICL_3A2h.Speed");
  });

  it("ignores search results that only contain the text", async () => {
    // The search is a substring search: "Speed limit" is no match for the text "Speed".
    const l = lookups({
      items: [sig("testcar", "A_1h.X", "Speed limit"), sig("testcar", "B_1h.Y", "Speed")],
    });
    expect(await resolveSignal(byName("Speed"), l)).toBe("testcar/B_1h.Y");
  });

  it("refuses a logical name of several data refs as ambiguous", async () => {
    const l = lookups({
      items: [
        sig("testcar", "Fast_100h.SIG_A", "Speed"),
        sig("othercar", "Fast_100h.SIG_A", "Speed"),
      ],
    });
    const error = await rejection(resolveSignal(byName("Speed"), l));
    expect(error.code).toBe("ambiguous_signal");
    expect(error.candidates).toEqual(["othercar/Fast_100h.SIG_A", "testcar/Fast_100h.SIG_A"]);
  });

  it("sends a full ID unchanged without a search", async () => {
    const l = lookups({});
    expect(await resolveSignal({ kind: "id", id: "testcar/Fast_100h.SIG_A" }, l)).toBe(
      "testcar/Fast_100h.SIG_A",
    );
    expect(l.queries).toEqual([]);
  });

  it("names the source name of an unavailable alias", async () => {
    const l = lookups({ items: [], aliasOf: "ECM_1B0h.BOOST" });
    const error = await rejection(resolveSignal(byName("Boost"), l));
    expect(error.outcome).toBe("rejected");
    expect(error.code).toBe("unknown_signal");
    expect(error.message).toBe(
      '"Boost" stands for ECM_1B0h.BOOST, which this scope has no signal for',
    );
  });

  it("names the source name when the query also matches another signal by substring", async () => {
    // "Boost" is a substring of another in-scope signal, so the page is not empty, yet aliasOf is set.
    const l = lookups({
      items: [sig("testcar", "Other_1h.BOOST_PRESSURE")],
      aliasOf: "ECM_1B0h.BOOST",
    });
    const error = await rejection(resolveSignal(byName("Boost"), l));
    expect(error.outcome).toBe("rejected");
    expect(error.code).toBe("unknown_signal");
    expect(error.message).toBe(
      '"Boost" stands for ECM_1B0h.BOOST, which this scope has no signal for',
    );
    expect(error.message).not.toContain("no signal named");
  });

  it("keeps the unknown-name message", async () => {
    const l = lookups({ items: [sig("testcar", "Fast_100h.SIG_A", "Speed")] });
    const error = await rejection(resolveSignal(byName("Nope"), l));
    expect(error.outcome).toBe("rejected");
    expect(error.code).toBe("unknown_signal");
    expect(error.message).toBe('no signal named "Nope"');
  });
});

describe("nameMatches", () => {
  it("matches the name or the part after the first dot, ignoring case", () => {
    expect(nameMatches("Fast_100h.SIG_A", "sig_a")).toBe(true);
    expect(nameMatches("Fast_100h.SIG_A", "FAST_100H.SIG_A")).toBe(true);
    expect(nameMatches("Fast_100h.SIG_A", "Speed")).toBe(false);
  });
});
