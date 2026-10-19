import type { Me, Measurement, ServerMeta } from "@kipscope/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fitFooter } from "../src/footer/fit.ts";
import { footerItems, measurementItems } from "../src/footer/items.ts";
import { contentWidth, StatusBar } from "../src/footer/StatusBar.tsx";
import { metaLoader } from "../src/footer/useMeta.ts";

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
    catalog: { mode: "full", state: "loaded", size: 1234, loadedAt: "2026-10-16T13:07:12.000Z" },
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
    expect(textOf(html)).toBe("connected · revision 7 KIPscope · kipp.ing · AAL");
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

describe("signed-in user item (app-footer)", () => {
  const alice: Me = {
    user: "alice",
    identity: "oidc",
    roles: ["testers", "viewers"],
    rights: { data: ["test*"], share: false },
  };

  it("shows the signed-in user", () => {
    const base = footerItems(metaOf(), false, ZONE);
    expect(base.map((i) => i.key)).toEqual(["source", "catalog", "zone", "build"]);

    const withAlice = footerItems(metaOf(), false, ZONE, new Date(), alice);
    // The four items of "Items from meta", then the user.
    expect(withAlice.slice(0, 4).map((i) => i.text)).toEqual(base.map((i) => i.text));
    expect(withAlice).toHaveLength(5);
    const user = withAlice.at(-1);
    expect(user?.text).toBe("alice");
    expect(user?.title).toBe("Signed in as alice (oidc) · roles: testers, viewers");

    const bob = footerItems(metaOf(), false, ZONE, new Date(), {
      ...alice,
      user: "bob",
      roles: [],
    });
    expect(bob.at(-1)?.text).toBe("bob");
    expect(bob.at(-1)?.title).toBe("Signed in as bob (oidc) · roles: none");

    // No user item with the identity none, and none without `me`.
    const local: Me = {
      user: "local",
      identity: "none",
      roles: [],
      rights: { data: ["*"], share: true },
    };
    expect(footerItems(metaOf(), false, ZONE, new Date(), local).map((i) => i.key)).toEqual(
      base.map((i) => i.key),
    );
    expect(footerItems(metaOf(), false, ZONE, new Date(), undefined)).toHaveLength(4);
  });

  it("shows a module adapter's kind in the tooltip", () => {
    const items = footerItems(metaOf(), false, ZONE, new Date(), {
      ...alice,
      identity: "forward-header",
      roles: ["cars"],
    });
    expect(items.at(-1)?.title).toBe("Signed in as alice (forward-header) · roles: cars");
  });

  it("keeps the user item longer than build, zone and catalog when the line is short", () => {
    const items = footerItems(metaOf(), false, ZONE, new Date(), alice);
    const rank = (key: string) => items.find((i) => i.key === key)?.rank ?? -1;
    expect(rank("user")).toBeGreaterThan(rank("build"));
    expect(rank("user")).toBeGreaterThan(rank("zone"));
    expect(rank("user")).toBeGreaterThan(rank("catalog"));
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

  it("labels ADX and unknown source kinds", () => {
    const sourceOf = (kind: string, database: string, reachable: boolean) =>
      metaOf({
        source: {
          kind,
          database,
          table: "signals",
          reachable,
          checkedAt: "2026-10-17T10:00:00.000Z",
          ...(reachable ? {} : { error: "connect ECONNREFUSED" }),
        },
      });
    const sourceItem = (meta: ServerMeta) => find(footerItems(meta, false, ZONE), "source");

    // ADX is labelled, ok when reachable and unreachable in the error tone when not.
    expect(sourceItem(sourceOf("adx", "kipscope_test", true))).toMatchObject({
      text: "ADX kipscope_test",
      tone: "ok",
    });
    expect(sourceItem(sourceOf("adx", "kipscope_test", false))).toMatchObject({
      text: "ADX kipscope_test unreachable",
      tone: "error",
    });
    // Any other kind shows as the adapter named it.
    expect(sourceItem(sourceOf("memory", "fixture", true))).toMatchObject({
      text: "memory fixture",
      tone: "ok",
    });
    // ClickHouse keeps its label.
    expect(sourceItem(sourceOf("clickhouse", "sdlog", true)).text).toBe("ClickHouse sdlog");
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
      catalog: {
        mode: "full",
        state: "loading",
        size: 0,
        reason: "still loading: the first refresh",
      },
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
        catalog: {
          mode: "full",
          state: "failed",
          size: 0,
          reason: "source unreachable: connect ECONNREFUSED",
        },
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

  it("shows No scope for a scoped catalog without a scope (add-scope)", () => {
    const items = footerItems(
      metaOf({ catalog: { mode: "scoped", state: "no_scope", size: 0 } }),
      false,
      ZONE,
    );
    expect(find(items, "catalog")).toMatchObject({ text: "No scope" });
    // With a scope the list's size shows as for any loaded catalog.
    const scoped = footerItems(
      metaOf({
        catalog: {
          mode: "scoped",
          state: "loaded",
          size: 2300,
          loadedAt: "2026-10-16T13:07:12.000Z",
          scope: { dataRef: "smart451", from: "1", to: "2" },
        },
      }),
      false,
      ZONE,
    );
    expect(find(scoped, "catalog").text).toContain("2300");
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
  // Attribution about the width of `KIPscope · kipp.ing · AAL` at 11 px.
  const base = { status: 160, attribution: 140, gap: 12 };
  const auto = [
    { key: "source", width: 100, rank: 20 },
    { key: "catalog", width: 80, rank: 3 },
    { key: "zone", width: 90, rank: 2 },
    { key: "build", width: 60, rank: 1 },
  ];

  it("hides whole meta items in a fixed order", () => {
    const at = (available: number) => fitFooter({ ...base, available, items: auto });
    expect(at(780)).toEqual({ shown: ["source", "catalog", "zone", "build"], wrap: false });
    expect(at(680)).toEqual({ shown: ["source", "catalog", "zone"], wrap: false });
    expect(at(580)).toEqual({ shown: ["source", "catalog"], wrap: false });
    expect(at(480)).toEqual({ shown: ["source"], wrap: false });
    expect(at(380)).toEqual({ shown: [], wrap: false });
    // 160 + 12 + 140 = 312 > 280: the attribution wraps, source stays on the first line.
    expect(at(280)).toEqual({ shown: ["source"], wrap: true });
  });

  it("lets a message push out meta items before it truncates", () => {
    const withMessage = (message: number) =>
      fitFooter({ ...base, available: 780, message, items: auto });
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
    expect(at(780)).toEqual({
      shown: ["m:name", "m:object", "m:meta:driver", "source"],
      wrap: false,
    });
    expect(at(680)).toEqual({ shown: ["m:name", "m:object", "source"], wrap: false });
    expect(at(580)).toEqual({ shown: ["m:name", "m:object"], wrap: false });
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
      "KIPscope · kipp.ing · AAL",
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
    expect(textOf(html)).toContain("KIPscope · kipp.ing · AAL");
    expect(textOf(html)).not.toContain("Jan Kipping");
    const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
    const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];
    const site = anchors.find((a) => attr(a, "href") === "https://kipp.ing");
    const licence = anchors.find((a) => attr(a, "href") === "/api/license");
    for (const [tag, title] of [
      [site, "© 2026 Jan Kipping, Agentic engineer · efficient agentic engineering"],
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

describe("meta loader (app-footer)", () => {
  type State = { meta?: ServerMeta; stale: boolean };
  /** A loader over scripted fetches; `settle(i)` resolves or rejects the i-th fetch. */
  function harness(abort = new AbortController()) {
    const pending: { resolve: (m: ServerMeta) => void; reject: (e: unknown) => void }[] = [];
    let state: State = { stale: false };
    const load = metaLoader(
      () =>
        new Promise<ServerMeta>((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
      (update) => {
        state = update(state);
      },
      abort.signal,
    );
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    return { load, pending, flush, state: () => state, abort };
  }
  const older = metaOf({
    build: { commit: "1111111", dirty: false, startedAt: "2026-10-16T13:00:00.000Z" },
  });
  const newer = metaOf({
    build: { commit: "2222222", dirty: false, startedAt: "2026-10-16T14:00:00.000Z" },
  });

  it("drops an older answer that arrives after a newer one", async () => {
    const h = harness();
    h.load();
    h.load();
    h.pending[1]?.resolve(newer);
    await h.flush();
    h.pending[0]?.resolve(older);
    await h.flush();
    expect(h.state()).toEqual({ meta: newer, stale: false });
  });

  it("drops an older failure, so a newer success is not marked stale", async () => {
    const h = harness();
    h.load();
    h.load();
    h.pending[1]?.resolve(newer);
    await h.flush();
    h.pending[0]?.reject(new Error("timeout"));
    await h.flush();
    expect(h.state()).toEqual({ meta: newer, stale: false });
  });

  it("keeps a newer failure over an older success that arrives later", async () => {
    const h = harness();
    h.load();
    h.pending[0]?.resolve(older);
    await h.flush();
    h.load();
    h.load();
    h.pending[2]?.reject(new Error("offline"));
    await h.flush();
    h.pending[1]?.resolve(newer);
    await h.flush();
    expect(h.state()).toEqual({ meta: older, stale: true });
  });

  it("ignores answers after the abort", async () => {
    const h = harness();
    h.load();
    h.abort.abort();
    h.pending[0]?.reject(new DOMException("aborted", "AbortError"));
    await h.flush();
    expect(h.state()).toEqual({ stale: false });
  });
});

describe("bar content width (app-footer)", () => {
  const style = {
    borderLeftWidth: "2px",
    borderRightWidth: "2px",
    paddingLeft: "8px",
    paddingRight: "8px",
  };

  it("keeps the sub-pixel part of the bar's width", () => {
    expect(contentWidth(1407.6, style)).toBeCloseTo(1387.6, 6);
    expect(contentWidth(100, { ...style, borderLeftWidth: "", paddingRight: "auto" })).toBe(90);
  });

  it("does not clip the last item of a sub-pixel fit", () => {
    // Status, attribution and items need 1387.25 px; the bar's content box is 1387.4 px, while the
    // integer clientWidth (1403.4 rounded down, minus padding) would give 1387 and hide the build.
    const parts = {
      status: 150.25,
      attribution: 200,
      gap: 12,
      items: [
        { key: "name", width: 500, rank: 22 },
        { key: "build", width: 501, rank: 1 },
      ],
    };
    const available = contentWidth(1407.4, style);
    expect(fitFooter({ available, ...parts })).toEqual({ shown: ["name", "build"], wrap: false });
    expect(fitFooter({ available: 1403 - 16, ...parts }).shown).toEqual(["name"]);
  });
});
