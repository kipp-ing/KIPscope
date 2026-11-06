import { describe, expect, it } from "vitest";
import { type SignalInfo, shownName } from "../src/signals.ts";

const info = (extra: Partial<SignalInfo> = {}): SignalInfo => ({
  id: "testcar/Fast_100h.SIG_A",
  dataRef: "testcar",
  name: "Fast_100h.SIG_A",
  ...extra,
});

describe("shownName", () => {
  it("shows displayName, else the name, by default", () => {
    expect(shownName(info({ displayName: "Speed", alias: "Speed" }))).toBe("Speed");
    expect(shownName(info())).toBe("Fast_100h.SIG_A");
    expect(shownName(info({ displayName: "Speed" }), "shown")).toBe("Speed");
    expect(shownName(info(), "shown")).toBe("Fast_100h.SIG_A");
  });

  // Spec signal-aliases "Switch": `source` shows the full source name everywhere.
  it("shows the source name with names=source", () => {
    expect(shownName(info({ displayName: "Speed", alias: "Speed" }), "source")).toBe(
      "Fast_100h.SIG_A",
    );
    expect(shownName(info({ displayName: "SIG_A (Fast)" }), "source")).toBe("Fast_100h.SIG_A");
    expect(shownName(info(), "source")).toBe("Fast_100h.SIG_A");
  });
});
