import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.ts";
import {
  type CliResult,
  cli,
  closedUrl,
  type Harness,
  runCli,
  sleep,
  startHangingServer,
  startServer,
} from "./helpers.ts";

// Tests run with TZ=Europe/Berlin (see package.json): 2026-10-13 is CEST (+02:00).
const RPM = "testcar/Sna_800h.RPM";
const SPEED = "testcar/Sna_800h.SPEED";
const T_13_08_00 = "2026-10-13T13:08:00Z"; // 1791896880 s, local 15:08:00
const T_13_08_03 = "2026-10-13T13:08:03Z";

const revisionOf = async (h: Harness) => (await h.workspace()).revision;
const window = (w: Awaited<ReturnType<Harness["workspace"]>>, id: string) => {
  const found = w.workspace.windows.find((x) => x.id === id);
  if (!found) throw new Error(`no window ${id}`);
  return found;
};

let h: Harness;
beforeAll(async () => {
  h = await startServer();
});
afterAll(() => h.close());

/** A fresh server per test body, closed afterwards. */
async function withServer<T>(
  fn: (s: Harness) => Promise<T>,
  options?: { loadCatalog?: boolean },
): Promise<T> {
  const s = await startServer(options);
  try {
    return await fn(s);
  } finally {
    await s.close();
  }
}

describe("server address and usage", () => {
  it("chooses --server over LETSVIEW_URL over localhost:7310", async () => {
    await withServer(async (a) => {
      await withServer(async (b) => {
        await b.command({ type: "cursor.setDiff", diff: true }); // b is at revision 1, a at 0
        const viaFlag = await runCli(["--server", a.url, "state"]);
        const viaEnv = await runCli(["state"], { LETSVIEW_URL: a.url });
        const both = await runCli(["--server", a.url, "state"], { LETSVIEW_URL: b.url });
        const onlyB = await runCli(["state"], { LETSVIEW_URL: b.url });
        expect(viaFlag.out.data.revision).toBe(0);
        expect(viaEnv.out.data.revision).toBe(0);
        expect(both.out.data.revision).toBe(0);
        expect(onlyB.out.data.revision).toBe(1);
        expect(b.requests.some((r) => r.includes("/api/workspace"))).toBe(true);
        // The default is a pure parsing fact; no call goes to a real localhost:7310 (a dev server).
        expect(parseArgs(["state"], {}).options.server).toBe("http://localhost:7310");
      });
    });
  });

  it("exits 2 for a server address without http(s) scheme", async () => {
    await withServer(async (s) => {
      const before = s.requests.length;
      const viaFlag = await runCli(["--server", "localhost:7310", "state"]);
      const viaEnv = await runCli(["state"], { LETSVIEW_URL: "localhost:7310" });
      for (const r of [viaFlag, viaEnv]) {
        expect(r.code).toBe(2);
        expect(r.out).toMatchObject({ outcome: "usage" });
        expect(r.stderr.length).toBeGreaterThan(0);
      }
      expect(s.requests.length).toBe(before);
    });
  });

  it("prints the usage with --help", async () => {
    const before = h.requests.length;
    const result = await runCli(["--help"], { LETSVIEW_URL: h.url });
    expect(result.code).toBe(0);
    const text = result.stdout.join("\n");
    for (const form of [
      "window create",
      "window remove",
      "window rename",
      "window height",
      "window range",
      "window display",
      "link",
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
    ]) {
      expect(text, form).toContain(form);
    }
    expect(h.requests.length).toBe(before); // no server contact
    const short = await runCli(["window", "range", "w1", "--help"], { LETSVIEW_URL: h.url });
    expect(short.code).toBe(0);
    expect(h.requests.length).toBe(before);
  });

  it("prints one JSON object per call, indented with --pretty", async () => {
    await withServer(async (s) => {
      const plain = await cli(s, "diff", "on");
      expect(plain.stdout).toHaveLength(1);
      expect(plain.stderr).toEqual([]);
      expect(plain.out).toEqual({
        ok: true,
        outcome: "ok",
        exitCode: 0,
        accepted: true,
        command: { type: "cursor.setDiff", diff: true },
        revision: 1,
      });
      const pretty = await cli(s, "--pretty", "diff", "off");
      expect(pretty.code).toBe(0);
      const text = pretty.stdout.join("\n");
      expect(text.split("\n").length).toBeGreaterThan(3);
      expect(JSON.parse(text)).toMatchObject({ accepted: true, revision: 2 });
      expect(text).toContain('\n  "ok": true');
    });
  });
});

describe("exit codes", () => {
  it("exits 1 with the server's code when a command is rejected", async () => {
    await withServer(async (s) => {
      const result = await cli(s, "cursor", "move", "b", "+1s");
      expect(result.code).toBe(1);
      expect(result.out).toMatchObject({
        ok: false,
        outcome: "rejected",
        exitCode: 1,
        accepted: false,
        error: { code: "cursor_off" },
      });
      expect(result.stderr).toHaveLength(1);
      expect(result.stderr[0]).toContain("cursor_off");
      expect(await revisionOf(s)).toBe(0);
    });
  });

  it("exits 2 on bad arguments without sending anything", async () => {
    await withServer(async (s) => {
      const argvs = [
        ["cursor", "move", "a", "500"],
        ["window", "range", "w1", "2026-10-13"],
        ["frobnicate"],
        ["cursor", "set", "a", "2026-10-25 02:30"],
        ["cursor", "set", "a", "2026-03-29 02:30"],
        ["window", "create", "--from", "0"],
        ["window", "height", "w1", "tall"],
        ["cursor", "move", "a", "2m"],
        ["command", "{"],
      ];
      for (const argv of argvs) {
        const before = s.requests.length;
        const result = await cli(s, ...argv);
        expect(result.code, argv.join(" ")).toBe(2);
        expect(result.out, argv.join(" ")).toMatchObject({
          ok: false,
          outcome: "usage",
          exitCode: 2,
        });
        expect(result.stderr, argv.join(" ")).toHaveLength(1);
        expect(s.requests.length, argv.join(" ")).toBe(before);
      }
      expect(s.requests).toEqual([]);
      expect(await revisionOf(s)).toBe(0);
    });
  });

  it("exits 3 when nothing listens", async () => {
    const url = await closedUrl();
    const result = await runCli(["--server", url, "state"]);
    expect(result.code).toBe(3);
    expect(result.out).toMatchObject({ ok: false, outcome: "unreachable", exitCode: 3 });
  });

  it("exits 4 when the server does not answer in time", async () => {
    const hang = await startHangingServer();
    try {
      const started = performance.now();
      const result = await runCli(["--server", hang.url, "--timeout", "300ms", "state"]);
      const elapsed = performance.now() - started;
      expect(result.code).toBe(4);
      expect(result.out).toMatchObject({ ok: false, outcome: "timeout", exitCode: 4 });
      expect(elapsed).toBeGreaterThanOrEqual(250);
      expect(elapsed).toBeLessThan(1000);
    } finally {
      await hang.close();
    }
  });

  it("exits 7 when the server answers 5xx", async () => {
    await withServer(
      async (s) => {
        const result = await cli(s, "search", "volt");
        expect(result.code).toBe(7);
        expect(result.out).toMatchObject({
          ok: false,
          outcome: "unavailable",
          exitCode: 7,
          error: { code: "catalog_unavailable" },
        });
        expect(result.stderr[0]).toContain("catalog_unavailable");
      },
      { loadCatalog: false },
    );
  });
});

describe("window, link, signal and cursor commands", () => {
  it("drives windows and the link flag over HTTP", async () => {
    await withServer(async (s) => {
      let revision = 0;
      const step = async (...argv: string[]): Promise<CliResult> => {
        const result = await cli(s, ...argv);
        expect(result.code, `${argv.join(" ")}: ${result.stderr.join("")}`).toBe(0);
        expect(result.out.accepted).toBe(true);
        expect(result.out.revision, argv.join(" ")).toBe(++revision);
        return result;
      };

      const created = await step("window", "create", "--from", "0", "--to", "10");
      expect(created.out.created).toBe("w1");
      expect(created.out.command).toMatchObject({ type: "window.create" });
      expect(window(await s.workspace(), "w1").kind).toBe("timeseries");

      await step("window", "rename", "w1", "Speeds");
      expect(window(await s.workspace(), "w1").title).toBe("Speeds");

      await step("window", "height", "w1", "300");
      expect(window(await s.workspace(), "w1").height).toBe(300);

      await step("window", "display", "w1", "--mode", "step");
      expect(window(await s.workspace(), "w1").display?.mode).toBe("step");

      const ranged = await step(
        "window",
        "range",
        "w1",
        "2026-10-13 15:08:00",
        "2026-10-13 15:08:03",
      );
      expect(ranged.out.command).toEqual({
        type: "window.setRange",
        windowId: "w1",
        from: "1791896880000000000",
        to: "1791896883000000000",
      });
      expect(window(await s.workspace(), "w1").range).toEqual({
        from: "1791896880000000000",
        to: "1791896883000000000",
      });

      await step("link", "off");
      expect((await s.workspace()).workspace.linkTime).toBe(false);

      await step("window", "remove", "w1");
      expect((await s.workspace()).workspace.windows).toEqual([]);

      const values = await step("window", "create", "--values", "--title", "Readout");
      expect(window(await s.workspace(), values.out.created).kind).toBe("values");
    });
  });

  it("reports the window a move removed", async () => {
    await withServer(async (s) => {
      await cli(s, "window", "create", "--from", "0", "--to", "10");
      const second = await cli(s, "window", "create", "--from", "0", "--to", "10");
      const w2: string = second.out.created;
      await cli(s, "signal", "add", "w1", RPM);

      // Moving the only signal away removes w1 and says so in the body, after createdWindow.
      const moved = await cli(s, "signal", "move", "w1", "RPM", w2);
      expect(moved.code, moved.stderr.join("")).toBe(0);
      expect(moved.out.removedWindow).toBe("w1");
      expect(moved.out.createdWindow).toBeUndefined();
      expect((await s.workspace()).workspace.windows.map((x) => x.id)).toEqual([w2]);
      expect(window(await s.workspace(), w2).signals.map((a) => a.signalId)).toEqual([RPM]);

      // Into a new window: both fields are reported; a copy reports none.
      const fresh = await cli(s, "signal", "move", w2, "RPM", "new");
      expect(fresh.out.removedWindow).toBe(w2);
      expect(fresh.out.createdWindow).toMatch(/^w\d+$/);
      const copy = await cli(s, "signal", "move", fresh.out.createdWindow, "RPM", "new", "--copy");
      expect(copy.out.removedWindow).toBeUndefined();
      expect(copy.out.createdWindow).toMatch(/^w\d+$/);

      // The next command on the removed window answers unknown_window.
      const again = await cli(s, "signal", "add", "w1", SPEED);
      expect(again.code).toBe(1);
      expect(again.out).toMatchObject({ outcome: "rejected", error: { code: "unknown_window" } });
    });
  });

  it("drives signal add, move, copy and remove over HTTP", async () => {
    await withServer(async (s) => {
      expect((await cli(s, "window", "create", "--from", "0", "--to", "10")).out.created).toBe(
        "w1",
      );
      const rpm = await cli(s, "signal", "add", "w1", RPM);
      expect(rpm.code).toBe(0);
      const rpmId: string = rpm.out.created;
      expect(rpmId).toMatch(/^a\d+$/);
      const speed = await cli(s, "signal", "add", "w1", SPEED);
      expect(speed.code).toBe(0);
      const speedId: string = speed.out.created;

      // Copy RPM into a new window: the original stays, the copy gets its own assignment.
      const copy = await cli(s, "signal", "move", "w1", "RPM", "new", "--copy");
      expect(copy.code, copy.stderr.join("")).toBe(0);
      expect(copy.out.command).toMatchObject({
        type: "window.moveSignal",
        assignmentId: rpmId,
        copy: true,
      });
      expect(copy.out.command.targetWindowId).toBeUndefined();
      const w3: string = copy.out.createdWindow;
      expect(w3).toMatch(/^w\d+$/);
      expect(copy.out.created).toMatch(/^a\d+$/);
      expect(copy.out.created).not.toBe(rpmId);
      let state = await s.workspace();
      expect(
        window(state, "w1")
          .signals.map((a) => a.signalId)
          .sort(),
      ).toEqual([RPM, SPEED]);
      expect(window(state, w3).signals.map((a) => a.signalId)).toEqual([RPM]);

      // Move SPEED by assignment ID: the assignment keeps its ID.
      const moved = await cli(s, "signal", "move", "w1", speedId, w3);
      expect(moved.code, moved.stderr.join("")).toBe(0);
      state = await s.workspace();
      expect(window(state, w3).signals.find((a) => a.signalId === SPEED)?.id).toBe(speedId);
      expect(window(state, "w1").signals.map((a) => a.signalId)).toEqual([RPM]);

      // Remove by full signal ID: w3 no longer shows RPM.
      const removed = await cli(s, "signal", "remove", w3, RPM);
      expect(removed.code, removed.stderr.join("")).toBe(0);
      expect(removed.out.command).toMatchObject({ type: "window.removeSignal", windowId: w3 });
      state = await s.workspace();
      expect(window(state, w3).signals.map((a) => a.signalId)).toEqual([SPEED]);

      // Remove by bare name, then again: w1 no longer shows RPM, so nothing is sent.
      expect((await cli(s, "signal", "remove", "w1", "RPM")).code).toBe(0);
      const revision = await revisionOf(s);
      const before = s.requests.filter((r) => r.startsWith("POST")).length;
      const gone = await cli(s, "signal", "remove", "w1", "RPM");
      expect(gone.code).toBe(1);
      expect(gone.out).toMatchObject({
        outcome: "rejected",
        error: { code: "unknown_assignment" },
      });
      expect(await revisionOf(s)).toBe(revision);
      expect(s.requests.filter((r) => r.startsWith("POST")).length).toBe(before);
    });
  });

  it("resolves bare signal names and refuses ambiguous ones", async () => {
    await withServer(async (s) => {
      await cli(s, "window", "create", "--from", "0", "--to", "10");
      const added = await cli(s, "signal", "add", "w1", "rpm");
      expect(added.code, added.stderr.join("")).toBe(0);
      expect(added.out.command).toEqual({
        type: "window.addSignal",
        windowId: "w1",
        signalId: RPM,
      });
      const revision = await revisionOf(s);

      const ambiguous = await cli(s, "signal", "add", "w1", "SIG_A");
      expect(ambiguous.code).toBe(1);
      expect(ambiguous.out.error).toMatchObject({
        code: "ambiguous_signal",
        candidates: ["othercar/Fast_100h.SIG_A", "testcar/Fast_100h.SIG_A"],
      });

      const unknown = await cli(s, "signal", "add", "w1", "NOPE");
      expect(unknown.code).toBe(1);
      expect(unknown.out.error.code).toBe("unknown_signal");
      expect(await revisionOf(s)).toBe(revision);

      // A full ID is sent unchanged, even when it is ambiguous as a bare name.
      const full = await cli(s, "signal", "add", "w1", "othercar/Fast_100h.SIG_A");
      expect(full.code).toBe(0);
      expect(full.out.command.signalId).toBe("othercar/Fast_100h.SIG_A");
    });
  });

  it("resolves cursor anchors and refuses off cursors", async () => {
    await withServer(async (s) => {
      await s.command({ type: "window.create", from: T_13_08_00, to: T_13_08_03 });
      await s.command({ type: "cursor.set", cursor: "a", t: "2026-10-13T13:08:00.093Z" });

      const b = await cli(s, "cursor", "set", "b", "a+500ms");
      expect(b.code, b.stderr.join("")).toBe(0);
      expect(b.out.command).toEqual({ type: "cursor.set", cursor: "b", t: "1791896880593000000" });
      expect((await s.workspace()).workspace.cursors.b).toBe("1791896880593000000");

      const range = await cli(s, "window", "range", "w1", "a-1s", "a+1s");
      expect(range.code, range.stderr.join("")).toBe(0);
      expect(window(await s.workspace(), "w1").range).toEqual({
        from: "1791896879093000000",
        to: "1791896881093000000",
      });

      expect((await cli(s, "cursor", "remove", "b")).code).toBe(0);
      const revision = await revisionOf(s);
      const off = await cli(s, "value", SPEED, "b");
      expect(off.code).toBe(1);
      expect(off.out.error.code).toBe("cursor_off");
      expect(s.requests.some((r) => r.includes("/api/value"))).toBe(false);
      const offSet = await cli(s, "cursor", "set", "a", "b+1s");
      expect(offSet.code).toBe(1);
      expect(offSet.out.error.code).toBe("cursor_off");
      expect(await revisionOf(s)).toBe(revision);
    });
  });

  it("sets, moves and removes cursors and switches diff", async () => {
    await withServer(async (s) => {
      let revision = 0;
      const step = async (...argv: string[]) => {
        const result = await cli(s, ...argv);
        expect(result.code, `${argv.join(" ")}: ${result.stderr.join("")}`).toBe(0);
        expect(result.out.revision, argv.join(" ")).toBe(++revision);
        return result;
      };
      const cursors = async () => (await s.workspace()).workspace.cursors;

      await step("cursor", "set", "a", "2026-10-13 15:08:00.093");
      expect((await cursors()).a).toBe("1791896880093000000");

      const move = await step("cursor", "move", "a", "+902ms");
      expect(move.out.command).toEqual({ type: "cursor.move", cursor: "a", by: "902000000" });
      expect((await cursors()).a).toBe("1791896880995000000");

      await step("cursor", "move", "a", "-2ms");
      expect((await cursors()).a).toBe("1791896880993000000");

      await step("diff", "on");
      expect((await cursors()).diff).toBe(true);

      await step("cursor", "remove", "a");
      const after = await cursors();
      expect(after.a).toBeUndefined();
      expect(after.diff).toBe(true);
    });
  });

  it("sets the digits option over HTTP", async () => {
    await withServer(async (s) => {
      const four = await cli(s, "digits", "4");
      expect(four.code, four.stderr.join("")).toBe(0);
      expect(four.out.revision).toBe(1);
      expect(four.out.command).toEqual({ type: "workspace.setOptions", digits: 4 });
      const state = await cli(s, "state");
      expect(state.code).toBe(0);
      expect((await s.workspace()).workspace.options).toEqual({ digits: 4 });
      expect(JSON.stringify(state.out)).toContain('"digits":4');

      // Usage error: exit 2, nothing sent.
      const before = s.requests.length;
      const bad = await cli(s, "digits", "5");
      expect(bad.code).toBe(2);
      expect(s.requests.length).toBe(before);
      expect((await s.workspace()).workspace.options).toEqual({ digits: 4 });
    });
  });

  it("sends a raw command", async () => {
    await withServer(async (s) => {
      const ok = await cli(s, "command", '{"type":"workspace.setLinkTime","linked":false}');
      expect(ok.code).toBe(0);
      expect(ok.out.command).toEqual({ type: "workspace.setLinkTime", linked: false });
      expect((await s.workspace()).workspace.linkTime).toBe(false);

      const nope = await cli(s, "command", '{"type":"nope"}');
      expect(nope.code).toBe(1);
      expect(nope.out).toMatchObject({ outcome: "rejected", accepted: false });
      expect(nope.out.error.code).toBe("invalid_command");

      const revision = await revisionOf(s);
      const before = s.requests.length;
      const bad = await cli(s, "command", "{");
      expect(bad.code).toBe(2);
      expect(s.requests.length).toBe(before);
      expect(await revisionOf(s)).toBe(revision);
    });
  });
});

describe("search, extent, state and value", () => {
  it("sends a raw command unchanged", async () => {
    await withServer(async (s) => {
      const command = {
        type: "window.addSignal",
        windowId: "w1",
        signalId: { kind: "name", name: "RPM" },
      };
      const before = s.requests.length;
      const r = await cli(s, "command", JSON.stringify(command));
      // The object is not resolved to a signal ID: the echo is identical and no lookup ran.
      expect(r.out.command).toEqual(command);
      expect(s.requests.slice(before)).toEqual(["POST /api/commands"]);
    });
  });

  it("searches and reads extents", async () => {
    await withServer(async (s) => {
      const search = await cli(s, "search", "rpm");
      expect(search.code).toBe(0);
      expect(search.out.data.items[0].id).toBe(RPM);
      expect(search.out.data.total).toBe(1);
      expect(search.out.data.more).toBe(false);

      const limited = await cli(s, "search", "SIG_A", "--limit", "1");
      expect(limited.code).toBe(0);
      expect(limited.out.data.items).toHaveLength(1);
      expect(limited.out.data.total).toBe(2);
      expect(limited.out.data.more).toBe(true);
      expect(s.requests.at(-1)).toBe("GET /api/signals");

      const extent = await cli(s, "extent", SPEED);
      expect(extent.code).toBe(0);
      expect(extent.out.data.first).toBe("1790820000000000000");
      expect(extent.out.data.last).toBe("1790820099900000000");
      expect(extent.out.local.first).toBe("2026-10-01 04:00:00+02:00");
      expect(extent.out.local.last).toBe("2026-10-01 04:01:39.900+02:00");

      const none = await cli(s, "extent", RPM);
      expect(none.code).toBe(1); // the stub has no data for RPM
    });
  });

  it("returns workspace, render status and local times", async () => {
    await withServer(async (s) => {
      await s.command({ type: "window.create", from: T_13_08_00, to: T_13_08_03 });
      await s.command({ type: "cursor.set", cursor: "a", t: "2026-10-13T13:08:01.5Z" });
      const browser = await s.browser();
      const { revision } = await s.workspace();
      await browser.ack(revision);

      const result = await cli(s, "state");
      expect(result.code).toBe(0);
      const body = await s.workspace();
      expect(result.out.data.workspace).toEqual(body.workspace);
      expect(result.out.data.revision).toBe(revision);
      expect(result.out.data.render.revision).toBe(revision);
      expect(result.out.data.render.clients).toHaveLength(1);
      expect(result.out.data.render.clients[0]).toMatchObject({
        clientId: browser.clientId,
        rendered: { revision, status: "complete" },
      });
      expect(result.out.local.cursors.a).toBe("2026-10-13 15:08:01.500+02:00");
      expect(result.out.local.cursors.b).toBeUndefined();
      expect(result.out.local.ranges.w1).toEqual({
        from: "2026-10-13 15:08:00+02:00",
        to: "2026-10-13 15:08:03+02:00",
      });
    });
  });

  it("reads a value at a time and at a cursor", async () => {
    await withServer(async (s) => {
      await s.command({ type: "cursor.set", cursor: "a", t: "2026-10-01T02:00:01.05Z" });

      const line = await cli(s, "value", SPEED, "a");
      expect(line.code, line.stderr.join("")).toBe(0);
      expect(line.out.data.value).toEqual({ kind: "interpolated", value: 10.5 });
      expect(line.out.data.at.v).toBe(10);
      expect(line.out.data.next.v).toBe(11);
      expect(line.out.local.t).toBe("2026-10-01 04:00:01.050+02:00");
      expect(line.out.local.at).toBe("2026-10-01 04:00:01+02:00");
      expect(line.out.local.next).toBe("2026-10-01 04:00:01.100+02:00");

      const step = await cli(s, "value", SPEED, "a", "--mode", "step");
      expect(step.code).toBe(0);
      expect(step.out.data.value).toEqual({ kind: "held", value: 10 });

      // A local time and a bare name work too.
      const local = await cli(s, "value", "speed", "2026-10-01 04:00:01.05");
      expect(local.code, local.stderr.join("")).toBe(0);
      expect(local.out.data.value).toEqual({ kind: "interpolated", value: 10.5 });

      const unknown = await cli(s, "value", "testcar/NOPE.X", "0");
      expect(unknown.code).toBe(1);
      expect(unknown.out.error.code).toBe("unknown_signal");
    });
  });
});

describe("waiting for the open UI", () => {
  it("waits for the render acknowledgement", async () => {
    await withServer(async (s) => {
      const browser = await s.browser({ autoAckMs: 200 });
      const result = await cli(s, "--wait", "window", "create", "--from", "0", "--to", "10");
      expect(result.code, result.stderr.join("")).toBe(0);
      expect(result.ms).toBeGreaterThanOrEqual(200);
      expect(result.out.accepted).toBe(true);
      expect(result.out.render).toMatchObject({
        status: "complete",
        revision: result.out.revision,
        target: result.out.revision,
        clientId: browser.clientId,
      });
      expect(result.out.render.waitedMs).toBeGreaterThanOrEqual(190);
    });
  });

  it("waits for the current revision with wait and without a command", async () => {
    await withServer(async (s) => {
      const browser = await s.browser();
      await s.command({ type: "cursor.setDiff", diff: true });
      const pending = cli(s, "wait");
      await sleep(250);
      await browser.ack(1);
      const result = await pending;
      expect(result.code).toBe(0);
      expect(result.out.accepted).toBeUndefined();
      expect(result.out.render).toMatchObject({ status: "complete", target: 1, revision: 1 });
      expect(result.out.render.waitedMs).toBeGreaterThanOrEqual(200);
    });
  });

  it("counts an acknowledgement of a later revision", async () => {
    await withServer(async (s) => {
      const browser = await s.browser();
      await s.command({ type: "cursor.setDiff", diff: true }); // revision 1 = R
      const pending = cli(s, "--timeout", "10s", "wait", "1");
      await sleep(300); // R is not acknowledged
      await s.command({ type: "cursor.setDiff", diff: false }); // R + 1
      await sleep(100);
      await browser.ack(2);
      const result = await pending;
      expect(result.code, result.stderr.join("")).toBe(0);
      expect(result.out.render).toMatchObject({
        status: "complete",
        target: 1,
        revision: 2,
        clientId: browser.clientId,
      });

      // A revision that does not exist yet is refused at once.
      for (let i = 0; i < 3; i++) await s.command({ type: "cursor.setDiff", diff: i % 2 === 0 });
      expect(await revisionOf(s)).toBe(5);
      const unknown = await cli(s, "wait", "9");
      expect(unknown.code).toBe(1);
      expect(unknown.out.error.code).toBe("unknown_revision");
      expect(unknown.ms).toBeLessThan(500);
    });
  });

  it("exits 5 when the UI rendered with data errors", async () => {
    await withServer(async (s) => {
      const browser = await s.browser();
      const errors = [{ windowId: "w1", signalId: "car/A", message: "source_error: timeout" }];
      const pending = cli(s, "--wait", "diff", "on");
      await sleep(200);
      await browser.ack(1, "error", errors);
      const result = await pending;
      expect(result.code).toBe(5);
      expect(result.out).toMatchObject({
        ok: false,
        outcome: "render_error",
        exitCode: 5,
        accepted: true,
        revision: 1,
        render: { status: "error", errors, clientId: browser.clientId },
      });
      expect(result.stderr).toHaveLength(1);
    });
  });

  it("exits 6 when no UI is connected", { timeout: 15_000 }, async () => {
    await withServer(async (s) => {
      const result = await cli(s, "--wait", "diff", "on");
      expect(result.code).toBe(6);
      expect(result.ms).toBeGreaterThanOrEqual(2000);
      expect(result.ms).toBeLessThan(3500);
      expect(result.out).toMatchObject({
        ok: false,
        outcome: "no_ui",
        exitCode: 6,
        accepted: true,
        revision: 1,
        render: { status: "no_ui", target: 1 },
      });
    });
  });

  it("exits 4 when the UI does not acknowledge in time", async () => {
    await withServer(async (s) => {
      await s.browser(); // connected, never acknowledges
      const result = await cli(s, "--wait", "--timeout", "500ms", "diff", "on");
      expect(result.code).toBe(4);
      expect(result.ms).toBeGreaterThanOrEqual(450);
      expect(result.ms).toBeLessThan(1000);
      expect(result.out).toMatchObject({
        ok: false,
        outcome: "timeout",
        exitCode: 4,
        accepted: true,
        revision: 1,
        render: { status: "timeout", target: 1 },
      });
      // The command was applied once and is not repeated by the failed wait.
      expect(await revisionOf(s)).toBe(1);
    });
  });
});
