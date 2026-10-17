import { encodeViewLink, type ViewDoc } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import { cleanAddress, startupView } from "../src/views/link.ts";

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
      signals: ["smart451/COMBI_412h.V_ANZ"],
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
