import { describe, expect, it } from "vitest";
import { assignGroup, type GroupRule } from "../src/groups.ts";

/** The shipped rules (D-053 Q1), compiled by hand. */
const shipped: GroupRule[] = [
  { index: 0, group: [{ group: "sender" }] },
  { index: 1, match: /^(?<ecu>CPC|PNHV)_/, group: [{ group: "ecu" }] },
];

describe("assignGroup", () => {
  it("takes the first rule that matches and renders non-blank", () => {
    // Rule 0 is blank without sender and falls through to rule 1.
    expect(assignGroup("CPC_448h.PTC_HV_Volt", {}, shipped)).toBe("CPC");
    expect(assignGroup("COMBI_412h.V_ANZ", { sender: "CGW" }, shipped)).toBe("CGW");
    // Neither rule renders anything: Other.
    expect(assignGroup("VIN.VIN_1", {}, shipped)).toBeUndefined();
    // A sender beats the fallback rule.
    expect(assignGroup("CPC_168h.X", { sender: "BMS" }, shipped)).toBe("BMS");
    expect(assignGroup("PNHV_STAT.PNHV_SupBat_Temp", {}, shipped)).toBe("PNHV");
  });

  it("falls through blank renders and maps Other to undefined", () => {
    const rules: GroupRule[] = [{ index: 0, group: [" ", { group: "sender" }, " "] }];
    expect(assignGroup("A.B", { sender: "ESP" }, rules)).toBe("ESP");
    expect(assignGroup("A.B", {}, rules)).toBeUndefined();
    expect(assignGroup("A.B", { sender: "Other" }, rules)).toBeUndefined();
    // No rules at all.
    expect(assignGroup("A.B", { sender: "ESP" }, [])).toBeUndefined();
  });
});
