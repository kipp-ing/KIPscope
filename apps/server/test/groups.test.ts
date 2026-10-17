import { describe, expect, it } from "vitest";
import { assignGroup, type GroupRule } from "../src/groups.ts";

/** The shipped rules (D-053 Q1), compiled by hand. */
const shipped: GroupRule[] = [
  { index: 0, group: [{ group: "sender" }] },
  { index: 1, match: /^(?<ecu>DCU|HVM)_/, group: [{ group: "ecu" }] },
];

describe("assignGroup", () => {
  it("takes the first rule that matches and renders non-blank", () => {
    // Rule 0 is blank without sender and falls through to rule 1.
    expect(assignGroup("DCU_2B8h.HTR_HV_Volt", {}, shipped)).toBe("DCU");
    expect(assignGroup("ICL_3A2h.SPEED_DISP", { sender: "CGW" }, shipped)).toBe("CGW");
    // Neither rule renders anything: Other.
    expect(assignGroup("VIN.VIN_1", {}, shipped)).toBeUndefined();
    // A sender beats the fallback rule.
    expect(assignGroup("DCU_1F4h.X", { sender: "BMS" }, shipped)).toBe("BMS");
    expect(assignGroup("HVM_STAT.HVM_Bat_Temp", {}, shipped)).toBe("HVM");
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
