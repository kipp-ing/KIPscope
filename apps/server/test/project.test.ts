import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assignDisplayNames } from "../src/names.ts";
import { loadProjectFile, ProjectFileError, parseProjectFile } from "../src/project.ts";
import { fixture } from "./testdb.ts";

const repoRoot = resolve(import.meta.dirname, "../../..");

function lines(text: string, path = "p.yaml"): string[] {
  try {
    parseProjectFile(text, path);
  } catch (e) {
    expect(e).toBeInstanceOf(ProjectFileError);
    return (e as Error).message.split("\n").filter((l) => l.trim() !== "");
  }
  throw new Error("expected parseProjectFile to throw");
}

describe("project file", () => {
  it("returns no rules for a missing optional file and fails for a missing required one", () => {
    const path = resolve(import.meta.dirname, "fixtures/does-not-exist.yaml");
    const none = loadProjectFile({ path, required: false });
    expect(none.rules).toEqual([]);
    expect(none.rename.size).toBe(0);
    expect(() => loadProjectFile({ path, required: true })).toThrow(ProjectFileError);
    expect(() => loadProjectFile({ path, required: true })).toThrow(`${path}: file not found`);
  });

  it("accepts an empty file and a file with only comments", () => {
    for (const text of ["", "# nothing\n"]) {
      const r = parseProjectFile(text, "p.yaml");
      expect(r.rules).toEqual([]);
      expect(r.rename.size).toBe(0);
    }
  });

  it("reports every problem with file, field and reason", () => {
    const bad = fixture("kipscope.bad.yaml");
    const out = lines(readFileSync(bad, "utf8"), bad);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatch(
      new RegExp(
        `^${bad}: display\\.names\\[0\\]\\.match: invalid regex: .*Unterminated character class`,
      ),
    );
    expect(out[1]).toBe(
      `${bad}: display.names[1].show: unknown group "sig" (groups: message, signal)`,
    );
    expect(out[2]).toBe(`${bad}: display.names[2].show: stray "{" at column 1`);

    // Same through the loader.
    expect(() => loadProjectFile({ path: bad, required: true })).toThrow(/stray "\{" at column 1/);

    // Structure: unknown keys and a missing show, all reported together.
    const structure = lines("display: { names: [{ match: 'a', colision: 'x' }], renames: {} }\n");
    expect(structure).toContain('p.yaml: display: unknown key "renames"');
    expect(structure).toContain('p.yaml: display.names[0]: unknown key "colision"');
    expect(structure.some((l) => l.startsWith("p.yaml: display.names[0].show: "))).toBe(true);

    // Empty rename value.
    expect(lines("display:\n  rename:\n    A.B: ''\n")).toContain(
      "p.yaml: display.rename.A.B: empty name",
    );

    // Duplicate key: a yaml: line naming the line of the second key.
    const dup = lines("display:\n  rename:\n    A.B: x\n    A.B: y\n");
    expect(dup[0]).toMatch(/^p\.yaml: yaml: .*line 4/i);
  });

  it("parses the shipped kipscope.yaml and kipscope.example.yaml", () => {
    const names = [
      "COMBI_412h.V_ANZ",
      "SAS_0C2h.LWS_CHKSUM",
      "CPC_448h.PTC_HV_Volt",
      "AC_A1.T_SOLL",
      "D_RS_AC.D_RS_AC",
    ];
    for (const file of ["kipscope.yaml", "kipscope.example.yaml"]) {
      const rules = loadProjectFile({ path: resolve(repoRoot, file), required: true });
      const { shown, fellBack } = assignDisplayNames(names, rules);
      expect(
        names.map((n) => shown.get(n)),
        file,
      ).toEqual(["V_ANZ", "LWS_CHKSUM", "PTC_HV_Volt", "T_SOLL", "D_RS_AC"]);
      expect(fellBack).toEqual([]);
    }
  });
});
