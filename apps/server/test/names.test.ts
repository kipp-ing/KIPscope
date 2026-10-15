import { describe, expect, it } from "vitest";
import {
  assignDisplayNames,
  type DisplayRule,
  type DisplayRules,
  type Template,
} from "../src/names.ts";

const g = (group: string) => ({ group });

function rule(index: number, match: string, show: Template, collision?: Template): DisplayRule {
  return { index, match: new RegExp(match), show, ...(collision ? { collision } : {}) };
}

const hexRule = (collision = true) =>
  rule(
    0,
    "^(?<message>[^.]+?)_[0-9A-Fa-f]+h\\.(?<signal>.+)$",
    [g("signal")],
    collision ? [g("signal"), " (", g("message"), ")"] : undefined,
  );
const dotRule = (show: Template = [g("signal")], collision = true) =>
  rule(
    1,
    "^(?<message>[^.]+)\\.(?<signal>.+)$",
    show,
    collision ? [g("signal"), " (", g("message"), ")"] : undefined,
  );

const rules = (list: DisplayRule[], rename: [string, string][] = []): DisplayRules => ({
  rules: list,
  rename: new Map(rename),
});

describe("assignDisplayNames", () => {
  it("takes the first matching rule and renders its template", () => {
    const r = rules([hexRule(false), dotRule([g("message"), "-", g("signal")], false)]);
    const { shown, fellBack } = assignDisplayNames(
      ["COMBI_412h.V_ANZ", "SAS_0C2h.LWS_CHKSUM", "AC_A1.T_SOLL"],
      r,
    );
    expect(shown.get("COMBI_412h.V_ANZ")).toBe("V_ANZ");
    expect(shown.get("SAS_0C2h.LWS_CHKSUM")).toBe("LWS_CHKSUM");
    expect(shown.get("AC_A1.T_SOLL")).toBe("AC_A1-T_SOLL");
    expect(fellBack).toEqual([]);
  });

  it("keeps the full name without a matching rule or with an empty render", () => {
    const r = rules([hexRule(false), rule(1, "^X(?<rest>.*)$", [g("rest")])]);
    const { shown } = assignDisplayNames(["VIN.VIN_1", "X"], r);
    expect(shown.get("VIN.VIN_1")).toBe("VIN.VIN_1");
    expect(shown.get("X")).toBe("X");
    expect(shown.size).toBe(2);
  });

  it("lets a rename beat every rule", () => {
    const r = rules(
      [hexRule(false)],
      [
        ["COMBI_412h.V_ANZ", "Speed"],
        ["NOPE_1h.X", "Nope"],
      ],
    );
    const { shown } = assignDisplayNames(["COMBI_412h.V_ANZ", "BS_200h.DVL"], r);
    expect(shown.get("COMBI_412h.V_ANZ")).toBe("Speed");
    expect(shown.get("BS_200h.DVL")).toBe("DVL");
    expect(shown.has("NOPE_1h.X")).toBe(false);
  });

  it("suffixes colliding rule names with the collision template", () => {
    const { shown, fellBack } = assignDisplayNames(
      ["COMBI_412h.V_ANZ", "KOMBI_512h.V_ANZ", "BS_200h.DVL"],
      rules([hexRule(), dotRule()]),
    );
    expect(shown.get("COMBI_412h.V_ANZ")).toBe("V_ANZ (COMBI)");
    expect(shown.get("KOMBI_512h.V_ANZ")).toBe("V_ANZ (KOMBI)");
    expect(shown.get("BS_200h.DVL")).toBe("DVL");
    expect(fellBack).toEqual([]);
  });

  it("falls back to full names while names still collide", () => {
    const sig = rule(
      0,
      "^(?<message>[A-Za-z]+)_[0-9A-Fa-f]+h\\.(?<signal>[A-Z]+)_[A-Z]$",
      [g("signal")],
      [g("signal"), " (", g("message"), ")"],
    );
    const names = ["Fast_100h.SIG_C", "Fast_100h.SIG_A", "Fast_100h.SIG_B"];
    const a = assignDisplayNames(names, rules([sig]));
    for (const n of names) expect(a.shown.get(n)).toBe(n);
    expect(a.fellBack).toEqual(["Fast_100h.SIG_A", "Fast_100h.SIG_B", "Fast_100h.SIG_C"]);

    // A rename onto another signal's full name: the renamed one gives way.
    const b = assignDisplayNames(["B.Y", "A.X"], rules([], [["B.Y", "A.X"]]));
    expect(b.shown.get("A.X")).toBe("A.X");
    expect(b.shown.get("B.Y")).toBe("B.Y");
    expect(b.fellBack).toEqual(["B.Y"]);
  });
});
