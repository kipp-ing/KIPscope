import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assignDisplayNames } from "../src/names.ts";
import {
  loadProject,
  loadProjectFile,
  ProjectFileError,
  parseProject,
  parseProjectFile,
} from "../src/project.ts";
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

describe("project file measurement section (add-footer)", () => {
  /** Problem lines of a project file text that must be refused. */
  function problems(text: string): string[] {
    try {
      parseProject(text, "p.yaml");
    } catch (e) {
      expect(e).toBeInstanceOf(ProjectFileError);
      return (e as Error).message.split("\n").filter((l) => l.trim() !== "");
    }
    throw new Error("expected parseProject to throw");
  }

  it("reads the measurement section", () => {
    const text = [
      "measurement:",
      "  name: Testfahrt A9",
      "  object: smart451",
      "  meta:",
      "    driver: Jan",
      "    run: 3",
      "    wet: true",
      "    note: null",
      "",
    ].join("\n");
    const parsed = parseProject(text, "p.yaml");
    expect(parsed.measurement).toEqual({
      name: "Testfahrt A9",
      object: "smart451",
      meta: [
        { key: "driver", value: "Jan" },
        { key: "run", value: "3" },
        { key: "wet", value: "true" },
      ],
    });
    // A file with only a measurement section gives no rules.
    expect(parsed.rules.rules).toEqual([]);
    expect(parsed.rules.rename.size).toBe(0);
    // The old entry points keep returning the rules.
    expect(parseProjectFile(text, "p.yaml").rules).toEqual([]);

    // Absent or empty section: no measurement.
    expect(parseProject("", "p.yaml").measurement).toBeUndefined();
    expect(parseProject("measurement:\n", "p.yaml").measurement).toBeUndefined();
    expect(parseProject("measurement: { name: '' }\n", "p.yaml").measurement).toBeUndefined();

    // A missing optional file gives no rules and no measurement.
    const none = loadProject({
      path: resolve(import.meta.dirname, "fixtures/does-not-exist.yaml"),
      required: false,
    });
    expect(none.rules.rules).toEqual([]);
    expect(none.measurement).toBeUndefined();
  });

  it("keeps the display rules of the shipped kipscope.yaml and adds object smart451", () => {
    const shipped = loadProject({ path: resolve(repoRoot, "kipscope.yaml"), required: true });
    expect(shipped.measurement).toEqual({ object: "smart451" });
    const before = loadProjectFile({ path: resolve(repoRoot, "kipscope.yaml"), required: true });
    expect(shipped.rules).toEqual(before);
    const { shown } = assignDisplayNames(["COMBI_412h.V_ANZ", "AC_A1.T_SOLL"], shipped.rules);
    expect([...shown.values()]).toEqual(["V_ANZ", "T_SOLL"]);
  });

  it("refuses an invalid measurement section", () => {
    const meta9 = Array.from({ length: 9 }, (_, i) => `    k${i + 1}: v`).join("\n");
    const out = problems(
      [
        "measurement:",
        "  objekt: smart451",
        `  name: ${"x".repeat(121)}`,
        "  meta:",
        "    1st: v",
        "    tags: [a, b]",
        meta9,
        "",
      ].join("\n"),
    );
    expect(out).toContain('p.yaml: measurement: unknown key "objekt"');
    expect(out).toContain("p.yaml: measurement.name: at most 120 characters");
    expect(out).toContain("p.yaml: measurement.meta.1st: key must start with a letter");
    expect(out).toContain("p.yaml: measurement.meta: at most 8 entries");
    expect(out).toContain("p.yaml: measurement.meta.tags: must be text, a number or true/false");

    // Problems of both sections come together in one error.
    const both = problems("display: { names: [{ match: 'a' }] }\nmeasurement: { objekt: x }\n");
    expect(both.some((l) => l.startsWith("p.yaml: display.names[0].show: "))).toBe(true);
    expect(both).toContain('p.yaml: measurement: unknown key "objekt"');

    // Further limits and characters.
    expect(problems(`measurement: { object: ${"x".repeat(121)} }\n`)).toContain(
      "p.yaml: measurement.object: at most 120 characters",
    );
    expect(problems(`measurement:\n  meta:\n    ${"k".repeat(41)}: v\n`)).toContain(
      `p.yaml: measurement.meta.${"k".repeat(41)}: at most 40 characters`,
    );
    expect(problems(`measurement:\n  meta:\n    k: ${"v".repeat(201)}\n`)).toContain(
      "p.yaml: measurement.meta.k: at most 200 characters",
    );
    expect(problems('measurement:\n  name: "two\\nlines"\n')).toContain(
      "p.yaml: measurement.name: no line breaks or control characters",
    );
    expect(problems("measurement:\n  meta:\n    a/b: v\n")).toContain(
      "p.yaml: measurement.meta.a/b: key may hold only letters, digits, space, _ . -",
    );
  });
});
