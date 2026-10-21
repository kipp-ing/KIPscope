import { type RenderedMessage, RenderedMessage as RenderedSchema } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import { Acknowledger } from "../src/ack.ts";

/** An acknowledger over a send function that records every message and answers `connected`. */
function setup(connected = true) {
  const state = { connected };
  const accepted: RenderedMessage[] = [];
  const attempts: RenderedMessage[] = [];
  const ack = new Acknowledger((message) => {
    attempts.push(message);
    if (!state.connected) return false;
    accepted.push(message);
    return true;
  });
  return { ack, state, accepted, attempts };
}

describe("Acknowledger", () => {
  it("caps errors and message lengths", () => {
    const many = setup();
    many.ack.setState(3, ["w1"]);
    many.ack.report(
      "w1",
      3,
      Array.from({ length: 70 }, (_, i) => ({ windowId: "w1", signalId: `c/s${i}`, message: "m" })),
    );
    expect(many.accepted).toHaveLength(1);
    const first = many.accepted[0] as RenderedMessage;
    expect(first.errors).toHaveLength(50);
    expect(first.status).toBe("error");
    expect(RenderedSchema.safeParse(first).success).toBe(true);

    const long = setup();
    long.ack.setState(4, ["w1"]);
    long.ack.report("w1", 4, [{ windowId: "w1", message: "x".repeat(2000) }]);
    const second = long.accepted[0] as RenderedMessage;
    expect(second.errors).toHaveLength(1);
    expect(second.errors?.every((e) => e.message.length <= 500)).toBe(true);
    expect(second.status).toBe("error");
    expect(RenderedSchema.safeParse(second).success).toBe(true);
  });

  it("acknowledges again after a reconnect", () => {
    const t = setup(false);
    t.ack.setState(7, ["w1", "w2"]);
    t.ack.report("w1", 7, []);
    t.ack.report("w2", 7, []);
    expect(t.accepted).toHaveLength(0); // the channel dropped every attempt
    t.state.connected = true;
    t.ack.reconnected();
    expect(t.accepted).toEqual([{ type: "rendered", revision: 7, status: "complete", errors: [] }]);
  });

  it("sends one acknowledgement per revision and error list", () => {
    const t = setup();
    t.ack.setState(7, ["w1", "w2"]);
    t.ack.report("w1", 7, []);
    t.ack.report("w2", 7, []);
    t.ack.report("w1", 7, []);
    t.ack.report("w2", 7, []);
    expect(t.accepted).toHaveLength(1);
    expect(t.accepted[0]).toMatchObject({ revision: 7, status: "complete" });
  });

  it("reports a rendered revision once, when every window drew it", () => {
    // The end of a pending step's progress line (design DW4).
    const rendered: number[] = [];
    const ack = new Acknowledger(
      () => true,
      (revision) => rendered.push(revision),
    );
    ack.setState(7, ["w1", "w2"]);
    ack.report("w1", 7, []);
    expect(rendered).toEqual([]); // w2 has not drawn revision 7 yet
    ack.report("w2", 7, []);
    expect(rendered).toEqual([7]);
    ack.report("w1", 7, []); // the same revision again: not twice
    expect(rendered).toEqual([7]);
    // A window that reports an error is drawn, too (H6).
    ack.setState(8, ["w1", "w2"]);
    ack.report("w1", 8, [{ windowId: "w1", message: "failed" }]);
    ack.report("w2", 8, []);
    expect(rendered).toEqual([7, 8]);
    // Even when the channel dropped the acknowledgement.
    const dropped: number[] = [];
    const offline = new Acknowledger(
      () => false,
      (revision) => dropped.push(revision),
    );
    offline.setState(9, ["w1"]);
    offline.report("w1", 9, []);
    expect(dropped).toEqual([9]);
    // With no window the revision is rendered at once.
    const none: number[] = [];
    const empty = new Acknowledger(
      () => true,
      (revision) => none.push(revision),
    );
    empty.setState(10, []);
    expect(none).toEqual([10]);
  });
});
