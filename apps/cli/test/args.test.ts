import { describe, expect, it } from "vitest";
import { parseArgs, USAGE } from "../src/args.ts";
import { CliError } from "../src/output.ts";
import { type Lookups, resolveCommand } from "../src/refs.ts";

// Tests run with TZ=Europe/Berlin (see package.json); 2026-10-13 15:08:00 local = 1791896880 s.
const S1 = "1791896880000000000"; // 2026-10-13 15:08:00 local
const S4 = "1791896883000000000"; // 2026-10-13 15:08:03 local

/** Lookups that fail the test when a form needs a read it must not need. */
const noLookups: Lookups = {
  workspace: async () => {
    throw new Error("unexpected workspace lookup");
  },
  search: async () => {
    throw new Error("unexpected search lookup");
  },
};

async function commandOf(argv: string[]): Promise<unknown> {
  const { invocation } = parseArgs(argv, {});
  if (invocation.kind !== "command") throw new Error(`not a command: ${invocation.kind}`);
  return JSON.parse(JSON.stringify(await resolveCommand(invocation.template, noLookups)));
}

function usageError(argv: string[]): CliError {
  try {
    parseArgs(argv, {});
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error(`parsed without error: ${JSON.stringify(argv)}`);
}

const RPM = "testcar/Sna_800h.RPM";

// One row per form of design L2: [argv, command sent].
const FORMS: [string[], Record<string, unknown>][] = [
  [["window", "create"], { type: "window.create" }],
  [
    ["window", "create", "--values", "--title", "Readout"],
    { type: "window.create", kind: "values", title: "Readout" },
  ],
  [
    ["window", "create", "--values", "--mode", "step"],
    { type: "window.create", kind: "values", mode: "step" },
  ],
  [
    [
      "window",
      "create",
      "--title",
      "Speeds",
      "--from",
      "2026-10-13 15:08:00",
      "--to",
      "2026-10-13 15:08:03",
    ],
    { type: "window.create", title: "Speeds", from: S1, to: S4 },
  ],
  [
    ["window", "create", "--from", "0", "--to", "10", "--mode", "markers", "--envelope", "on"],
    { type: "window.create", from: "0", to: "10", mode: "markers", envelope: true },
  ],
  [["window", "create", "--envelope", "off"], { type: "window.create", envelope: false }],
  [["window", "remove", "w1"], { type: "window.remove", windowId: "w1" }],
  [["window", "rename", "w1", "Speed"], { type: "window.rename", windowId: "w1", title: "Speed" }],
  [["window", "rename", "w2", ""], { type: "window.rename", windowId: "w2", title: "" }],
  [["window", "height", "w1", "300"], { type: "window.setHeight", windowId: "w1", height: 300 }],
  [
    ["window", "range", "w1", "2026-10-13 15:08:00", "2026-10-13 15:08:03"],
    { type: "window.setRange", windowId: "w1", from: S1, to: S4 },
  ],
  [
    ["window", "range", "w1", "2026-10-13T13:08:00Z", "2026-10-13T15:08:03+02:00"],
    { type: "window.setRange", windowId: "w1", from: S1, to: S4 },
  ],
  [
    ["window", "display", "w1", "--mode", "step"],
    { type: "window.setDisplay", windowId: "w1", mode: "step" },
  ],
  [
    ["window", "display", "w1", "--envelope", "on"],
    { type: "window.setDisplay", windowId: "w1", envelope: true },
  ],
  [
    ["window", "display", "w1", "--mode", "markers", "--envelope", "off"],
    { type: "window.setDisplay", windowId: "w1", mode: "markers", envelope: false },
  ],
  [["link", "on"], { type: "workspace.setLinkTime", linked: true }],
  [["link", "off"], { type: "workspace.setLinkTime", linked: false }],
  [["digits", "3"], { type: "workspace.setOptions", digits: 3 }],
  [["digits", "4"], { type: "workspace.setOptions", digits: 4 }],
  [["signal", "add", "w1", RPM], { type: "window.addSignal", windowId: "w1", signalId: RPM }],
  [
    ["signal", "remove", "w1", "a2"],
    { type: "window.removeSignal", windowId: "w1", assignmentId: "a2" },
  ],
  [
    ["signal", "move", "w1", "a2", "w3"],
    { type: "window.moveSignal", windowId: "w1", assignmentId: "a2", targetWindowId: "w3" },
  ],
  [
    ["signal", "move", "w1", "a2", "w3", "--copy"],
    {
      type: "window.moveSignal",
      windowId: "w1",
      assignmentId: "a2",
      targetWindowId: "w3",
      copy: true,
    },
  ],
  [
    ["signal", "move", "w1", "a2", "new"],
    { type: "window.moveSignal", windowId: "w1", assignmentId: "a2" },
  ],
  [
    ["signal", "move", "w1", "a2", "new", "--copy"],
    { type: "window.moveSignal", windowId: "w1", assignmentId: "a2", copy: true },
  ],
  [
    ["cursor", "set", "a", "1791896880093000000"],
    { type: "cursor.set", cursor: "a", t: "1791896880093000000" },
  ],
  [
    ["cursor", "set", "b", "2026-10-13T13:08:00.093Z"],
    { type: "cursor.set", cursor: "b", t: "1791896880093000000" },
  ],
  [
    ["cursor", "set", "a", "2026-10-13 15:08:00.093"],
    { type: "cursor.set", cursor: "a", t: "1791896880093000000" },
  ],
  [["cursor", "move", "a", "+500ms"], { type: "cursor.move", cursor: "a", by: "500000000" }],
  [["cursor", "move", "a", "500ms"], { type: "cursor.move", cursor: "a", by: "500000000" }],
  [["cursor", "move", "b", "-1.5s"], { type: "cursor.move", cursor: "b", by: "-1500000000" }],
  [["cursor", "move", "b", "-2ms"], { type: "cursor.move", cursor: "b", by: "-2000000" }],
  [["cursor", "remove", "b"], { type: "cursor.remove", cursor: "b" }],
  [["measurement", "name", "Testfahrt A9"], { type: "measurement.set", name: "Testfahrt A9" }],
  [["measurement", "object", ""], { type: "measurement.set", object: "" }],
  [
    ["measurement", "meta", "driver", "Jan"],
    { type: "measurement.setMeta", key: "driver", value: "Jan" },
  ],
  [
    ["measurement", "meta", "driver", ""],
    { type: "measurement.setMeta", key: "driver", value: "" },
  ],
  [["measurement", "clear"], { type: "measurement.clear" }],
  [["diff", "on"], { type: "cursor.setDiff", diff: true }],
  [["diff", "off"], { type: "cursor.setDiff", diff: false }],
  [
    ["command", '{"type":"workspace.setLinkTime","linked":false}'],
    { type: "workspace.setLinkTime", linked: false },
  ],
  [["command", '{"type":"nope","x":[1,2]}'], { type: "nope", x: [1, 2] }],
];

describe("argument grammar", () => {
  it("maps every command form to its command", async () => {
    for (const [argv, expected] of FORMS) {
      expect(await commandOf(argv), argv.join(" ")).toEqual(expected);
    }
  });

  it("reads the read forms", () => {
    const parse = (...argv: string[]) => parseArgs(argv, {}).invocation;
    expect(parse("state")).toEqual({ kind: "state" });
    expect(parse("search", "volt")).toEqual({ kind: "search", query: "volt" });
    expect(parse("search", "eac", "hv", "--limit", "3")).toEqual({
      kind: "search",
      query: "eac hv",
      limit: 3,
    });
    expect(parse("extent", RPM)).toEqual({ kind: "extent", signal: { kind: "id", id: RPM } });
    expect(parse("extent", "RPM")).toEqual({
      kind: "extent",
      signal: { kind: "name", name: "RPM" },
    });
    expect(parse("value", RPM, "1791896880093000000")).toEqual({
      kind: "value",
      signal: { kind: "id", id: RPM },
      t: { kind: "abs", t: 1791896880093000000n },
    });
    expect(parse("value", RPM, "a", "--mode", "step")).toEqual({
      kind: "value",
      signal: { kind: "id", id: RPM },
      t: { kind: "anchor", cursor: "a", offset: 0n },
      mode: "step",
    });
    expect(parse("wait")).toEqual({ kind: "wait" });
    expect(parse("wait", "5")).toEqual({ kind: "wait", revision: 5 });
    expect(parse("--help")).toEqual({ kind: "help" });
    expect(parse("-h")).toEqual({ kind: "help" });
  });

  it("reads anchors with offsets", () => {
    const template = (...argv: string[]) => {
      const { invocation } = parseArgs(argv, {});
      if (invocation.kind !== "command") throw new Error("not a command");
      return invocation.template;
    };
    expect(template("cursor", "set", "b", "a+500ms").t).toEqual({
      kind: "anchor",
      cursor: "a",
      offset: 500_000_000n,
    });
    expect(template("cursor", "set", "a", "b-1.5s").t).toEqual({
      kind: "anchor",
      cursor: "b",
      offset: -1_500_000_000n,
    });
    const range = template("window", "range", "w1", "a-1s", "a+1s");
    expect(range.from).toEqual({ kind: "anchor", cursor: "a", offset: -1_000_000_000n });
    expect(range.to).toEqual({ kind: "anchor", cursor: "a", offset: 1_000_000_000n });
  });

  it("reads bare names and name references", () => {
    const { invocation } = parseArgs(["signal", "add", "w1", "rpm"], {});
    if (invocation.kind !== "command") throw new Error("not a command");
    expect(invocation.template.signalId).toEqual({ kind: "name", name: "rpm" });
    const ref = parseArgs(["signal", "remove", "w1", "RPM"], {}).invocation;
    if (ref.kind !== "command") throw new Error("not a command");
    expect(ref.template.assignmentId).toEqual({ kind: "name", name: "RPM" });
    const full = parseArgs(["signal", "remove", "w1", RPM], {}).invocation;
    if (full.kind !== "command") throw new Error("not a command");
    expect(full.template.assignmentId).toEqual({ kind: "id", id: RPM });
    const byId = parseArgs(["signal", "remove", "w1", "a12"], {}).invocation;
    if (byId.kind !== "command") throw new Error("not a command");
    expect(byId.template.assignmentId).toEqual({ kind: "assignment", id: "a12" });
  });

  it("takes global options anywhere on the line", () => {
    const base = parseArgs(["diff", "on"], {});
    expect(base.options).toEqual({
      server: "http://localhost:7310",
      wait: false,
      timeoutMs: 30_000,
      pretty: false,
    });
    for (const argv of [
      ["--wait", "--pretty", "--timeout", "5s", "--server", "http://x:1", "diff", "on"],
      ["diff", "--wait", "on", "--pretty", "--timeout", "5s", "--server", "http://x:1"],
      ["diff", "on", "--wait", "--pretty", "--timeout=5s", "--server=http://x:1"],
    ]) {
      const parsed = parseArgs(argv, {});
      expect(parsed.options, argv.join(" ")).toEqual({
        server: "http://x:1",
        wait: true,
        timeoutMs: 5000,
        pretty: true,
      });
      expect(parsed.invocation).toEqual(base.invocation);
    }
    expect(parseArgs(["--timeout", "500ms", "state"], {}).options.timeoutMs).toBe(500);
    expect(parseArgs(["--timeout", "1min", "state"], {}).options.timeoutMs).toBe(60_000);
  });

  it("chooses the server address: --server, else KIPSCOPE_URL, else localhost:7310", () => {
    const env = { KIPSCOPE_URL: "http://env:2" };
    expect(parseArgs(["state"], {}).options.server).toBe("http://localhost:7310");
    expect(parseArgs(["state"], env).options.server).toBe("http://env:2");
    expect(parseArgs(["--server", "http://flag:3", "state"], env).options.server).toBe(
      "http://flag:3",
    );
  });

  it("reads -<digit> tokens as values, not options", async () => {
    expect(await commandOf(["cursor", "move", "a", "-1.5s"])).toEqual({
      type: "cursor.move",
      cursor: "a",
      by: "-1500000000",
    });
    expect(await commandOf(["cursor", "set", "a", "-5"])).toEqual({
      type: "cursor.set",
      cursor: "a",
      t: "-5",
    });
    // Options may follow such a value; `--` ends option parsing.
    expect(parseArgs(["cursor", "move", "a", "-2ms", "--wait"], {}).options.wait).toBe(true);
    expect(await commandOf(["window", "rename", "w1", "--", "-x"])).toEqual({
      type: "window.rename",
      windowId: "w1",
      title: "-x",
    });
  });

  it("refuses malformed lines as usage errors", () => {
    const bad: string[][] = [
      ["frobnicate"],
      ["window"],
      ["window", "frobnicate"],
      ["window", "remove"],
      ["window", "remove", "w1", "w2"],
      ["window", "create", "--from", "0"],
      ["window", "create", "--to", "10"],
      ["window", "create", "--envelope", "maybe"],
      ["window", "create", "--from", "yesterday", "--to", "0"],
      ["window", "display", "w1"],
      ["window", "height", "w1", "3.5"],
      ["window", "height", "w1", "tall"],
      ["window", "range", "w1", "2026-10-13"],
      ["window", "range", "w1", "0"],
      ["window", "range", "w1", "2026-10-13", "2026-10-14"],
      ["link"],
      ["link", "maybe"],
      ["digits"],
      ["digits", "5"],
      ["digits", "3", "4"],
      ["digits", "four"],
      ["diff", "sideways"],
      ["measurement"],
      ["measurement", "name"],
      ["measurement", "name", "a", "b"],
      ["measurement", "object"],
      ["measurement", "meta"],
      ["measurement", "meta", "driver"],
      ["measurement", "meta", "driver", "Jan", "extra"],
      ["measurement", "clear", "now"],
      ["measurement", "colour", "red"],
      ["signal", "add", "w1"],
      ["signal", "move", "w1", "a2"],
      ["cursor", "set", "c", "0"],
      ["cursor", "set", "a"],
      ["cursor", "set", "a", "2026-10-25 02:30"],
      ["cursor", "set", "a", "2026-03-29 02:30"],
      ["cursor", "set", "a", "1850-01-01T00:00:00Z"],
      ["cursor", "move", "a", "500"],
      ["cursor", "move", "a", "2m"],
      ["cursor", "move", "a", "0.5ns"],
      ["cursor", "remove"],
      ["command"],
      ["command", "{"],
      ["state", "extra"],
      ["search"],
      ["search", "volt", "--limit", "many"],
      ["extent"],
      ["value", RPM],
      ["value", RPM, "0", "--mode", "markers"],
      ["wait", "soon"],
      ["state", "--timeout", "0"],
      ["state", "--timeout", "30"],
      ["state", "--timeout"],
      ["state", "--server"],
      ["state", "--frobnicate"],
    ];
    for (const argv of bad) {
      const error = usageError(argv);
      expect(error.outcome, JSON.stringify(argv)).toBe("usage");
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it("names 3|4 in the digits usage error", () => {
    expect(usageError(["digits", "5"]).message).toContain("3|4");
  });

  it("names every form in the usage text", () => {
    for (const form of [
      "window create",
      "window remove",
      "window rename",
      "window height",
      "window range",
      "window display",
      "link",
      "digits",
      "signal add",
      "signal remove",
      "signal move",
      "cursor set",
      "cursor move",
      "cursor remove",
      "diff",
      "command",
      "state",
      "search",
      "extent",
      "value",
      "wait",
      "--server",
      "--wait",
      "--timeout",
      "--pretty",
      "--help",
    ]) {
      expect(USAGE, form).toContain(form);
    }
  });
});
