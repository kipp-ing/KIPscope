import {
  decodeViewLink,
  EMPTY_WORKSPACE,
  encodeViewLink,
  type ViewDoc,
  viewLinkUrl,
  type Workspace,
} from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import { cleanAddress, startupView, viewLink } from "../src/views/link.ts";

const DOC: ViewDoc = {
  kipscope: "view",
  version: 1,
  title: "Drive 3",
  data: ["smart451"],
  linkTime: true,
  cursors: { a: "2026-10-13T13:08:01.5Z", diff: false },
  digits: 3,
  windows: [
    {
      kind: "timeseries",
      from: "2026-10-13T13:08:00Z",
      to: "2026-10-13T13:08:20Z",
      mode: "line",
      envelope: false,
      signals: ["smart451/ICL_3A2h.SPEED_DISP"],
    },
  ],
};

const at = (url: string) => new URL(`http://localhost:7310${url}`);

describe("view links in the page address", () => {
  it("reads a view from the address", async () => {
    const code = await encodeViewLink(DOC);

    // #view=<code>: the decoded document.
    expect(await startupView(at(`/#view=${code}`))).toEqual({
      view: JSON.parse(JSON.stringify(DOC)),
    });
    // ?view=<name>: the saved view of that name, found or not (the server decides).
    expect(await startupView(at("/?view=demo"))).toEqual({ name: "demo" });
    expect(await startupView(at("/?view=nope"))).toEqual({ name: "nope" });
    // Neither.
    expect(await startupView(at("/"))).toBeUndefined();
    expect(await startupView(at("/?other=1#frag"))).toBeUndefined();

    // The cleaned address keeps the path and drops query and fragment.
    expect(cleanAddress(at(`/#view=${code}`))).toBe("/");
    expect(cleanAddress(at("/app/?view=demo"))).toBe("/app/");
    expect(cleanAddress(at("/app/?view=demo&x=1#view=abc"))).toBe("/app/");
  });

  it("lets the self-contained link win over a name, and rejects a bad code", async () => {
    const code = await encodeViewLink(DOC);
    expect(await startupView(at(`/?view=demo#view=${code}`))).toMatchObject({
      view: { title: "Drive 3" },
    });
    await expect(startupView(at("/#view=@@@"))).rejects.toThrow();
  });
});

describe("copy link", () => {
  it("copies the shared link", async () => {
    const ws: Workspace = {
      ...EMPTY_WORKSPACE,
      windows: [
        {
          id: "w1",
          kind: "values",
          mode: "line",
          signals: [{ id: "a2", signalId: "car/A" }],
        },
      ],
      nextId: 3,
      view: { name: "drive-3", title: "Drive 3", note: "BRK_LMP first", modified: false },
    };
    const link = await viewLink(ws, { origin: "http://127.0.0.1:5173", pathname: "/" });
    // The web helper adds nothing of its own: it is the shared encoder's link.
    expect(link).toBe(await viewLinkUrl(ws, "http://127.0.0.1:5173/"));
    const doc = (await decodeViewLink(link.slice(link.indexOf("#view=") + 6))) as Record<
      string,
      unknown
    >;
    expect(doc.title).toBe("Drive 3");
    expect(doc.note).toBe("BRK_LMP first");
    expect("saved" in doc).toBe(false);
  });
});

describe("copy link on a session page (add-multiuser M12)", () => {
  const ws: Workspace = {
    ...EMPTY_WORKSPACE,
    windows: [
      { id: "w1", kind: "values", mode: "line", signals: [{ id: "a2", signalId: "car/A" }] },
    ],
    nextId: 3,
  };

  it("copies the shared link", async () => {
    // The link is built on the page's origin: the session in the path is not part of it.
    const link = await viewLink(ws, {
      origin: "http://127.0.0.1:5173",
      pathname: "/s/abcdefghij",
    });
    expect(link.startsWith("http://127.0.0.1:5173/#view=")).toBe(true);
    expect(link).not.toContain("/s/");
    expect(link).not.toContain("abcdefghij");
    expect(link).toBe(await viewLinkUrl(ws, "http://127.0.0.1:5173/"));
    // The same on a server behind its public name.
    const behind = await viewLink(ws, {
      origin: "https://kipscope.example.org",
      pathname: "/s/zzzzzzzzzz",
    });
    expect(behind.startsWith("https://kipscope.example.org/#view=")).toBe(true);
  });

  it("cleans a session address of the view part and keeps the session", async () => {
    expect(cleanAddress(at("/s/abcdefghij?view=demo"))).toBe("/s/abcdefghij");
    expect(await startupView(at("/s/abcdefghij?view=demo"))).toEqual({ name: "demo" });
    expect(await startupView(at("/s/abcdefghij"))).toBeUndefined();
  });
});
