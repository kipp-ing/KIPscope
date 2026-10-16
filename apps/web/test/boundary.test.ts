import { describe, expect, it, vi } from "vitest";
import { WindowBoundary } from "../src/WindowBoundary.tsx";

describe("WindowBoundary", () => {
  it("catches a window's error and reports it as rendered with an error", () => {
    const onReady = vi.fn();
    const boundary = new WindowBoundary({
      windowId: "w2",
      revision: 9,
      onReady,
      children: null,
    });
    const error = new Error("boom");
    // React merges the derived state into the instance's state when a child throws.
    const state = { ...boundary.state, ...WindowBoundary.getDerivedStateFromError(error) };
    expect(state.error).toBe("boom");
    boundary.componentDidCatch(error);
    expect(onReady).toHaveBeenCalledTimes(1);
    const [windowId, revision, errors] = onReady.mock.calls[0] as [
      string,
      number,
      { windowId: string; message: string }[],
    ];
    expect(windowId).toBe("w2");
    expect(revision).toBe(9);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.windowId).toBe("w2");
    expect(errors[0]?.message).toContain("boom");
  });
});
