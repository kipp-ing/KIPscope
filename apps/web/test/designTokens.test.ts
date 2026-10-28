import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// No layout engine in the web test setup, so these read the stylesheet text: the declared value a
// browser would compute for the scenario's selector. Expected colours come from the spec (slate).
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function rule(selector: string): string {
  const re = new RegExp(
    `(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
  );
  const m = css.match(re);
  if (!m) throw new Error(`no rule ${selector}`);
  return m[1] as string;
}

function token(name: string): string {
  const m = rule(":root").match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`no token ${name}`);
  return (m[1] as string).trim();
}

const decl = (body: string, prop: string) =>
  [...body.matchAll(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+);`, "g"))].map((m) =>
    (m[1] as string).trim(),
  );

describe("design-language: page background (slate-50)", () => {
  it("--bg is slate-50 rgb(248, 250, 252)", () => {
    expect(token("--bg").toLowerCase()).toBe("#f8fafc");
  });

  it("body (not only :root) paints the page background from --bg", () => {
    expect(decl(rule("body"), "background")).toContain("var(--bg)");
  });
});

describe("design-language: footer top divider is a real border", () => {
  it("--border is slate-200 rgb(226, 232, 240)", () => {
    expect(token("--border").toLowerCase()).toBe("#e2e8f0");
  });

  it("idle .status-strip has border-top-color var(--border), not transparent", () => {
    const body = rule(".status-strip");
    const top = [...decl(body, "border-top"), ...decl(body, "border-top-color")].join(" ");
    expect(top).toContain("var(--border)");
  });

  it("border plus top padding is the same 4 px idle and during a drag (no layout shift)", () => {
    // Cascade by hand: .drop inherits padding from the idle rule where it declares none.
    const padTop = (body: string) => {
      const pt = decl(body, "padding-top");
      if (pt.length) return Number.parseFloat(pt[pt.length - 1] as string);
      const all = decl(body, "padding");
      return all.length
        ? Number.parseFloat((all[all.length - 1] as string).split(/\s+/)[0] as string)
        : null;
    };
    const top = (body: string) => {
      const w =
        decl(body, "border-top")
          .join(" ")
          .match(/(\d+)px/) ??
        decl(body, "border")
          .join(" ")
          .match(/(\d+)px/);
      return Number(w?.[1]);
    };
    const idle = rule(".status-strip");
    const drag = rule(".status-strip.drop");
    expect(top(idle) + (padTop(idle) ?? 0)).toBe(4);
    expect(top(drag) + (padTop(drag) ?? padTop(idle) ?? 0)).toBe(4);
  });
});

describe("design-language: icon colours", () => {
  it("--label is slate-700 rgb(51, 65, 85)", () => {
    expect(token("--label").toLowerCase()).toBe("#334155");
  });

  it("sidebar button icon is slate-700", () => {
    // The option bar's sidebar button takes its colour from --label like Reset, not from --text.
    const colours = decl(rule(".option-bar-slot .sidebar-toggle"), "color");
    expect(colours.at(-1)).toBe("var(--label)");
  });
});
