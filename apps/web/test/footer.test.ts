import type { Measurement, ServerMeta } from "@kipscope/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fitFooter } from "../src/footer/fit.ts";
import { footerItems, measurementItems } from "../src/footer/items.ts";
import { StatusBar } from "../src/footer/StatusBar.tsx";

// Static markup has no layout, so the bar never hides anything on its own; the tooltip test below
// scripts the fit's answer. Everything else runs the real fitFooter.
vi.mock("../src/footer/fit.ts", async (importActual) => {
  const actual = await importActual<typeof import("../src/footer/fit.ts")>();
  return { ...actual, fitFooter: vi.fn(actual.fitFooter) };
});

const ZONE = { name: "Europe/Berlin", offsetMinutes: 120 };

function metaOf(over: Partial<ServerMeta> = {}): ServerMeta {
  return {
    build: { commit: "7c1e2a9", dirty: true, startedAt: "2026-10-16T13:07:10.000Z" },
    source: {
      kind: "clickhouse",
      database: "sdlog",
      table: "signals",
      reachable: true,
      checkedAt: "2026-10-16T13:08:01.000Z",
    },
    catalog: { state: "loaded", size: 1234, loadedAt: "2026-10-16T13:07:12.000Z" },
    ...over,
  };
}

const find = (items: { key: string }[], key: string) => {
  const item = items.find((i) => i.key === key) as ReturnType<typeof footerItems>[number];
  if (!item) throw new Error(`no item ${key} in ${items.map((i) => i.key).join(",")}`);
  return item;
};

describe("measurement items (app-footer)", () => {
  it("shows nothing without measurement info", () => {
    expect(measurementItems(undefined).items).toEqual([]);
    expect(measurementItems({}).items).toEqual([]);
    const html = renderToStaticMarkup(createElement(StatusBar, barProps()));
    expect(html).not.toContain("Measurement");
    expect(textOf(html)).toBe(
      "connected · revision 7 KIPscope · © 2026 Jan Kipping, Agentic engineer · kipp.ing · AAL",
    );
  });

  it("turns measurement info into footer items", () => {
    const route = "0123456789".repeat(6);
    expect(route).toHaveLength(60);
    const m: Measurement = {
      name: "Testfahrt A9",
      object: "smart451",
      meta: [
        { key: "driver", value: "Jan" },
        { key: "route", value: route },
      ],
    };
    const { items, title } = measurementItems(m);
    // "route: " (7 characters) plus the first 32 digits, then the ellipsis: 40 characters.
    expect(items.map((i) => i.text)).toEqual([
      "Testfahrt A9",
      "smart451",
      "driver: Jan",
      "route: 01234567890123456789012345678901…",
    ]);
    expect(Array.from(items[3]?.text ?? "")).toHaveLength(40);
    // Group tooltip: every field in full, one per line.
    expect(title.split("\n")).toEqual([
      "Measurement: Testfahrt A9",
      "Object: smart451",
      "driver: Jan",
      `route: ${route}`,
    ]);
    // Each item carries the group tooltip; ranks of design F3 (last entry hides first).
    for (const item of items) expect(item.title).toBe(title);
    expect(items.map((i) => i.rank)).toEqual([22, 21, 5, 4]);

    // Absent fields leave out their tooltip lines and items.
    const only = measurementItems({ object: "smart451" });
    expect(only.items.map((i) => i.text)).toEqual(["smart451"]);
    expect(only.title).toBe("Object: smart451");
  });
});

describe("automatic meta items (app-footer)", () => {
  it("turns meta into footer items", () => {
    const items = footerItems(metaOf(), false, ZONE, new Date("2026-10-16T13:30:00.000Z"));
    expect(items.map((i) => i.text)).toEqual([
      "ClickHouse sdlog",
      "1234 signals",
      "Europe/Berlin",
      "7c1e2a9*",
    ]);
    expect(items.map((i) => i.key)).toEqual(["source", "catalog", "zone", "build"]);
    expect(find(items, "source").tone).toBe("ok");
    expect(find(items, "zone").title).toContain("UTC+02:00");
    expect(find(items, "build").title).toContain("uncommitted changes");
    expect(find(items, "build").title).toContain("7c1e2a9");
    // Ranks of design F3: build 1, zone 2, catalog 3, source 20.
    expect(items.map((i) => i.rank)).toEqual([20, 3, 2, 1]);

    const clean = footerItems(
      metaOf({ build: { commit: "7c1e2a9", dirty: false, startedAt: "2026-10-16T13:07:10.000Z" } }),
      false,
      ZONE,
    );
    expect(find(clean, "build").text).toBe("7c1e2a9");
    expect(find(clean, "build").title).not.toContain("uncommitted");
  });

  it("shows unreachable, loading and failed meta", () => {
    const down = metaOf({
      build: { commit: null, dirty: false, startedAt: "2026-10-16T13:07:10.000Z" },
      source: {
        kind: "clickhouse",
        database: "sdlog",
        table: "signals",
        reachable: false,
        checkedAt: "2026-10-16T13:08:01.000Z",
        error: "connect ECONNREFUSED",
      },
      catalog: { state: "loading", size: 0, reason: "still loading: the first refresh" },
    });
    const items = footerItems(down, false, ZONE);
    expect(find(items, "source")).toMatchObject({
      text: "ClickHouse sdlog unreachable",
      tone: "error",
    });
    expect(find(items, "source").title).toContain("connect ECONNREFUSED");
    expect(find(items, "catalog")).toMatchObject({ text: "catalog loading", tone: "muted" });
    expect(items.some((i) => i.key === "build")).toBe(false);

    const failed = footerItems(
      metaOf({
        catalog: { state: "failed", size: 0, reason: "source unreachable: connect ECONNREFUSED" },
      }),
      false,
      ZONE,
    );
    expect(find(failed, "catalog")).toMatchObject({
      text: "catalog unavailable",
      tone: "error",
      title: "source unreachable: connect ECONNREFUSED",
    });
  });

  it("marks stale meta and shows none before the first answer", () => {
    const stale = footerItems(metaOf(), true, ZONE);
    expect(find(stale, "source").tone).toBe("muted");
    expect(find(stale, "source").title.startsWith("last known; server not reachable")).toBe(true);
    // Fresh meta does not carry the prefix.
    expect(find(footerItems(metaOf(), false, ZONE), "source").title).not.toContain("last known");
    expect(footerItems(undefined, false, ZONE)).toEqual([]);
    expect(footerItems(undefined, true, ZONE)).toEqual([]);
  });
});

describe("fitFooter (app-footer)", () => {
  const base = { status: 160, attribution: 360, gap: 12 };
  const auto = [
    { key: "source", width: 100, rank: 20 },
    { key: "catalog", width: 80, rank: 3 },
    { key: "zone", width: 90, rank: 2 },
    { key: "build", width: 60, rank: 1 },
  ];

  it("hides whole meta items in a fixed order", () => {
    const at = (available: number) => fitFooter({ ...base, available, items: auto });
    expect(at(1000)).toEqual({ shown: ["source", "catalog", "zone", "build"], wrap: false });
    expect(at(900)).toEqual({ shown: ["source", "catalog", "zone"], wrap: false });
    expect(at(800)).toEqual({ shown: ["source", "catalog"], wrap: false });
    expect(at(700)).toEqual({ shown: ["source"], wrap: false });
    expect(at(600)).toEqual({ shown: [], wrap: false });
    // 160 + 12 + 360 = 532 > 500: the attribution wraps, three items stay on the first line.
    expect(at(500)).toEqual({ shown: ["source", "catalog", "zone"], wrap: true });
  });

  it("lets a message push out meta items before it truncates", () => {
    const withMessage = (message: number) =>
      fitFooter({ ...base, available: 1000, message, items: auto });
    expect(withMessage(300)).toEqual({ shown: ["source"], wrap: false });
    expect(withMessage(900)).toEqual({ shown: [], wrap: false });
  });

  it("hides automatic items before measurement items", () => {
    const items = [
      { key: "m:name", width: 100, rank: 22 },
      { key: "m:object", width: 70, rank: 21 },
      { key: "m:meta:driver", width: 80, rank: 5 },
      { key: "m:meta:weather", width: 100, rank: 4 },
      { key: "source", width: 100, rank: 20 },
      { key: "catalog", width: 80, rank: 3 },
      { key: "zone", width: 90, rank: 2 },
      { key: "build", width: 60, rank: 1 },
    ];
    const at = (available: number) => fitFooter({ ...base, available, items });
    expect(at(1000)).toEqual({
      shown: ["m:name", "m:object", "m:meta:driver", "source"],
      wrap: false,
    });
    expect(at(900)).toEqual({ shown: ["m:name", "m:object", "source"], wrap: false });
    expect(at(800)).toEqual({ shown: ["m:name", "m:object"], wrap: false });
  });
});

// --- Status bar markup -------------------------------------------------------------------------

function barProps(over: Record<string, unknown> = {}) {
  return {
    connected: true,
    revision: 7,
    onDismissMessage: () => {},
    metaStale: false,
    dragging: false,
    over: false,
    dropRef: { current: null },
    ...over,
  } as Parameters<typeof StatusBar>[0];
}

const render = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(StatusBar, barProps(over)));

/** Visible text of the markup with tags removed and spaces collapsed. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

describe("status bar markup (app-footer)", () => {
  it("orders status, measurement, meta and attribution", () => {
    const html = render({
      measurement: { name: "Testfahrt A9" },
      meta: metaOf(),
    });
    const text = textOf(html);
    const order = [
      "connected · revision 7",
      "Testfahrt A9",
      "ClickHouse sdlog",
      "KIPscope · © 2026",
    ].map((part) => text.indexOf(part));
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    // One strip element; the attribution group is its last child. The hidden measuring copy
    // (aria-hidden, design F5) is not content and is left out of the check.
    expect(html.match(/<div[^>]*class="status-strip/g)).toHaveLength(1);
    const content = html.replace(/<div[^>]*status-measure[^>]*>.*?<\/div>/s, "");
    expect(content).toContain('<span class="attribution"');
    expect(content.endsWith("AAL</a></span></div>")).toBe(true);
    expect(content.lastIndexOf('<span class="attribution"')).toBeGreaterThan(
      content.indexOf("ClickHouse sdlog"),
    );
  });

  it("renders the attribution with both links", () => {
    const html = render();
    expect(textOf(html)).toContain(
      "KIPscope · © 2026 Jan Kipping, Agentic engineer · kipp.ing · AAL",
    );
    const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
    const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];
    const site = anchors.find((a) => attr(a, "href") === "https://kipp.ing");
    const licence = anchors.find((a) => attr(a, "href") === "/api/license");
    for (const [tag, title] of [
      [site, "efficient agentic engineering"],
      [licence, "Attribution Assurance License"],
    ] as const) {
      expect(tag, title).toBeDefined();
      expect(attr(tag as string, "target")).toBe("_blank");
      expect(attr(tag as string, "rel")).toBe("noopener noreferrer");
      expect(attr(tag as string, "title")).toBe(title);
    }
    expect(html).toMatch(/>kipp\.ing<\/a>/);
    expect(html).toMatch(/>AAL<\/a>/);
  });

  it("lists hidden items in the KIPscope tooltip", () => {
    // Without hidden items the leading KIPscope has no tooltip.
    const plain = render({ meta: metaOf() });
    expect(plain).toMatch(/<span>KIPscope<\/span>/);

    // The fit hides build and zone: their texts, one per line.
    vi.mocked(fitFooter).mockReturnValueOnce({ shown: ["source", "catalog"], wrap: false });
    const html = render({ meta: metaOf() });
    const title = /<span title="([^"]*)">KIPscope<\/span>/.exec(html)?.[1];
    expect(title).toBeDefined();
    const lines = (title as string).replace(/&#10;|&#xA;/gi, "\n").split("\n");
    expect(lines).toEqual(["Europe/Berlin", "7c1e2a9*"]);
    // Hidden items are not rendered in the visible part.
    const content = html.replace(/<div[^>]*status-measure[^>]*>.*?<\/div>/s, "");
    expect(content).not.toContain("7c1e2a9*</span>");
    expect(content).toContain("1234 signals");
  });
});
