import type { Me, Measurement, ServerMeta } from "@kipscope/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fitFooter } from "../src/footer/fit.ts";
import { footerItems, measurementItems, statusTooltip } from "../src/footer/items.ts";
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
    expect(textOf(html)).toBe("connected KIPscope · kipp.ing · AAL");
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
    canShare: false,
  };

  it("shows the signed-in user", () => {
    // Build, source and catalog are no items any more (app-footer "Automatic meta items").
    const base = footerItems(metaOf(), false, ZONE);
    expect(base.map((i) => i.key)).toEqual(["zone"]);

    const withAlice = footerItems(metaOf(), false, ZONE, new Date(), alice);
    // The zone of "Items from meta", then the user.
    expect(withAlice.map((i) => i.text)).toEqual(["Europe/Berlin", "alice"]);
    const user = withAlice.at(-1);
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
      canShare: true,
    };
    expect(footerItems(metaOf(), false, ZONE, new Date(), local).map((i) => i.text)).toEqual([
      "Europe/Berlin",
    ]);
    expect(footerItems(metaOf(), false, ZONE, new Date(), undefined).map((i) => i.text)).toEqual([
      "Europe/Berlin",
    ]);
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
    // A failed catalog is the only catalog state with an item beside `No scope`; the build has none.
    const failed = metaOf({
      catalog: { mode: "full", state: "failed", size: 0, reason: "source unreachable" },
    });
    const items = footerItems(failed, false, ZONE, new Date(), alice);
    const rank = (key: string) => items.find((i) => i.key === key)?.rank ?? -1;
    expect(items.some((i) => i.key === "build")).toBe(false);
    expect(rank("user")).toBeGreaterThan(rank("zone"));
    expect(rank("user")).toBeGreaterThan(rank("catalog"));
  });
});

describe("automatic meta items (app-footer)", () => {
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

  it("turns meta into footer items", () => {
    const items = footerItems(metaOf(), false, ZONE, new Date("2026-10-16T13:30:00.000Z"));
    // Reachable source, loaded catalog (1234 signals) and the dirty build 7c1e2a9 are no items.
    expect(items.map((i) => i.key)).toEqual(["zone"]);
    expect(items[0]?.text).toBe("Europe/Berlin");
    expect(items[0]?.title).toContain("UTC+02:00");
    expect(JSON.stringify(items)).not.toContain("7c1e2a9");
    expect(JSON.stringify(items)).not.toContain("1234");
  });

  it("labels ADX and unknown source kinds", () => {
    const firstLine = (meta: ServerMeta) => statusTooltip(4, meta, false).split("\n")[0] ?? "";
    const sourceItems = (meta: ServerMeta) =>
      footerItems(meta, false, ZONE).filter((i) => i.key === "source");

    // Reachable ADX: no item, the label leads the status tooltip.
    expect(sourceItems(sourceOf("adx", "kipscope_test", true))).toEqual([]);
    expect(firstLine(sourceOf("adx", "kipscope_test", true))).toContain("ADX kipscope_test");
    // Unreachable ADX: the item in the error tone.
    expect(sourceItems(sourceOf("adx", "kipscope_test", false))).toMatchObject([
      { text: "ADX kipscope_test unreachable", tone: "error" },
    ]);
    // Any other kind shows as the adapter named it, in the tooltip only.
    expect(sourceItems(sourceOf("memory", "fixture", true))).toEqual([]);
    expect(firstLine(sourceOf("memory", "fixture", true))).toContain("memory fixture");
    // ClickHouse keeps its label.
    expect(firstLine(sourceOf("clickhouse", "sdlog", true))).toContain("ClickHouse sdlog");
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
    // A loading catalog and a missing build are no items; the tooltip names the loading.
    expect(items.some((i) => i.key === "catalog")).toBe(false);
    expect(items.some((i) => i.key === "build")).toBe(false);
    expect(statusTooltip(4, down, false)).toContain("catalog loading");

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
    expect(find(items, "catalog")).toMatchObject({ text: "No scope", tone: "muted" });
    // With a scope the catalog is loaded: no item, the list's size is in the status tooltip.
    const scopedMeta = metaOf({
      catalog: {
        mode: "scoped",
        state: "loaded",
        size: 2300,
        loadedAt: "2026-10-16T13:07:12.000Z",
        scope: { dataRef: "smart451", from: "1", to: "2" },
      },
    });
    expect(footerItems(scopedMeta, false, ZONE).some((i) => i.key === "catalog")).toBe(false);
    expect(statusTooltip(4, scopedMeta, false)).toContain("2300");
  });

  it("marks stale meta and shows none before the first answer", () => {
    // The status tooltip carries the stale mark and the revision alone before the first answer.
    expect(statusTooltip(7, metaOf(), true).startsWith("last known; server not reachable")).toBe(
      true,
    );
    expect(statusTooltip(7, metaOf(), false)).not.toContain("last known");
    expect(statusTooltip(7, undefined, false)).toBe("revision 7");
    expect(statusTooltip(7, undefined, true)).toBe("revision 7");
    expect(footerItems(undefined, false, ZONE)).toEqual([]);
    expect(footerItems(undefined, true, ZONE)).toEqual([]);
    // An unreachable source of stale meta is muted and says so in its tooltip.
    const stale = find(footerItems(sourceOf("clickhouse", "sdlog", false), true, ZONE), "source");
    expect(stale.tone).toBe("muted");
    expect(stale.title.startsWith("last known; server not reachable")).toBe(true);
  });
});

describe("status tooltip (app-footer)", () => {
  it("puts revision, source, catalog and build into the status tooltip", () => {
    const meta = metaOf({
      build: { commit: "3e849e8", dirty: false, startedAt: "2026-10-16T13:07:10.000Z" },
      source: {
        kind: "clickhouse",
        database: "sdlog",
        table: "sig",
        reachable: true,
        checkedAt: "2026-10-16T13:08:01.000Z",
      },
      catalog: { mode: "full", state: "loaded", size: 415, loadedAt: "2026-10-16T13:07:12.000Z" },
    });
    const now = new Date("2026-10-16T13:30:00.000Z");
    const lines = statusTooltip(4, meta, false, now).split("\n");
    expect(lines[0]).toBe("revision 4 · ClickHouse sdlog · 415 signals · server 3e849e8");
    expect(lines.some((l) => l.startsWith("ClickHouse sdlog.sig · reachable · checked"))).toBe(
      true,
    );
    expect(lines.some((l) => l.startsWith("catalog loaded"))).toBe(true);
    expect(lines.some((l) => l.startsWith("server commit 3e849e8"))).toBe(true);

    // Dirty build and an unreachable source.
    const worse = metaOf({
      ...meta,
      build: { commit: "3e849e8", dirty: true, startedAt: "2026-10-16T13:07:10.000Z" },
      source: {
        kind: "clickhouse",
        database: "sdlog",
        table: "sig",
        reachable: false,
        checkedAt: "2026-10-16T13:08:01.000Z",
        error: "connect ECONNREFUSED",
      },
    });
    const second = statusTooltip(4, worse, false, now).split("\n");
    expect(second[0]).toContain("server 3e849e8*");
    expect(second.some((l) => l.includes("connect ECONNREFUSED"))).toBe(true);
    expect(second.some((l) => l.includes("uncommitted changes at start"))).toBe(true);
  });
});

describe("fitFooter (app-footer)", () => {
  // Status `connected` about 110 px, attribution about 140 px (`KIPscope · kipp.ing · AAL` at 11 px).
  const base = { status: 110, attribution: 140, gap: 12 };
  const auto = [
    { key: "source", width: 160, rank: 20 },
    { key: "zone", width: 90, rank: 2 },
    { key: "user", width: 60, rank: 19 },
  ];

  it("hides whole meta items in a fixed order", () => {
    const at = (available: number) => fitFooter({ ...base, available, items: auto });
    expect(at(620)).toEqual({ shown: ["source", "zone", "user"], wrap: false });
    expect(at(600)).toEqual({ shown: ["source", "user"], wrap: false });
    expect(at(500)).toEqual({ shown: ["source"], wrap: false });
    expect(at(420)).toEqual({ shown: [], wrap: false });
    // 110 + 12 + 140 = 262 > 240: the attribution wraps.
    expect(at(240).wrap).toBe(true);
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
      { key: "zone", width: 90, rank: 2 },
    ];
    const at = (available: number) => fitFooter({ ...base, available, items });
    const keys = (available: number) => at(available).shown;
    expect(keys(780)).toEqual(["m:name", "m:object", "m:meta:driver", "m:meta:weather", "zone"]);
    expect(keys(700)).toEqual(["m:name", "m:object", "m:meta:driver", "m:meta:weather"]);
    expect(keys(640)).toEqual(["m:name", "m:object", "m:meta:driver"]);
    expect(keys(540)).toEqual(["m:name", "m:object"]);
    for (const available of [780, 700, 640, 540]) expect(at(available).wrap).toBe(false);
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
    const order = ["connected", "Testfahrt A9", "Europe/Berlin", "KIPscope · kipp.ing · AAL"].map(
      (part) => text.indexOf(part),
    );
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Revision and source are in the status tooltip, not in the text.
    expect(text).not.toContain("revision");
    expect(text).not.toContain("ClickHouse sdlog");
    const conn = /<span[^>]*class="conn[^"]*"[^>]*>/.exec(html)?.[0] ?? "";
    const title = /title="([^"]*)"/.exec(conn)?.[1] ?? "";
    expect(title).toContain("revision 7");
    expect(title).toContain("ClickHouse sdlog");

    // One strip element; the attribution group is its last child. The hidden measuring copy
    // (aria-hidden, design F5) is not content and is left out of the check.
    expect(html.match(/<div[^>]*class="status-strip/g)).toHaveLength(1);
    const content = html.replace(/<div[^>]*status-measure[^>]*>.*?<\/div>/s, "");
    expect(content).toContain('<span class="attribution"');
    expect(content.endsWith("AAL</a></span></div>")).toBe(true);
    expect(content.lastIndexOf('<span class="attribution"')).toBeGreaterThan(
      content.indexOf("Europe/Berlin"),
    );
  });

  it("shows connected and disconnected without the revision", () => {
    expect(textOf(render({ connected: false }))).toContain("disconnected");
    const down = render({ connected: false, meta: metaOf() });
    expect(textOf(down)).not.toContain("revision");
    const conn = /<span[^>]*class="conn[^"]*"[^>]*>/.exec(down)?.[0] ?? "";
    expect(conn).toContain("revision 7");
  });

  it("colours the status dot by connection and source", () => {
    // Ok colour while connected with the source reachable (also before the first meta answer);
    // the error colour when disconnected or when the source is unreachable.
    const conn = (over: Record<string, unknown>) =>
      /<span[^>]*class="(conn[^"]*)"/.exec(render(over))?.[1] ?? "";
    const down = metaOf({
      source: {
        kind: "clickhouse",
        database: "sdlog",
        table: "signals",
        reachable: false,
        checkedAt: "2026-10-16T13:08:01.000Z",
        error: "connect ECONNREFUSED",
      },
    });
    expect(conn({ meta: metaOf() })).not.toContain("dot-error");
    expect(conn({})).not.toContain("dot-error");
    expect(conn({ connected: false, meta: metaOf() })).toContain("dot-error");
    expect(conn({ meta: down })).toContain("dot-error");
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
    const alice: Me = { user: "alice", identity: "oidc", roles: [], canShare: false };
    // Without hidden items the leading KIPscope has no tooltip.
    const plain = render({ meta: metaOf(), me: alice });
    expect(plain).toMatch(/<span>KIPscope<\/span>/);

    // The fit hides zone and user: their texts, one per line.
    vi.mocked(fitFooter).mockReturnValueOnce({ shown: [], wrap: false });
    const html = render({ meta: metaOf(), me: alice });
    const title = /<span title="([^"]*)">KIPscope<\/span>/.exec(html)?.[1];
    expect(title).toBeDefined();
    const lines = (title as string).replace(/&#10;|&#xA;/gi, "\n").split("\n");
    expect(lines).toEqual(["Europe/Berlin", "alice"]);
    // Hidden items are not rendered in the visible part.
    const content = html.replace(/<div[^>]*status-measure[^>]*>.*?<\/div>/s, "");
    expect(content).not.toContain("alice</span>");
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
