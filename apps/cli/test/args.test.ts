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
  [["events", "filter", "faults", "bms"], { type: "events.setFilter", filter: "faults bms" }],
  [
    ["events", "filter", "changes", "-snapshots"],
    { type: "events.setFilter", filter: "changes -snapshots" },
  ],
  [["events", "filter", ""], { type: "events.setFilter", filter: "" }],
  [
    ["events", "add", "testcar/Ign_A20h.MODE"],
    { type: "events.addSignal", signalId: "testcar/Ign_A20h.MODE" },
  ],
  [
    ["events", "remove", "testcar/Ign_A20h.MODE"],
    { type: "events.removeSignal", signalId: "testcar/Ign_A20h.MODE" },
  ],
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

  it("resolves a bare name in the events forms and refuses the malformed ones", async () => {
    // `events remove MODE`: the bare name goes through the search like `signal add`.
    const { invocation } = parseArgs(["events", "remove", "MODE"], {});
    if (invocation.kind !== "command") throw new Error("not a command");
    expect(invocation.template.signalId).toEqual({ kind: "name", name: "MODE" });
    const resolved = await resolveCommand(invocation.template, {
      workspace: noLookups.workspace,
      search: async () => ({
        items: [{ id: "testcar/Ign_A20h.MODE", dataRef: "testcar", name: "Ign_A20h.MODE" }],
        total: 1,
        more: false,
      }),
    });
    expect(JSON.parse(JSON.stringify(resolved))).toEqual({
      type: "events.removeSignal",
      signalId: "testcar/Ign_A20h.MODE",
    });

    // `events filter` needs at least one word (the empty string counts); unknown forms are usage errors.
    for (const argv of [
      ["events"],
      ["events", "frob"],
      ["events", "filter"],
      ["events", "add"],
      ["events", "remove"],
      ["events", "add", "a", "b"],
      ["events", "list", "--from", "2026-10-01T00:00Z"],
      ["events", "list", "--to", "2026-10-01T00:00Z"],
      ["events", "list", "--ref"],
    ]) {
      expect(usageError(argv).outcome, argv.join(" ")).toBe("usage");
    }
  });

  it("reads the events list form", () => {
    const parse = (...argv: string[]) => parseArgs(argv, {}).invocation;
    expect(parse("events", "list")).toMatchObject({ kind: "events", table: false });
    expect(parse("events", "list")).not.toHaveProperty("filter");
    expect(parse("events", "list", "faults", "ecu:bms")).toMatchObject({
      kind: "events",
      filter: "faults ecu:bms",
    });
    expect(parse("events", "list", "--table", "--ref", "testcar")).toMatchObject({
      kind: "events",
      table: true,
      dataRef: "testcar",
    });
    expect(
      parse(
        "events",
        "list",
        "changes",
        "--from",
        "2026-10-01T00:00Z",
        "--to",
        "2026-10-01T03:00Z",
      ),
    ).toMatchObject({
      kind: "events",
      filter: "changes",
      from: { kind: "abs", t: 1790812800000000000n },
      to: { kind: "abs", t: 1790823600000000000n },
    });
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

  it("keeps single-dash words as arguments", async () => {
    const { invocation } = parseArgs(["events", "list", "all", "-snapshots", "-ecu:VCU"], {});
    expect(invocation).toMatchObject({ kind: "events", filter: "all -snapshots -ecu:VCU" });
    // Any other command takes them as values as well.
    expect(await commandOf(["window", "rename", "w1", "-x"])).toEqual({
      type: "window.rename",
      windowId: "w1",
      title: "-x",
    });
    // -h is still the help; --long words are still options.
    expect(parseArgs(["-h"], {}).invocation).toEqual({ kind: "help" });
    expect(parseArgs(["events", "list", "-h"], {}).invocation).toEqual({ kind: "help" });
    expect(parseArgs(["events", "list", "--table"], {}).invocation).toMatchObject({ table: true });
    expect(usageError(["events", "list", "--bogus"]).outcome).toBe("usage");
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
      "events list",
      "events filter",
      "events add",
      "events remove",
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

describe("view forms (add-saved-views)", () => {
  const parse = (...argv: string[]) => parseArgs(argv, {}).invocation;

  it("maps the view forms", () => {
    // The requests of design V8, as the forms build them.
    expect(
      parse("view", "save", "Drive 3", "--note", "BRK_LMP first", "--overwrite"),
    ).toMatchObject({
      kind: "view",
      action: "save",
      request: { title: "Drive 3", note: "BRK_LMP first", overwrite: true },
    });
    expect(parse("view", "open", "drive-3")).toMatchObject({
      kind: "view",
      action: "open",
      request: { name: "drive-3" },
    });
    expect(parse("view", "import", "x.yaml", "--name", "copy", "--open")).toMatchObject({
      kind: "view",
      action: "import",
      file: "x.yaml",
      request: { name: "copy", open: true },
    });
    // No title: a usage error.
    const error = usageError(["view", "save"]);
    expect(error.outcome).toBe("usage");

    // The other forms.
    expect(parse("view", "list")).toMatchObject({ kind: "view", action: "list" });
    expect(parse("view", "delete", "drive-3")).toMatchObject({
      kind: "view",
      action: "delete",
      name: "drive-3",
    });
    expect(parse("view", "export", "drive-3")).toMatchObject({
      kind: "view",
      action: "export",
      name: "drive-3",
    });
    expect(parse("view", "export", "drive-3", "--out", "v.yaml")).toMatchObject({
      kind: "view",
      action: "export",
      name: "drive-3",
      out: "v.yaml",
    });
    // `view link`: the page defaults to the --server address.
    expect(parse("view", "link")).toMatchObject({
      kind: "view",
      action: "link",
      page: "http://localhost:7310",
    });
    expect(
      parseArgs(["view", "link", "--server", "http://127.0.0.1:7310"], {}).invocation,
    ).toMatchObject({ kind: "view", action: "link", page: "http://127.0.0.1:7310" });
    expect(parse("view", "link", "--page", "http://127.0.0.1:5173/")).toMatchObject({
      kind: "view",
      action: "link",
      page: "http://127.0.0.1:5173/",
    });
    expect(usageError(["view", "link", "--page", "nope"]).outcome).toBe("usage");
    // Options the form does not take, and the wrong number of arguments.
    for (const argv of [
      ["view"],
      ["view", "frob"],
      ["view", "list", "x"],
      ["view", "open"],
      ["view", "open", "a", "b"],
      ["view", "delete"],
      ["view", "export"],
      ["view", "import"],
      ["view", "save", "T", "--out", "f"],
      ["view", "open", "a", "--overwrite"],
    ]) {
      expect(usageError(argv).outcome).toBe("usage");
    }
  });

  it("names the view forms in the usage text", () => {
    for (const form of [
      "view list",
      "view save",
      "view open",
      "view delete",
      "view export",
      "view import",
    ]) {
      expect(USAGE).toContain(form);
    }
  });
});

describe("scope forms (add-scope Z13)", () => {
  // 2026-10-01T01:00:00Z and 02:00:00Z in ns, by hand.
  const T1 = "1790816400000000000";
  const T2 = "1790820000000000000";

  it("maps the scope forms", async () => {
    expect(
      await commandOf(["scope", "set", "testcar", "2026-10-01T01:00:00Z", "2026-10-01T02:00:00Z"]),
    ).toEqual({ type: "scope.set", dataRef: "testcar", from: T1, to: T2 });
    // Local times (TZ Europe/Berlin, +02:00) and decimal ns are TIME arguments like everywhere.
    expect(
      await commandOf(["scope", "set", "testcar", "2026-10-01 03:00", "2026-10-01 04:00"]),
    ).toEqual({ type: "scope.set", dataRef: "testcar", from: T1, to: T2 });
    expect(await commandOf(["scope", "set", "testcar", T1, T2])).toEqual({
      type: "scope.set",
      dataRef: "testcar",
      from: T1,
      to: T2,
    });
    expect(await commandOf(["scope", "clear"])).toEqual({ type: "scope.clear" });

    // scope show and scope widen read the server; they are no plain commands.
    expect(parseArgs(["scope", "show"], {}).invocation).toMatchObject({
      kind: "scope",
      action: "show",
    });
    expect(parseArgs(["scope", "widen"], {}).invocation).toMatchObject({
      kind: "scope",
      action: "widen",
    });

    // A missing or extra argument is a usage error (outcome usage, exit 2, nothing sent).
    for (const argv of [
      ["scope", "set", "testcar", "2026-10-01T01:00:00Z"],
      ["scope", "set", "testcar"],
      ["scope", "set"],
      ["scope", "set", "testcar", "2026-10-01T01:00:00Z", "2026-10-01T02:00:00Z", "extra"],
      ["scope", "show", "extra"],
      ["scope", "widen", "extra"],
      ["scope", "clear", "extra"],
      ["scope"],
      ["scope", "nope"],
    ]) {
      expect(usageError(argv).outcome, argv.join(" ")).toBe("usage");
    }
  });

  it("lists the scope forms in the usage text", () => {
    for (const form of ["scope set", "scope show", "scope widen", "scope clear"]) {
      expect(USAGE, form).toContain(form);
    }
  });
});

describe("workspace and token options (add-multiuser M13)", () => {
  const optionsOf = (argv: string[], env: Record<string, string | undefined> = {}) =>
    parseArgs([...argv, "state"], env).options;

  it("reads the workspace and the token", () => {
    // The page link, the legacy page link and an explicit workspace link name server and ID.
    for (const server of ["https://k.example/w/abcdefghij", "https://k.example/s/abcdefghij"]) {
      const link = optionsOf(["--server", server]);
      expect([link.server, link.workspace], server).toEqual(["https://k.example", "abcdefghij"]);
    }
    const both = optionsOf([
      "--server",
      "https://k.example",
      "--workspace",
      "https://k.example/w/abcdefghij",
    ]);
    expect([both.server, both.workspace]).toEqual(["https://k.example", "abcdefghij"]);
    // --workspace wins over KIPSCOPE_WORKSPACE, which wins over nothing.
    expect(
      optionsOf(["--workspace", "abcdefghij"], { KIPSCOPE_WORKSPACE: "bbbbbbbbbb" }).workspace,
    ).toBe("abcdefghij");
    expect(optionsOf([], { KIPSCOPE_WORKSPACE: "bbbbbbbbbb" }).workspace).toBe("bbbbbbbbbb");
    expect(optionsOf([]).workspace).toBeUndefined();
    // A workspace link in KIPSCOPE_WORKSPACE names its ID only.
    expect(optionsOf([], { KIPSCOPE_WORKSPACE: "https://k.example/w/cccccccccc" }).workspace).toBe(
      "cccccccccc",
    );
    // An explicit --workspace wins over the workspace of a --server link.
    expect(
      optionsOf(["--server", "https://k.example/w/abcdefghij", "--workspace", "bbbbbbbbbb"])
        .workspace,
    ).toBe("bbbbbbbbbb");
    // An API-prefixed link names the same workspace.
    expect(optionsOf(["--workspace", "https://k.example/api/w/abcdefghij/live"]).workspace).toBe(
      "abcdefghij",
    );
    for (const bad of ["ABC", "abcdefghi", "abcdefghijk", "https://k.example/x", "", "../x"])
      expect(usageError(["--workspace", bad, "state"]).outcome, bad).toBe("usage");
    expect(() => parseArgs(["state"], { KIPSCOPE_WORKSPACE: "not a workspace" })).toThrow(CliError);
    // The old names are gone: --session is an unknown option, KIPSCOPE_SESSION is not read.
    expect(usageError(["--session", "abcdefghij", "state"]).outcome).toBe("usage");
    expect(optionsOf([], { KIPSCOPE_SESSION: "bbbbbbbbbb" }).workspace).toBeUndefined();

    // The token: --token, else KIPSCOPE_TOKEN, else KIPSCOPE_TOKEN_COMMAND (only without a token).
    const flag = optionsOf(["--token", "T1"], {
      KIPSCOPE_TOKEN: "T2",
      KIPSCOPE_TOKEN_COMMAND: "echo T3",
    });
    expect(flag.token).toBe("T1");
    expect(flag.tokenCommand).toBeUndefined();
    const env = optionsOf([], { KIPSCOPE_TOKEN: " T2 ", KIPSCOPE_TOKEN_COMMAND: "echo T3" });
    expect(env.token).toBe("T2");
    expect(env.tokenCommand).toBeUndefined();
    const command = optionsOf([], { KIPSCOPE_TOKEN_COMMAND: "echo T3" });
    expect(command.token).toBeUndefined();
    expect(command.tokenCommand).toBe("echo T3");
    const none = optionsOf([]);
    expect([none.token, none.tokenCommand]).toEqual([undefined, undefined]);
    expect(usageError(["--token", "", "state"]).outcome).toBe("usage");
  });

  it("maps the workspace forms", () => {
    const kind = (argv: string[]) => parseArgs(argv, {}).invocation;
    expect(kind(["whoami"])).toEqual({ kind: "whoami" });
    expect(kind(["workspace", "list"])).toEqual({ kind: "workspace", action: "list" });
    expect(kind(["workspace", "new"])).toEqual({ kind: "workspace", action: "new" });
    expect(kind(["workspace", "share", "read"])).toEqual({
      kind: "workspace",
      action: "share",
      share: "read",
    });
    for (const share of ["private", "read", "write"])
      expect(kind(["workspace", "share", share])).toMatchObject({ action: "share", share });
    expect(kind(["workspace", "delete", "abcdefghij"])).toEqual({
      kind: "workspace",
      action: "delete",
      id: "abcdefghij",
    });
    // Usage errors: another share level, a missing or extra argument, a bad ID, an unknown action,
    // and the session forms, which are unknown commands now.
    for (const bad of [
      ["workspace", "share", "public"],
      ["workspace", "share"],
      ["workspace", "share", "read", "write"],
      ["workspace", "delete"],
      ["workspace", "delete", "ABC"],
      ["workspace", "delete", "abcdefghij", "extra"],
      ["workspace", "new", "extra"],
      ["workspace", "list", "extra"],
      ["workspace"],
      ["workspace", "rename"],
      ["session", "list"],
      ["session", "new"],
      ["session", "share", "read"],
      ["session", "delete", "abcdefghij"],
      ["whoami", "extra"],
    ])
      expect(usageError(bad).outcome, bad.join(" ")).toBe("usage");
  });

  it("names the new forms and options in the usage text", () => {
    for (const word of [
      "whoami",
      "workspace list",
      "workspace new",
      "workspace share",
      "workspace delete",
      "--workspace",
      "--token",
      "KIPSCOPE_WORKSPACE",
      "KIPSCOPE_TOKEN",
      "KIPSCOPE_TOKEN_COMMAND",
    ])
      expect(USAGE, word).toContain(word);
    expect(USAGE).not.toMatch(/\bsession/i);
  });
});

describe("case forms (add-case-open K15)", () => {
  /** A workspace that holds a catalog at 0-based entry 2, for `case link` without N. */
  const heldAtTwo: Lookups = {
    ...noLookups,
    workspace: async () => ({ revision: 3, workspace: { case: { current: 2 } } }) as never,
  };
  async function sent(argv: string[], lookups: Lookups = noLookups): Promise<unknown> {
    const { invocation } = parseArgs(argv, {});
    if (invocation.kind !== "command") throw new Error(`not a command: ${invocation.kind}`);
    return JSON.parse(JSON.stringify(await resolveCommand(invocation.template, lookups)));
  }

  it("maps the case forms", async () => {
    const forms: [string[], unknown][] = [
      [["case", "next"], { type: "case.step", by: 1 }],
      [["case", "prev"], { type: "case.step", by: -1 }],
      // Positions are 1-based in the CLI, 0-based in the command.
      [["case", "go", "3"], { type: "case.go", index: 2 }],
      [["case", "link", "2"], { type: "case.go", index: 1 }],
      [["case", "unlink"], { type: "case.unlink" }],
      [["case", "align", "anchor"], { type: "case.align", align: { mode: "anchor" } }],
      [["case", "align", "start"], { type: "case.align", align: { mode: "start" } }],
      [["case", "align", "end"], { type: "case.align", align: { mode: "end" } }],
      [
        ["case", "align", "event", "dtc", "ECU1", "B1234"],
        {
          type: "case.align",
          align: { mode: "event", event: { kind: "dtc", source: "ECU1", name: "B1234" } },
        },
      ],
      [
        ["case", "align", "event", "state", "VCU", "Ign_A20h.MODE", "KEYON"],
        {
          type: "case.align",
          align: {
            mode: "event",
            event: { kind: "state", source: "VCU", name: "Ign_A20h.MODE", text: "KEYON" },
          },
        },
      ],
    ];
    for (const [argv, command] of forms) expect(await sent(argv), argv.join(" ")).toEqual(command);

    // `case link` without N goes to the workspace's current entry, read at run time.
    expect(await sent(["case", "link"], heldAtTwo)).toEqual({ type: "case.go", index: 2 });
    // A workspace without a catalog refuses it.
    const noCase: Lookups = {
      ...noLookups,
      workspace: async () => ({ revision: 1, workspace: {} }) as never,
    };
    await expect(sent(["case", "link"], noCase)).rejects.toMatchObject({ code: "no_case" });
  });

  it("refuses a bad position and malformed case forms as usage errors", () => {
    for (const argv of [
      ["case", "go", "0"],
      ["case", "go", "-1"],
      ["case", "go", "x"],
      ["case", "go"],
      ["case", "go", "1", "2"],
      ["case", "link", "0"],
      ["case", "next", "1"],
      ["case", "align"],
      ["case", "align", "middle"],
      ["case", "align", "event", "dtc", "ECU1"],
      ["case", "align", "event", "dtc", "ECU1", "B1", "t", "extra"],
      ["case", "open"],
      ["case", "url"],
      ["case", "drives"],
      ["case", "nothing"],
    ]) {
      expect(usageError(argv).code, argv.join(" ")).toBe("usage");
    }
  });

  it("reads the forms that are no plain command", () => {
    const kind = (argv: string[]) => parseArgs(argv, {}).invocation;
    expect(kind(["case", "open", "c4.json"])).toMatchObject({
      kind: "case",
      action: "open",
      file: "c4.json",
    });
    expect(kind(["case", "open", "-"])).toMatchObject({ kind: "case", action: "open", file: "-" });
    expect(kind(["case", "show"])).toMatchObject({ kind: "case", action: "show" });
    expect(kind(["case", "url", "c4.json"])).toMatchObject({
      kind: "case",
      action: "url",
      file: "c4.json",
    });
    expect(kind(["case", "drives", "smart451"])).toMatchObject({
      kind: "case",
      action: "drives",
      dataRef: "smart451",
    });
  });

  it("names the case forms in the usage text", () => {
    for (const form of [
      "case open FILE",
      "case show",
      "case next",
      "case prev",
      "case go N",
      "case link",
      "case unlink",
      "case align start|end|anchor",
      "case align event KIND SOURCE NAME",
      "case url FILE",
      "case drives REF",
    ]) {
      expect(USAGE, form).toContain(form);
    }
    expect(USAGE).toMatch(/test aid/);
  });
});
