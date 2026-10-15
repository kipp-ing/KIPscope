import { describe, expect, it } from "vitest";
import { LinkedPreviewStore, shownRange } from "../src/chart/linkedPreview.ts";
import type { Range } from "../src/chart/zoom.ts";

const server: Range = { from: 0n, to: 3_600_000_000_000n };
const a: Range = { from: 1_000n, to: 2_000n };
const b: Range = { from: 5_000n, to: 6_000n };

describe("LinkedPreviewStore", () => {
  it("publishes synchronously and clears only for the current source", () => {
    const store = new LinkedPreviewStore();
    let notified = 0;
    const seen: (string | undefined)[] = [];
    const off = store.subscribe(() => {
      notified++;
      seen.push(store.get()?.source);
    });
    expect(store.get()).toBeUndefined();

    store.publish("w1", a);
    expect(notified).toBe(1); // listener ran before publish returned
    expect(store.get()).toEqual({ source: "w1", range: a });

    store.publish("w2", b); // the latest gesture wins
    expect(notified).toBe(2);
    expect(store.get()).toEqual({ source: "w2", range: b });

    store.clear("w1"); // w1 is no longer the source: ignored, no notification
    expect(notified).toBe(2);
    expect(store.get()).toEqual({ source: "w2", range: b });

    store.clear("w2");
    expect(notified).toBe(3);
    expect(store.get()).toBeUndefined();

    store.clear("w2"); // nothing to clear
    expect(notified).toBe(3);
    expect(seen).toEqual(["w1", "w2", undefined]);

    off();
    store.publish("w1", a);
    expect(notified).toBe(3); // unsubscribed
  });
});

describe("shownRange", () => {
  it("shows the own preview, else the linked shared one, else the server range", () => {
    const shared = { source: "w1", range: a };
    // Own preview wins, linked or not, shared or not.
    expect(shownRange("w2", b, shared, true, server)).toEqual(b);
    expect(shownRange("w2", b, undefined, false, server)).toEqual(b);
    expect(shownRange("w1", b, shared, true, server)).toEqual(b);
    // Linked and another window is the source: the shared range.
    expect(shownRange("w2", undefined, shared, true, server)).toEqual(a);
    // Unlinked windows ignore the shared range.
    expect(shownRange("w2", undefined, shared, false, server)).toEqual(server);
    // Nothing shared, or the window itself is the source without own preview (cleared): server range.
    expect(shownRange("w2", undefined, undefined, true, server)).toEqual(server);
    expect(shownRange("w1", undefined, shared, true, server)).toEqual(server);
  });
});
