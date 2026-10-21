import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogOfText, ignoreFileDrops, openDroppedCatalog } from "../src/filedrop.ts";
import { CASE_REPORT_KEY, takeCaseReport } from "../src/workspaces/caseReport.ts";

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

describe("a dropped catalog (add-case-open K14)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const DOC = {
    kipscope: "cases",
    version: 1,
    cases: [
      {
        id: "testcar|driving|2026-10-01T01:00:00Z",
        object: "testcar",
        from: "2026-10-01T01:00:00Z",
        to: "2026-10-01T01:10:00Z",
      },
    ],
  };
  const file = (text: string) => ({ text: async () => text });

  it("reads a catalog from a file's text", () => {
    expect(catalogOfText(JSON.stringify(DOC))).toEqual(DOC);
    expect(catalogOfText(`  ${JSON.stringify(DOC, null, 2)}\n`)).toEqual(DOC);
    // A signed catalog is its text.
    expect(catalogOfText("aaa.bbb.ccc\n")).toBe("aaa.bbb.ccc");
    // Anything else is no catalog: another JSON document, a view, plain text, a broken file.
    expect(catalogOfText(JSON.stringify({ kipscope: "view", version: 1 }))).toBeUndefined();
    expect(catalogOfText("hello world")).toBeUndefined();
    expect(catalogOfText("{ not json")).toBeUndefined();
    expect(catalogOfText("")).toBeUndefined();
    expect(catalogOfText("a.b")).toBeUndefined();
  });

  it("opens a dropped catalog", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe("/api/workspaces");
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({ workspace: { id: "abcdefghij" }, case: { count: 1 } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const go = vi.fn();
    expect(await openDroppedCatalog(file(JSON.stringify(DOC)), { go })).toBe(true);
    // The document is posted as it is, then the tab goes to the new workspace.
    expect(bodies).toEqual([{ open: { cases: DOC } }]);
    expect(go).toHaveBeenCalledWith("/w/abcdefghij");
  });

  it("carries the open report across the page load", async () => {
    const report = {
      count: 1,
      current: 0,
      dataRefs: ["testcar"],
      missing: [],
      warnings: [
        "origin.url https://evil.example/ dropped: its origin is not in KIPSCOPE_FINDER_ORIGINS",
      ],
    };
    const open = vi.fn().mockResolvedValue({ workspace: { id: "w1" }, case: report });
    const entries = new Map<string, string>();
    const store = {
      getItem: (k: string) => entries.get(k) ?? null,
      setItem: (k: string, v: string) => void entries.set(k, v),
      removeItem: (k: string) => void entries.delete(k),
    };
    const go = vi.fn();
    expect(await openDroppedCatalog(file(JSON.stringify(DOC)), { open, go, store })).toBe(true);
    expect(go).toHaveBeenCalledWith("/w/w1");

    // The page after the load takes the report once.
    expect(takeCaseReport("w1", store)).toEqual(report);
    expect(takeCaseReport("w1", store)).toBeUndefined();

    // A report stored for w1 is not w2's, and the entry is gone either way.
    await openDroppedCatalog(file(JSON.stringify(DOC)), { open, go: vi.fn(), store });
    expect(entries.has(CASE_REPORT_KEY)).toBe(true);
    expect(takeCaseReport("w2", store)).toBeUndefined();
    expect(entries.has(CASE_REPORT_KEY)).toBe(false);
    expect(takeCaseReport("w1", store)).toBeUndefined();

    // A storage that throws loses the report but not the page load.
    const broken = {
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
    const goBroken = vi.fn();
    expect(
      await openDroppedCatalog(file(JSON.stringify(DOC)), { open, go: goBroken, store: broken }),
    ).toBe(true);
    expect(goBroken).toHaveBeenCalledWith("/w/w1");
    expect(takeCaseReport("w1", broken)).toBeUndefined();
  });

  it("leaves a file that is no catalog alone", async () => {
    const open = vi.fn();
    const go = vi.fn();
    expect(await openDroppedCatalog(file("hello"), { open, go })).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
  });

  it("passes the server's refusal on and goes nowhere", async () => {
    const go = vi.fn();
    const open = vi.fn().mockRejectedValue(new Error("invalid_catalog: cases: no sessions"));
    await expect(openDroppedCatalog(file(JSON.stringify(DOC)), { open, go })).rejects.toThrow(
      "invalid_catalog",
    );
    expect(go).not.toHaveBeenCalled();
  });

  it("accepts a file drop when it is handed the files", () => {
    const target = new EventTarget();
    const seen: string[][] = [];
    const remove = ignoreFileDrops(target, (files) => seen.push(files.map((f) => f.name)));
    const drag = (type: "dragover" | "drop", files: { name: string }[] = []) => {
      const event = new Event(type, { cancelable: true });
      const dataTransfer = { types: ["Files"], dropEffect: "none", files };
      Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      return { event, dataTransfer };
    };
    const over = drag("dragover");
    target.dispatchEvent(over.event);
    expect(over.event.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe("copy");
    const drop = drag("drop", [{ name: "c4.json" }]);
    target.dispatchEvent(drop.event);
    expect(drop.event.defaultPrevented).toBe(true);
    expect(seen).toEqual([["c4.json"]]);
    remove();
  });
});
