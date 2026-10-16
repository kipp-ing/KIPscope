import { describe, expect, it } from "vitest";
import { ignoreFileDrops } from "../src/filedrop.ts";

/** A cancelable drag event as the browser makes it, carrying `types` and a writable dropEffect. */
function dragEvent(type: "dragover" | "drop", types: string[]) {
  const event = new Event(type, { cancelable: true });
  const dataTransfer = { types, dropEffect: "copy" };
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return { event, dataTransfer };
}

describe("ignoreFileDrops", () => {
  it("prevents file drops on the page", () => {
    const target = new EventTarget();
    const remove = ignoreFileDrops(target);

    const over = dragEvent("dragover", ["Files"]);
    target.dispatchEvent(over.event);
    expect(over.event.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe("none");
    const drop = dragEvent("drop", ["Files"]);
    target.dispatchEvent(drop.event);
    expect(drop.event.defaultPrevented).toBe(true);

    // Other drags pass untouched.
    const text = dragEvent("drop", ["text/plain"]);
    target.dispatchEvent(text.event);
    expect(text.event.defaultPrevented).toBe(false);

    remove();
    const after = dragEvent("dragover", ["Files"]);
    target.dispatchEvent(after.event);
    const afterDrop = dragEvent("drop", ["Files"]);
    target.dispatchEvent(afterDrop.event);
    expect(after.event.defaultPrevented).toBe(false);
    expect(afterDrop.event.defaultPrevented).toBe(false);
    expect(after.dataTransfer.dropEffect).toBe("copy");
  });
});
