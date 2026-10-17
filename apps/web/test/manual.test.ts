import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMarkdown, unsupportedLines } from "../src/help/markdown.ts";

const SECTIONS = [
  "Start here",
  "Find a signal",
  "Chart a signal",
  "Compare signals",
  "Measure",
  "Move in time",
  "Events",
  "Read the display",
  "Keys",
  "Words",
];

describe("markdown subset", () => {
  it("parses the markdown subset", () => {
    const src = [
      "# T",
      "",
      "## S",
      "",
      "Press **bold** and `Shift+click` now.",
      "",
      "- one",
      "- two",
      "",
      "1. first",
      "2. second",
    ].join("\n");
    expect(parseMarkdown(src)).toEqual([
      { type: "h1", text: [{ type: "text", text: "T" }] },
      { type: "h2", text: [{ type: "text", text: "S" }] },
      {
        type: "p",
        text: [
          { type: "text", text: "Press " },
          { type: "bold", text: "bold" },
          { type: "text", text: " and " },
          { type: "code", text: "Shift+click" },
          { type: "text", text: " now." },
        ],
      },
      {
        type: "ul",
        items: [[{ type: "text", text: "one" }], [{ type: "text", text: "two" }]],
      },
      {
        type: "ol",
        items: [[{ type: "text", text: "first" }], [{ type: "text", text: "second" }]],
      },
    ]);

    // 1-based numbers of the lines the renderer cannot show.
    const bad = [
      "fine",
      "| a | b |",
      "> quote",
      "![img](x.png)",
      "```",
      "    indented",
      "<div>",
      "ok",
    ];
    expect(unsupportedLines(bad.join("\n"))).toEqual([2, 3, 4, 5, 6, 7]);
    expect(unsupportedLines(src)).toEqual([]);
  });

  it("has the task sections in order and only supported markdown", () => {
    const src = readFileSync(new URL("../../../docs/manual.md", import.meta.url), "utf8");
    expect(unsupportedLines(src)).toEqual([]);

    const blocks = parseMarkdown(src);
    const h2 = blocks
      .filter((b) => b.type === "h2")
      .map((b) => ("text" in b ? b.text.map((i) => i.text).join("") : ""));
    // Ten sections exactly (spec "Manual structure"); add-saved-views' "Save and share" section
    // would need the spec to change first.
    expect(h2).toEqual(SECTIONS);
    expect(blocks[0]?.type).toBe("h1");

    const words = src.split(/\s+/).filter(Boolean).length;
    console.log(`manual word count: ${words}`);
    expect(words, `manual has ${words} words`).toBeGreaterThanOrEqual(750);
    expect(words, `manual has ${words} words`).toBeLessThanOrEqual(3000);
  });

  it("names Span and Help among the items moving into the overflow menu (Top row)", () => {
    const src = readFileSync(new URL("../../../docs/manual.md", import.meta.url), "utf8");
    const line = src.split("\n").find((l) => l.includes("**Top row**")) ?? "";
    expect(line.length).toBeGreaterThan(0);
    const [, after = ""] = line.split(/on a narrow screen/i);
    expect(after, "no narrow-screen sentence in the Top row paragraph").not.toBe("");
    expect(after).toMatch(/Span/);
    expect(after).toMatch(/Help/i);
    expect(after).toContain("⋯");
  });
});
