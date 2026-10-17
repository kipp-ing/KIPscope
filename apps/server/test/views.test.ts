import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ViewDoc } from "@kipscope/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ViewStore } from "../src/views.ts";

/** Design V1's example, the canonical form byte for byte. */
const CANONICAL = `kipscope: view
version: 1
title: Hard acceleration, drive 3
note: BRK_LMP brake release 2–4 s before SPEED_DISP rises
saved: 2026-10-17T08:14:03Z
data:
  - smart451
linkTime: true
cursors:
  a: 2026-10-13T13:08:01.5Z
  b: 2026-10-13T13:08:09.25Z
  diff: true
digits: 3
measurement:
  object: smart451
events:
  filter: active changes
  signals:
    - smart451/DCU_1F4h.IgnMode
colors:
  smart451/ICL_3A2h.SPEED_DISP: 0
  smart451/BRK_1A0h.WSPD_FL: 1
windows:
  - kind: timeseries
    title: Speeds
    from: 2026-10-13T13:08:00Z
    to: 2026-10-13T13:08:20Z
    mode: line
    envelope: false
    signals:
      - smart451/ICL_3A2h.SPEED_DISP
      - smart451/BRK_1A0h.WSPD_FL
  - kind: values
    mode: step
    signals:
      - smart451/ICL_3A2h.SPEED_DISP
`;

const DOC: ViewDoc = {
  kipscope: "view",
  version: 1,
  title: "Hard acceleration, drive 3",
  note: "BRK_LMP brake release 2–4 s before SPEED_DISP rises",
  saved: "2026-10-17T08:14:03Z",
  data: ["smart451"],
  linkTime: true,
  cursors: { a: "2026-10-13T13:08:01.5Z", b: "2026-10-13T13:08:09.25Z", diff: true },
  digits: 3,
  measurement: { object: "smart451" },
  events: { filter: "active changes", signals: ["smart451/DCU_1F4h.IgnMode"] },
  colors: { "smart451/ICL_3A2h.SPEED_DISP": 0, "smart451/BRK_1A0h.WSPD_FL": 1 },
  windows: [
    {
      kind: "timeseries",
      title: "Speeds",
      from: "2026-10-13T13:08:00Z",
      to: "2026-10-13T13:08:20Z",
      mode: "line",
      envelope: false,
      signals: ["smart451/ICL_3A2h.SPEED_DISP", "smart451/BRK_1A0h.WSPD_FL"],
    },
    { kind: "values", mode: "step", signals: ["smart451/ICL_3A2h.SPEED_DISP"] },
  ],
};

const attempt = <T>(fn: () => T): T | undefined => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};

describe("ViewStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kipscope-viewstore-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes the canonical YAML form", () => {
    const store = new ViewStore(dir);
    store.write("drive-3", DOC);
    expect(readFileSync(join(dir, "drive-3.yaml"), "utf8")).toBe(CANONICAL);
    expect(store.read("drive-3")).toBe(CANONICAL);
  });

  it("omits absent optional fields and keeps the key order", () => {
    const store = new ViewStore(dir);
    const { note: _n, saved: _s, measurement: _m, events: _e, colors: _c, ...rest } = DOC;
    store.write("bare", rest);
    const text = store.read("bare") ?? "";
    expect(text).not.toMatch(/^(note|saved|measurement|events|colors):/m);
    const keys = [...text.matchAll(/^([a-zA-Z]+):/gm)].map((m) => m[1]);
    expect(keys).toEqual([
      "kipscope",
      "version",
      "title",
      "data",
      "linkTime",
      "cursors",
      "digits",
      "windows",
    ]);
  });

  it("reads back what it wrote, YAML timestamps staying strings", () => {
    const store = new ViewStore(dir);
    store.write("drive-3", DOC);
    const parsed = store.get("drive-3");
    expect(parsed?.ok).toBe(true);
    if (parsed?.ok) {
      // Same instants; the fraction may be spelled .5Z or .500Z (design example vs toIso).
      expect({ ...parsed.doc, cursors: undefined }).toEqual({ ...DOC, cursors: undefined });
      expect(Date.parse(parsed.doc.cursors.a ?? "")).toBe(Date.parse("2026-10-13T13:08:01.5Z"));
      expect(Date.parse(parsed.doc.cursors.b ?? "")).toBe(Date.parse("2026-10-13T13:08:09.25Z"));
      expect(parsed.doc.cursors.diff).toBe(true);
    }
  });

  it("checks names before building any path", () => {
    const store = new ViewStore(dir);
    for (const name of ["../x", "a.b", "-x", "A", "a/b", ""]) {
      expect(() => store.write(name, DOC)).toThrow();
      // Reads of a bad name either throw or find nothing; they never reach a file.
      expect(attempt(() => store.read(name))).toBeUndefined();
      expect(attempt(() => store.exists(name)) ?? false).toBe(false);
    }
    // `_previous` is the one name beyond VIEW_NAME that the store itself writes.
    store.write("_previous", DOC);
    expect(store.exists("_previous")).toBe(true);
  });

  it("lists newest first, no `saved` last, `_previous` always last", () => {
    const store = new ViewStore(dir);
    store.write("old", { ...DOC, title: "Old", saved: "2026-10-01T00:00:00Z" });
    store.write("new", { ...DOC, title: "New", saved: "2026-10-17T00:00:00Z" });
    const { saved: _s, ...undated } = DOC;
    store.write("undated", { ...undated, title: "Undated" });
    store.write("_previous", { ...DOC, title: "Before last open", saved: "2030-01-01T00:00:00Z" });
    expect(store.list().map((v) => v.name)).toEqual(["new", "old", "undated", "_previous"]);
  });

  it("removes a view", () => {
    const store = new ViewStore(dir);
    store.write("gone", DOC);
    store.remove("gone");
    expect(store.exists("gone")).toBe(false);
    expect(store.read("gone")).toBeUndefined();
  });
});
