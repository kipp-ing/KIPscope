import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/chart/window.css", import.meta.url), "utf8");

/** The declarations of every rule whose selector matches `selector`, comments removed. */
function rulesFor(selector: RegExp): string[] {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  for (const m of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selector.test(m[1] as string)) out.push(m[2] as string);
  }
  return out;
}

describe("legend status column (D-095, DW13)", () => {
  // No layout in the tests, so the CSS source is read: the status cell ("loading", "missing",
  // "error") has one fixed width, so a signal changing from loading to complete moves no column.
  it("gives the status cell a fixed width in the legend", () => {
    const decls = rulesFor(/\.signals[^,{]*\.status\b/).join("\n");
    expect(decls, "a rule for the legend's .status cell").not.toBe("");
    const fixed = /(?:^|[\s;])(?:min-width|width|flex-basis):\s*(\d+(?:\.\d+)?)(px|ch|em|rem)\b/;
    expect(decls).toMatch(fixed);
    expect(decls).not.toMatch(/(?:^|[\s;])width:\s*(?:auto|max-content|min-content|fit-content)/);
  });
});

describe("SNA column and row structure (D-095, DW12 Probe during a step)", () => {
  const src = readFileSync(new URL("../src/chart/TimeseriesWindow.tsx", import.meta.url), "utf8");
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("gives the .sna cell a fixed px or ch width, cut instead of grown", () => {
    // The rule for `.signals .sna` itself, not the pill rule that only matches a filled cell.
    const decls = [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) =>
        (m[1] as string).split(",").some((sel) => /\.signals\s+\.sna\s*$/.test(sel.trim())),
      )
      .map((m) => m[2] as string)
      .join("\n");
    expect(decls, "a rule for the legend's .sna cell").not.toBe("");
    expect(decls).toMatch(/(?:^|[\s;])(?:min-width|width|flex-basis):\s*\d+(?:\.\d+)?(?:px|ch)\b/);
    expect(decls).not.toMatch(/(?:^|[\s;])width:\s*(?:auto|max-content|min-content|fit-content)/);
    expect(decls).toMatch(/overflow:\s*hidden/);
  });

  // The row is one JSX block; no layout in the tests, so its source is read. A missing signal
  // renders the same cells as a loaded one, so the legend keeps its column count.
  const row = src.slice(
    src.indexOf("<li\n              key={s.id}"),
    src.indexOf("{w.signals.length === 0"),
  );

  it("renders the status and SNA cells for every row, loaded or missing", () => {
    expect(row.length).toBeGreaterThan(0);
    // Status: a span always rendered (not behind `&&` or `?`), its class carrying the missing state.
    const status = row.indexOf("className={`status ");
    expect(status, "the status cell").toBeGreaterThan(-1);
    const before = row
      .slice(0, row.lastIndexOf("<span", status))
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .trimEnd();
    expect(before).toMatch(/\/>$|<\/span>$/);
    expect(row).toMatch(/missing \? "missing"/);
    // SNA: both branches of the ternary render a `.sna` span, the empty one without a share.
    expect(row).toMatch(
      /sna \? \(\s*<span className="sna sna-share"[\s\S]*?<\/span>\s*\) : \(\s*<span className="sna" \/>\s*\)/,
    );
    // The unit and the live cell are not conditional on the signal's state either.
    expect(row).toMatch(/<span\s+className="unit"/);
    expect(row).toContain("<LiveCell");
    expect(row).toMatch(/className="remove"/);
  });

  it("counts six fixed legend columns plus the readout ones, as the header and row render", () => {
    // Row: grip, unit, live, status, sna, remove; the header: next-hint (2 tracks) + 4 spans.
    expect(src).toMatch(
      /const columns = 6 \+ \(readout \? 1 \+ \(showB \? 1 : 0\) \+ \(diff \? 1 : 0\) : 0\);/,
    );
    const head = src.slice(
      src.indexOf('<li className="legend-head">'),
      src.indexOf("</li>", src.indexOf('<li className="legend-head">')),
    );
    expect(head.match(/^\s*<span \/>$/gm)?.length).toBe(4);
    expect(css).toMatch(/\.next-hint\s*\{[^}]*grid-column:\s*span 2/);
  });
});
