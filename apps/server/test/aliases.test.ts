import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadAliases } from "../src/aliases.ts";
import { fixture } from "./testdb.ts";

// Spec signal-aliases "Aliases file", "Aliases file is checked at start".
const dir = mkdtempSync(join(tmpdir(), "kipscope-aliases-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
/** Writes `text` to a fresh file and returns its path. */
function file(text: string): string {
  const path = join(dir, `a${n++}.json`);
  writeFileSync(path, text);
  return path;
}
const json = (value: unknown) => file(JSON.stringify(value));

describe("loadAliases", () => {
  it("fails for a missing file", () => {
    const path = join(dir, "nope.json");
    expect(() => loadAliases(path)).toThrow(`${path}: file not found`);
  });

  it("reads a valid dictionary", () => {
    const a = loadAliases(
      json({ Speed: "ICL_3A2h.SPEED_DISP", RPM: "Sna_800h.RPM", WSPD_FL: "WSPD_FL" }),
    );
    // The self-entry is accepted and has no effect: two effective entries.
    expect(a.bySource.size).toBe(2);
    expect(a.byLogical.size).toBe(2);
    expect(a.bySource.get("ICL_3A2h.SPEED_DISP")).toBe("Speed");
    expect(a.bySource.get("Sna_800h.RPM")).toBe("RPM");
    expect(a.bySource.has("WSPD_FL")).toBe(false);
    // byLogical is keyed by the lower-case logical name.
    expect(a.byLogical.get("speed")).toBe("ICL_3A2h.SPEED_DISP");
    expect(a.byLogical.get("rpm")).toBe("Sna_800h.RPM");
    expect(a.byLogical.has("wspd_fl")).toBe(false);
  });

  it("reads the test dictionary fixture", () => {
    const a = loadAliases(fixture("aliases.test.json"));
    expect([...a.bySource]).toEqual([
      ["Fast_100h.SIG_A", "Speed"],
      ["Sna_800h.RPM", "Revs"],
      ["ECM_1B0h.BOOST", "Boost"],
    ]);
    expect(a.byLogical.get("revs")).toBe("Sna_800h.RPM");
  });

  it("reads an empty object as no aliases", () => {
    const a = loadAliases(json({}));
    expect(a.bySource.size).toBe(0);
    expect(a.byLogical.size).toBe(0);
  });

  it("refuses an invalid dictionary", () => {
    // Each load fails with a message that names the file.
    const refused = (path: string): string => {
      let message = "";
      try {
        loadAliases(path);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, path).toContain(path);
      // Without the path, whose random temp directory could contain the key letters.
      return message.replaceAll(path, "<file>");
    };
    refused(file("{ not json"));
    refused(file("[]"));
    refused(json({ "": "A" }));
    refused(json({ " Speed": "A" }));
    refused(json({ "Speed ": "A" }));
    refused(json({ Speed: 3 }));
    // Further rules of the requirement: blank source, control character, over 256 characters.
    refused(json({ Speed: "" }));
    refused(json({ Speed: "   " }));
    refused(json({ "Sp\u0007eed": "A" }));
    refused(json({ ["x".repeat(257)]: "A" }));

    // The last three name both entries.
    const many = refused(json({ X: "A", Y: "A" }));
    expect(many).toMatch(/\bX\b/);
    expect(many).toMatch(/\bY\b/);
    const twins = refused(json({ Speed: "A", speed: "B" }));
    expect(twins).toContain("Speed");
    expect(twins).toContain("speed");
    const chained = refused(json({ A: "B", B: "C" }));
    expect(chained).toMatch(/\bA\b/);
    expect(chained).toMatch(/\bB\b/);
  });

  it("accepts a logical name of 256 characters", () => {
    const long = "x".repeat(256);
    const a = loadAliases(json({ [long]: "A.B" }));
    expect(a.bySource.get("A.B")).toBe(long);
  });
});
