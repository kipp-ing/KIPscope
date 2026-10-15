import type { ClientRenderStatus, RenderError, RenderStatus } from "@letsview/shared";
import { describe, expect, it } from "vitest";
import { NO_UI_GRACE_MS, POLL_MS, waitForRender } from "../src/wait.ts";

type Rendered = NonNullable<ClientRenderStatus["rendered"]>;

const client = (clientId: string, rendered?: Partial<Rendered>): ClientRenderStatus => {
  const c: ClientRenderStatus = { clientId, connectedAt: "2026-10-15T08:00:00.000Z" };
  if (rendered) {
    c.rendered = {
      revision: 0,
      status: "complete",
      errors: [],
      at: "2026-10-15T08:00:01.000Z",
      ...rendered,
    };
  }
  return c;
};

/**
 * Fake clock: `sleep` advances it, `renderStatus` answers `clientsAt(now)` for revision 3 and
 * counts the calls. Starts at 1_000_000 so that absolute times are not near zero.
 */
function fake(clientsAt: (elapsedMs: number) => ClientRenderStatus[]) {
  const start = 1_000_000;
  let now = start;
  let polls = 0;
  return {
    start,
    polls: () => polls,
    deps: {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
      renderStatus: async (): Promise<RenderStatus> => {
        polls++;
        return { revision: 3, clients: clientsAt(now - start) };
      },
    },
  };
}

describe("waitForRender", () => {
  it("polls every 100 ms and gives no UI 2 s", () => {
    expect(POLL_MS).toBe(100);
    expect(NO_UI_GRACE_MS).toBe(2000);
  });

  it("reports no_ui after 2 s without a client, not after a 1 s reconnect gap", async () => {
    // No client at all: no_ui once 2 s have passed (one poll interval of slack), not before.
    const none = fake(() => []);
    const result = await waitForRender(3, none.start + 30_000, none.deps);
    expect(result.status).toBe("no_ui");
    expect(result.target).toBe(3);
    expect(result.waitedMs).toBeGreaterThanOrEqual(2000);
    expect(result.waitedMs).toBeLessThanOrEqual(2000 + POLL_MS);
    expect(result.revision).toBeUndefined();

    // A page reload: the client is gone for 1 s (0.2 s ... 1.2 s), comes back and acknowledges.
    const reload = fake((t) => {
      if (t >= 1500) return [client("c2", { revision: 3 })];
      if (t >= 200 && t < 1200) return [];
      return [client("c1", { revision: 2 })];
    });
    const reloaded = await waitForRender(3, reload.start + 30_000, reload.deps);
    expect(reloaded.status).toBe("complete");
    expect(reloaded.clientId).toBe("c2");

    // A client seen until 3 s resets the grace: no_ui comes 2 s after the last sighting.
    const left = fake((t) => (t <= 3000 ? [client("c1", { revision: 2 })] : []));
    const gone = await waitForRender(3, left.start + 30_000, left.deps);
    expect(gone.status).toBe("no_ui");
    expect(gone.waitedMs).toBeGreaterThanOrEqual(5000);
    expect(gone.waitedMs).toBeLessThanOrEqual(5000 + POLL_MS);
  });

  it("completes when a client acknowledged the target or a later revision", async () => {
    const f = fake((t) =>
      t < 300 ? [client("c1", { revision: 2 })] : [client("c1", { revision: 3 })],
    );
    const done = await waitForRender(3, f.start + 30_000, f.deps);
    expect(done).toMatchObject({ status: "complete", target: 3, revision: 3, clientId: "c1" });
    expect(done.waitedMs).toBeGreaterThanOrEqual(300);
    expect(done.waitedMs).toBeLessThan(300 + 2 * POLL_MS);
    expect(done.errors).toBeUndefined();

    const later = fake(() => [client("c1", { revision: 4 })]);
    const result = await waitForRender(3, later.start + 30_000, later.deps);
    expect(result).toMatchObject({ status: "complete", target: 3, revision: 4, clientId: "c1" });
    expect(result.waitedMs).toBeLessThan(POLL_MS);
  });

  it("lets the first acknowledging client decide", async () => {
    const f = fake(() => [
      client("c1", { revision: 1 }),
      client("c2", { revision: 3 }),
      client("c3"),
    ]);
    const result = await waitForRender(3, f.start + 30_000, f.deps);
    expect(result).toMatchObject({ status: "complete", clientId: "c2", revision: 3 });
  });

  it("reports error with the UI's errors", async () => {
    const errors: RenderError[] = [
      { windowId: "w1", signalId: "car/A", message: "source_error: timeout" },
    ];
    const f = fake(() => [client("c1", { revision: 3, status: "error", errors })]);
    const result = await waitForRender(3, f.start + 30_000, f.deps);
    expect(result).toMatchObject({ status: "error", clientId: "c1", revision: 3, errors });

    // An error from any acknowledging client counts, even next to a complete one.
    const mixed = fake(() => [
      client("c1", { revision: 3 }),
      client("c2", { revision: 5, status: "error", errors }),
    ]);
    const second = await waitForRender(3, mixed.start + 30_000, mixed.deps);
    expect(second).toMatchObject({ status: "error", clientId: "c2", errors });
  });

  it("reports timeout when a client never acknowledges", async () => {
    const f = fake(() => [client("c1", { revision: 2 })]);
    const result = await waitForRender(3, f.start + 500, f.deps);
    expect(result.status).toBe("timeout");
    expect(result.target).toBe(3);
    expect(result.waitedMs).toBeGreaterThanOrEqual(500);
    expect(result.waitedMs).toBeLessThanOrEqual(500 + POLL_MS);
    // Polled, but not in a busy loop: about one request per interval.
    expect(f.polls()).toBeGreaterThanOrEqual(5);
    expect(f.polls()).toBeLessThanOrEqual(7);
  });

  it("reports timeout before no_ui when the deadline is shorter than the grace", async () => {
    const f = fake(() => []);
    const result = await waitForRender(3, f.start + 500, f.deps);
    expect(result.status).toBe("timeout");
    expect(result.waitedMs).toBeLessThanOrEqual(500 + POLL_MS);
  });
});
