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
});
