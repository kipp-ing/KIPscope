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

const rules = (
  list: DisplayRule[],
  rename: [string, string][] = [],
  aliases: [string, string][] = [],
): DisplayRules => ({
  rules: list,
  rename: new Map(rename),
  aliases: new Map(aliases),
  groups: [],
});

describe("assignDisplayNames", () => {
  it("takes the first matching rule and renders its template", () => {
    const r = rules([hexRule(false), dotRule([g("message"), "-", g("signal")], false)]);
    const { shown, fellBack } = assignDisplayNames(
      ["ICL_3A2h.SPEED_DISP", "STR_0D4h.STEER_CHKSUM", "CLIM_A1.T_SET"],
      r,
    );
    expect(shown.get("ICL_3A2h.SPEED_DISP")).toBe("SPEED_DISP");
    expect(shown.get("STR_0D4h.STEER_CHKSUM")).toBe("STEER_CHKSUM");
    expect(shown.get("CLIM_A1.T_SET")).toBe("CLIM_A1-T_SET");
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
        ["ICL_3A2h.SPEED_DISP", "Speed"],
        ["NOPE_1h.X", "Nope"],
      ],
    );
    const { shown } = assignDisplayNames(["ICL_3A2h.SPEED_DISP", "BRK_1A0h.WSPD_FL"], r);
    expect(shown.get("ICL_3A2h.SPEED_DISP")).toBe("Speed");
    expect(shown.get("BRK_1A0h.WSPD_FL")).toBe("WSPD_FL");
    expect(shown.has("NOPE_1h.X")).toBe(false);
  });

  it("suffixes colliding rule names with the collision template", () => {
    const { shown, fellBack } = assignDisplayNames(
      ["ICL_3A2h.SPEED_DISP", "KOMBI_512h.SPEED_DISP", "BRK_1A0h.WSPD_FL"],
      rules([hexRule(), dotRule()]),
    );
    expect(shown.get("ICL_3A2h.SPEED_DISP")).toBe("SPEED_DISP (ICL)");
    expect(shown.get("KOMBI_512h.SPEED_DISP")).toBe("SPEED_DISP (KOMBI)");
    expect(shown.get("BRK_1A0h.WSPD_FL")).toBe("WSPD_FL");
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

  // Spec display-names "A dictionary entry skips the rules", signal-aliases "Alias beats a rule, rename beats alias".
  it("ranks rename, alias, rules", () => {
    const r = rules(
      [hexRule(false)],
      [["Sna_800h.RPM", "Revs"]],
      [
        ["ICL_3A2h.SPEED_DISP", "Speed"],
        ["Sna_800h.RPM", "Rpm"],
        ["NOPE_1h.X", "Nope"],
      ],
    );
    const { shown, fellBack } = assignDisplayNames(
      ["ICL_3A2h.SPEED_DISP", "Sna_800h.RPM", "STR_0D4h.STEER_CHKSUM"],
      r,
    );
    // The alias beats the rule (which would show SPEED_DISP); the rename beats the alias.
    expect(shown.get("ICL_3A2h.SPEED_DISP")).toBe("Speed");
    expect(shown.get("Sna_800h.RPM")).toBe("Revs");
    // No entry: the rule still applies.
    expect(shown.get("STR_0D4h.STEER_CHKSUM")).toBe("STEER_CHKSUM");
    // An entry for a name that is not in the list shows nothing.
    expect(shown.has("NOPE_1h.X")).toBe(false);
    expect(shown.size).toBe(3);
    expect(fellBack).toEqual([]);
  });

  it("never gives an alias a rule's collision suffix", () => {
    // ICL_3A2h.SPEED_DISP is rule-made SPEED_DISP; the dictionary shows X_1h.Y as the same text.
    const { shown, fellBack } = assignDisplayNames(
      ["ICL_3A2h.SPEED_DISP", "X_1h.Y"],
      rules([hexRule()], [], [["X_1h.Y", "SPEED_DISP"]]),
    );
    expect(shown.get("X_1h.Y")).toBe("SPEED_DISP");
    expect(shown.get("ICL_3A2h.SPEED_DISP")).toBe("SPEED_DISP (ICL)");
    expect(fellBack).toEqual([]);
  });

  it("puts an alias and a rule-made name without collision template on full names", () => {
    // Still shared after step 3 (no collision template): every member shows its full name.
    const { shown, fellBack } = assignDisplayNames(
      ["ICL_3A2h.SPEED_DISP", "X_1h.Y"],
      rules([hexRule(false)], [], [["X_1h.Y", "SPEED_DISP"]]),
    );
    expect(shown.get("X_1h.Y")).toBe("X_1h.Y");
    expect(shown.get("ICL_3A2h.SPEED_DISP")).toBe("ICL_3A2h.SPEED_DISP");
    expect(fellBack).toEqual(["ICL_3A2h.SPEED_DISP", "X_1h.Y"]);
  });

  it("gives way to a full name an alias would hide", () => {
    // B.Y's logical name is another signal's full name: B.Y gives way, A.X keeps its own.
    const { shown, fellBack } = assignDisplayNames(["A.X", "B.Y"], rules([], [], [["B.Y", "A.X"]]));
    expect(shown.get("A.X")).toBe("A.X");
    expect(shown.get("B.Y")).toBe("B.Y");
    expect(fellBack).toEqual(["B.Y"]);
  });

  it("puts an alias and a rename onto one text on full names", () => {
    const { shown, fellBack } = assignDisplayNames(
      ["A.X", "B.Y"],
      rules([], [["A.X", "Foo"]], [["B.Y", "Foo"]]),
    );
    expect(shown.get("A.X")).toBe("A.X");
    expect(shown.get("B.Y")).toBe("B.Y");
    expect(fellBack).toEqual(["A.X", "B.Y"]);
  });
});
