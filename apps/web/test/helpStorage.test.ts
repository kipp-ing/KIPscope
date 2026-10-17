import { afterEach, describe, expect, it, vi } from "vitest";

// help/storage.ts keeps page-lifetime state, so every case loads a fresh copy of the module.
async function load() {
  vi.resetModules();
  return import("../src/help/storage.ts");
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

/** Storage in memory; `data` is what the browser would hold. */
function memory() {
  const data = new Map<string, string>();
  return {
    data,
    storage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
  };
}

function install(storage: unknown) {
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { localStorage: storage });
}

/** Even reading the `localStorage` property throws (site data blocked). */
function installBlockedProperty() {
  const w = {};
  Object.defineProperty(w, "localStorage", {
    get() {
      throw new Error("SecurityError");
    },
  });
  vi.stubGlobal("window", w);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError");
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("help storage", () => {
  it("keeps learned hints when storage is blocked", async () => {
    for (const setup of [() => install(throwing), installBlockedProperty]) {
      setup();
      const s = await load();
      expect(() => s.hasLearned("b")).not.toThrow();
      expect(s.hasLearned("b")).toBe(false);
      expect(() => s.learn("b")).not.toThrow();
      expect(s.hasLearned("b")).toBe(true);
      expect(s.hasLearned("diff")).toBe(false);
      s.learn("diff");
      expect(s.hasLearned("diff")).toBe(true);
      vi.unstubAllGlobals();
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("keeps the start card state when storage is blocked", async () => {
    install(throwing);
    const s = await load();
    expect(s.startDismissed()).toBe(false);
    expect(() => s.dismissStart()).not.toThrow();
    expect(s.startDismissed()).toBe(true);
    s.showStartAgain();
    expect(s.startDismissed()).toBe(false);
  });

  it("persists learned hints as a JSON array and the start card under its key", async () => {
    const { data, storage } = memory();
    install(storage);
    const s = await load();
    s.learn("b");
    expect(JSON.parse(data.get("kipscope.learned") ?? "null")).toEqual(["b"]);
    s.learn("diff");
    expect(JSON.parse(data.get("kipscope.learned") ?? "null")).toEqual(["b", "diff"]);
    s.dismissStart();
    expect(data.has("kipscope.startCard")).toBe(true);

    // A new page in the same browser sees both.
    const again = await load();
    expect(again.hasLearned("b")).toBe(true);
    expect(again.hasLearned("diff")).toBe(true);
    expect(again.startDismissed()).toBe(true);
    again.showStartAgain();
    expect(again.startDismissed()).toBe(false);
  });

  it("starts empty on garbage in storage", async () => {
    const { storage } = memory();
    storage.setItem("kipscope.learned", "{not json");
    install(storage);
    const s = await load();
    expect(s.hasLearned("b")).toBe(false);
    expect(() => s.learn("b")).not.toThrow();
    expect(s.hasLearned("b")).toBe(true);
  });
});
