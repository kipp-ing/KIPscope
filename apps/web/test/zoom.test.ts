import { type CommandResult, fromIso, NS_PER_MS } from "@kipscope/shared";
import { describe, expect, it, vi } from "vitest";
import {
  clampRange,
  extentRange,
  historyKey,
  isMouseWheel,
  type Range,
  RangePreview,
  WheelFrame,
  wheelAction,
  wheelZoomFactor,
  ZOOM_HISTORY_LIMIT,
  ZoomHistory,
} from "../src/chart/zoom.ts";
import { CLAMP_MESSAGE, resultStripEvents } from "../src/time/scope.ts";
import { nextStrip, type StripItem } from "../src/views/notice.ts";

const MIN = -2_208_988_800_000_000_000n; // 1900-01-01T00:00:00Z
const MAX = 9_223_286_400_000_000_000n; // 2262-04-11T00:00:00Z

describe("clampRange", () => {
  it("clamps ranges into the time bounds", () => {
    const inside = { from: 1000n, to: 5000n };
    expect(clampRange(inside)).toEqual(inside);
    expect(clampRange({ from: MIN, to: MAX })).toEqual({ from: MIN, to: MAX });
    // Shifted back in, span kept.
    expect(clampRange({ from: MIN - 1000n, to: MIN + 9000n })).toEqual({
      from: MIN,
      to: MIN + 10_000n,
    });
    expect(clampRange({ from: MAX - 9000n, to: MAX + 1000n })).toEqual({
      from: MAX - 10_000n,
      to: MAX,
    });
    // Wider than the bounds: the bounds.
    expect(clampRange({ from: MIN * 2n, to: MAX })).toEqual({ from: MIN, to: MAX });
    // The live bug values from window w23.
    expect(
      clampRange({ from: -29_473_328_485_867_940_608n, to: 62_083_631_947_910_636_800n }),
    ).toEqual({ from: MIN, to: MAX });
    // 40 doublings of a day never leave the bounds.
    let r = {
      from: 1_791_800_000_000_000_000n,
      to: 1_791_800_000_000_000_000n + 86_400_000_000_000n,
    };
    for (let i = 0; i < 40; i++) {
      const mid = (r.from + r.to) / 2n;
      const span = r.to - r.from;
      r = clampRange({ from: mid - span, to: mid + span });
      expect(r.from >= MIN && r.to <= MAX).toBe(true);
    }
  });
});

describe("extentRange", () => {
  it("computes the extent range rounded up to the next millisecond", () => {
    const first = fromIso("2026-10-11T12:34:24.824Z");
    const last = fromIso("2026-10-13T13:17:33.2204Z"); // 33.220400 s
    const r = extentRange([{ first: first.toString(), last: last.toString() }]);
    expect(r).toEqual({ from: first, to: fromIso("2026-10-13T13:17:33.221Z") });
    // A last point exactly on a millisecond ends one millisecond later (half-open).
    const exact = fromIso("2026-10-13T13:17:33.221Z");
    expect(extentRange([{ first: "0", last: exact.toString() }])?.to).toBe(exact + NS_PER_MS);
    // Union of several signals: earliest first, latest last.
    const union = extentRange([
      { first: "5000000", last: "9000000" },
      { first: "1000000", last: "6000000" },
    ]);
    expect(union).toEqual({ from: 1_000_000n, to: 10_000_000n });
    expect(extentRange([])).toBeUndefined();
  });
});

describe("ZoomHistory", () => {
  const r = (n: number) => ({ from: BigInt(n), to: BigInt(n) + 10n });

  it("keeps a bounded zoom history", () => {
    const h = new ZoomHistory(3);
    expect(h.back()).toBeUndefined();
    for (const n of [1, 2, 3, 4]) h.push(r(n));
    expect(h.size).toBe(3);
    expect([h.back(), h.back(), h.back(), h.back()]).toEqual([r(4), r(3), r(2), undefined]);
    // The same range twice in a row is recorded once.
    h.push(r(7));
    h.push(r(7));
    expect(h.size).toBe(1);
    // Default limit: 50 steps.
    expect(ZOOM_HISTORY_LIMIT).toBe(50);
    const big = new ZoomHistory();
    for (let n = 0; n < 60; n++) big.push(r(n));
    expect(big.size).toBe(50);
    expect(big.back()).toEqual(r(59));
  });

  it("shares one history while linked", () => {
    expect(historyKey(true, "w1")).toBe(historyKey(true, "w2"));
    expect(historyKey(false, "w1")).not.toBe(historyKey(false, "w2"));
    expect(historyKey(false, "w1")).not.toBe(historyKey(true, "w1"));
    const histories = new Map<string, ZoomHistory>();
    const get = (linked: boolean, id: string) => {
      const k = historyKey(linked, id);
      const h = histories.get(k) ?? new ZoomHistory();
      histories.set(k, h);
      return h;
    };
    get(true, "w1").push(r(1));
    expect(get(true, "w2").back()).toEqual(r(1));
    get(false, "w1").push(r(2));
    expect(get(false, "w2").back()).toBeUndefined();
    expect(get(false, "w1").back()).toEqual(r(2));
  });
});

describe("full extent (lead decision e)", () => {
  it("never returns the 1900-2262 bounds for finite data extents", () => {
    const first = fromIso("2026-10-11T12:34:24.824Z");
    const last = fromIso("2026-10-13T13:17:33.221Z");
    const r = extentRange([{ first: first.toString(), last: last.toString() }]);
    expect(r).toBeDefined();
    if (!r) return;
    expect(r.from).toBe(first);
    expect(r.to).toBe(last + NS_PER_MS);
    expect(r).not.toEqual({ from: MIN, to: MAX });
    // Clamping an extent range inside the bounds leaves it untouched.
    expect(clampRange(r)).toEqual(r);
    // A single-point extent stays a one-millisecond range, not the bounds.
    const one = extentRange([{ first: "5000000000", last: "5000000000" }]);
    expect(one && clampRange(one)).toEqual({ from: 5_000_000_000n, to: 5_001_000_000n });
  });
});

describe("wheelZoomFactor", () => {
  it("wheel factor is 2 per 5 ticks, capped at 5 ticks per event", () => {
    // Pixel mode: a tick is 100 px; five ticks double (out) or halve (in) the span.
    expect(wheelZoomFactor(500, 0)).toBeCloseTo(2, 12);
    expect(wheelZoomFactor(-500, 0)).toBeCloseTo(0.5, 12);
    expect(wheelZoomFactor(100, 0)).toBeCloseTo(2 ** (1 / 5), 12);
    expect(wheelZoomFactor(0, 0)).toBe(1);
    // Trackpad fractions of a tick zoom smoothly.
    expect(wheelZoomFactor(10, 0)).toBeCloseTo(2 ** (1 / 50), 12);
    // Line mode: a tick is 3 lines.
    expect(wheelZoomFactor(3, 1)).toBeCloseTo(2 ** (1 / 5), 12);
    expect(wheelZoomFactor(15, 1)).toBeCloseTo(2, 12);
    // Page mode: one page is five ticks.
    expect(wheelZoomFactor(1, 2)).toBeCloseTo(2, 12);
    expect(wheelZoomFactor(-1, 2)).toBeCloseTo(0.5, 12);
    // At most five ticks per event, in both directions and all modes.
    expect(wheelZoomFactor(5000, 0)).toBeCloseTo(2, 12);
    expect(wheelZoomFactor(-5000, 0)).toBeCloseTo(0.5, 12);
    expect(wheelZoomFactor(300, 1)).toBeCloseTo(2, 12);
    expect(wheelZoomFactor(3, 2)).toBeCloseTo(2, 12);
  });
});

describe("wheelAction", () => {
  const ev = (
    deltaX: number,
    deltaY: number,
    mods: { ctrlKey?: boolean; shiftKey?: boolean; deltaMode?: number } = {},
  ) => ({
    deltaX,
    deltaY,
    deltaMode: mods.deltaMode ?? 0,
    ctrlKey: mods.ctrlKey ?? false,
    shiftKey: mods.shiftKey ?? false,
  });

  it("classifies wheel events: plain scrolls, Ctrl or Shift zooms, horizontal swipe pans", () => {
    // Plain vertical wheel: the page scrolls.
    expect(wheelAction(ev(0, 100))).toEqual({ kind: "none" });
    expect(wheelAction(ev(0, -300))).toEqual({ kind: "none" });
    // Diagonal drift (|dx| <= 2|dy|): still the page.
    expect(wheelAction(ev(30, 20))).toEqual({ kind: "none" });
    expect(wheelAction(ev(40, 20))).toEqual({ kind: "none" });

    // Ctrl (pinch included) or Shift zooms by the wheel factor of deltaY.
    for (const mods of [{ ctrlKey: true }, { shiftKey: true }, { ctrlKey: true, shiftKey: true }]) {
      const out = wheelAction(ev(0, 100, mods));
      expect(out.kind).toBe("zoom");
      if (out.kind === "zoom") expect(out.factor).toBeCloseTo(2 ** (1 / 5), 12);
      const inward = wheelAction(ev(0, -500, mods));
      if (inward.kind === "zoom") expect(inward.factor).toBeCloseTo(0.5, 12);
      else expect.fail("expected zoom");
    }
    // Line mode counts like wheelZoomFactor.
    const lines = wheelAction(ev(0, 3, { ctrlKey: true, deltaMode: 1 }));
    if (lines.kind === "zoom") expect(lines.factor).toBeCloseTo(2 ** (1 / 5), 12);
    else expect.fail("expected zoom");
    // macOS turns Shift+wheel into a horizontal delta: deltaX zooms then.
    const mac = wheelAction(ev(100, 0, { shiftKey: true }));
    if (mac.kind === "zoom") expect(mac.factor).toBeCloseTo(2 ** (1 / 5), 12);
    else expect.fail("expected zoom");
    const macIn = wheelAction(ev(-500, 0, { shiftKey: true }));
    if (macIn.kind === "zoom") expect(macIn.factor).toBeCloseTo(0.5, 12);
    else expect.fail("expected zoom");

    // Horizontal swipe without modifier pans by deltaX pixels when |dx| > 2|dy|.
    expect(wheelAction(ev(120, 0))).toEqual({ kind: "pan", px: 120 });
    expect(wheelAction(ev(-80, 10))).toEqual({ kind: "pan", px: -80 });
    expect(wheelAction(ev(41, 20))).toEqual({ kind: "pan", px: 41 });
    // Exactly twice is not enough.
    expect(wheelAction(ev(40, 20))).toEqual({ kind: "none" });
    // Meta is no zoom modifier.
    expect(wheelAction({ ...ev(0, 100), metaKey: true } as never)).toEqual({ kind: "none" });
  });
});

describe("mouse wheel steps", () => {
  // Recorded on Jan's mouse in Chrome on macOS (2026-10-15): [deltaX, wheelDeltaX] of one slow
  // notch, and an event whose delta happens to be about a third of its wheelDelta.
  const notch: [number, number][] = [
    [-4.000244140625, 120],
    [-31.98486328125, 120],
    [-96.1627197265625, 240],
    [-129.541015625, 360],
  ];
  const mouse = (deltaX: number, wheelDeltaX: number, mods: { shiftKey?: boolean } = {}) => ({
    deltaX,
    deltaY: 0,
    deltaMode: 0,
    wheelDeltaX,
    wheelDeltaY: 0,
    ctrlKey: false,
    shiftKey: mods.shiftKey ?? false,
  });

  it("tells a mouse wheel from a trackpad", () => {
    for (const [dx, wx] of notch) expect(isMouseWheel(mouse(dx, wx))).toBe(true);
    expect(isMouseWheel(mouse(-320.029296875, 960))).toBe(true);
    // Chrome's trackpad: wheelDelta is -3 × delta, also when that is a multiple of 120.
    expect(isMouseWheel(mouse(-12.5, 37))).toBe(false);
    expect(isMouseWheel(mouse(40, -120))).toBe(false);
    // No wheelDelta counts as trackpad; line mode (Firefox, one event per notch) keeps its ticks.
    expect(isMouseWheel({ deltaX: 30, deltaY: 0, deltaMode: 0 })).toBe(false);
    expect(isMouseWheel({ deltaX: 3, deltaY: 0, deltaMode: 1, wheelDeltaX: -120 })).toBe(false);
    // Vertical: wheelDeltaY decides.
    expect(isMouseWheel({ deltaX: 0, deltaY: -75.2, deltaMode: 0, wheelDeltaY: 120 })).toBe(true);
  });

  it("pans 2 % of the plot per mouse event and zooms a quarter tick, whatever the delta", () => {
    const f = new WheelFrame();
    for (const [dx, wx] of notch) f.add(wheelAction(mouse(dx, wx)), 0);
    // One slow notch: 4 events, 8 % of the plot to the left (raw deltas would be 262 px).
    expect(f.take().share).toBeCloseTo(-0.08, 12);
    expect(wheelAction(mouse(240.69, -720))).toEqual({ kind: "panStep", share: 0.02 });
    const zoom = wheelAction(mouse(240.69, -720, { shiftKey: true }));
    if (zoom.kind === "zoom") expect(zoom.factor).toBeCloseTo(2 ** (1 / 20), 12);
    else expect.fail("expected zoom");
    // A trackpad swipe still pans by its pixels.
    expect(wheelAction(mouse(40, -120))).toEqual({ kind: "pan", px: 40 });
  });
});

describe("WheelFrame", () => {
  const step = 2 ** (1 / 5);

  it("joins the zoom factors and pan deltas of one frame, anchored at the latest zoom x", () => {
    const f = new WheelFrame();
    f.add({ kind: "zoom", factor: step }, 100);
    f.add({ kind: "zoom", factor: step }, 250);
    f.add({ kind: "pan", px: 30 }, 400);
    f.add({ kind: "pan", px: -10 }, 410);
    f.add({ kind: "none" }, 999);
    const out = f.take();
    expect(out.factor).toBeCloseTo(2 ** (2 / 5), 12);
    expect(out.px).toBe(20);
    expect(out.x).toBe(250);
  });

  it("caps the joined factor at one event's limit of five ticks (2 or 1/2)", () => {
    const out = new WheelFrame();
    for (let i = 0; i < 6; i++) out.add({ kind: "zoom", factor: 2 }, 0);
    expect(out.take().factor).toBeCloseTo(2, 12);
    for (let i = 0; i < 6; i++) out.add({ kind: "zoom", factor: 0.5 }, 0);
    expect(out.take().factor).toBeCloseTo(0.5, 12);
  });

  it("starts the next frame from nothing", () => {
    const f = new WheelFrame();
    f.add({ kind: "zoom", factor: 2 }, 5);
    f.add({ kind: "pan", px: 7 }, 5);
    f.take();
    expect(f.take()).toMatchObject({ factor: 1, px: 0 });
  });
});

describe("RangePreview", () => {
  const server = { from: 0n, to: 1000n };
  const zoomed = { from: 200n, to: 400n };

  it("drops the preview and shows the server range when the server rejects the range", async () => {
    const p = new RangePreview();
    p.range = zoomed;
    expect(p.view(server)).toBe(zoomed);
    const done = p.commit(zoomed, async () => ({ ok: false }));
    expect(p.inFlight).toBe(true);
    expect(await done).toEqual({ ok: false, reapply: true });
    expect(p.inFlight).toBe(false);
    expect(p.range).toBeUndefined();
    expect(p.view(server)).toBe(server);
  });

  it("drops the preview without a command on a double-click at the extents", () => {
    const p = new RangePreview();
    const send = vi.fn(async () => ({ ok: true }));
    p.range = zoomed;
    // App sends no range when the window already shows the extents; the window only drops.
    expect(p.drop()).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(p.view(server)).toBe(server);
    // Nothing left to drop: no second view reset.
    expect(p.drop()).toBe(false);
  });

  it("resets inFlight, drops the preview and shows the server range when the command throws", async () => {
    const p = new RangePreview();
    p.range = zoomed;
    const result = await p.commit(zoomed, () => Promise.reject(new TypeError("Failed to fetch")));
    expect(result).toEqual({ ok: false, reapply: true });
    expect(p.inFlight).toBe(false);
    expect(p.range).toBeUndefined();
    expect(p.view(server)).toBe(server);
  });

  it("keeps a newer preview and needs no view reset when an older commit settles", async () => {
    const p = new RangePreview();
    p.range = zoomed;
    const newer = { from: 300n, to: 500n };
    const done = p.commit(zoomed, async () => {
      p.range = newer;
      return { ok: true };
    });
    expect(await done).toEqual({ ok: true, reapply: false });
    expect(p.view(server)).toBe(newer);
  });

  it("drops the preview without a view reset when the server accepts the range", async () => {
    const p = new RangePreview();
    p.settle(server, false);
    p.range = zoomed;
    expect(await p.commit(zoomed, async () => ({ ok: true }))).toEqual({
      ok: true,
      reapply: false,
    });
    expect(p.inFlight).toBe(false);
    // The accepted range arrives with the next revision; then the preview is dropped.
    p.settle(zoomed, false);
    expect(p.range).toBeUndefined();
    expect(p.view(zoomed)).toEqual(zoomed);
  });

  it("shows the preview range in the header", async () => {
    // The header shows view(server), like the plot: three quick wheel zooms, then their commands.
    const p = new RangePreview();
    p.settle(server, false);
    const steps = [
      { from: 100n, to: 900n },
      { from: 200n, to: 800n },
      { from: 300n, to: 700n },
    ];
    for (const step of steps) {
      p.range = step;
      p.settle(server, true); // commit scheduled, not sent
      expect(p.view(server)).toBe(step);
    }
    const last = steps[2] as Range;
    let accept: (r: { ok: boolean }) => void = () => {};
    const done = p.commit(last, () => new Promise((resolve) => (accept = resolve)));
    p.settle(server, false); // in flight
    expect(p.view(server)).toBe(last);
    // The accept arrives before the revision that carries the range: still the preview, never
    // the range of the step before.
    accept({ ok: true });
    await done;
    p.settle(server, false);
    expect(p.view(server)).toBe(last);
    p.settle(last, false);
    expect(p.range).toBeUndefined();
    expect(p.view(last)).toEqual(last);
    // Revision first, then the accept: the same.
    p.range = zoomed;
    const second = p.commit(zoomed, async () => ({ ok: true }));
    p.settle(zoomed, false);
    expect(p.view(zoomed)).toBe(zoomed);
    await second;
    p.settle(zoomed, false);
    expect(p.range).toBeUndefined();
    // Another client's range that arrives after the accept wins.
    p.range = { from: 0n, to: 10n };
    await p.commit(p.range, async () => ({ ok: true }));
    p.settle(server, false);
    expect(p.view(server)).toBe(server);
  });
});

describe("range stopped at the scope edge (add-scope)", () => {
  /** The message slot after the strip events of one command result, like App's `command` handler. */
  const slotAfter = (slot: StripItem | undefined, result: CommandResult) =>
    resultStripEvents(result).reduce(nextStrip, slot);

  it("reports a range stopped at the scope edge", () => {
    expect(CLAMP_MESSAGE).toBe("Stopped at the scope edge. Widen shows more.");
    const clamped = slotAfter(undefined, { ok: true, revision: 9, clamped: true });
    expect(clamped?.text).toBe("Stopped at the scope edge. Widen shows more.");
    expect(clamped?.tone).toBe("info");
    // The next accepted command without `clamped` clears the message ...
    expect(slotAfter(clamped, { ok: true, revision: 10 })).toBeUndefined();
    // ... and sets none of its own.
    expect(slotAfter(undefined, { ok: true, revision: 10 })).toBeUndefined();
  });

  it("keeps an open notice and shows a refusal", () => {
    const opened: StripItem = { tone: "info", text: 'Opened "Drive 3"' };
    expect(slotAfter(opened, { ok: true, revision: 11 })).toBe(opened);
    const refused = slotAfter(opened, {
      ok: false,
      code: "out_of_scope",
      message: "cursor A outside the scope",
    });
    expect(refused).toEqual({ tone: "error", text: "out_of_scope: cursor A outside the scope" });
    // A clamp replaces an older error.
    expect(slotAfter(refused, { ok: true, revision: 12, clamped: true })?.text).toBe(CLAMP_MESSAGE);
  });
});
