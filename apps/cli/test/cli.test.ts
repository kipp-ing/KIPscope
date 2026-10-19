import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeViewLink, type Workspace as SharedWorkspace, viewLinkUrl } from "@kipscope/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { oidcAdapter, tokenClaims } from "../../server/test/identity/oidcKit.ts";
import { type JwksServer, jwksServer, makeKey, signToken } from "../../server/test/jwks.ts";
import { parseArgs } from "../src/args.ts";
import type { EventListData } from "../src/output.ts";
import { eventTable } from "../src/output.ts";
import { runTokenCommand } from "../src/run.ts";
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
import { type MultiServer, startMulti } from "./multi.ts";

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
  it("chooses --server over KIPSCOPE_URL over localhost:7310", async () => {
    await withServer(async (a) => {
      await withServer(async (b) => {
        await b.command({ type: "cursor.setDiff", diff: true }); // b is at revision 1, a at 0
        const viaFlag = await runCli(["--server", a.url, "state"]);
        const viaEnv = await runCli(["state"], { KIPSCOPE_URL: a.url });
        const both = await runCli(["--server", a.url, "state"], { KIPSCOPE_URL: b.url });
        const onlyB = await runCli(["state"], { KIPSCOPE_URL: b.url });
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
      const viaEnv = await runCli(["state"], { KIPSCOPE_URL: "localhost:7310" });
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
    const result = await runCli(["--help"], { KIPSCOPE_URL: h.url });
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
      "events list",
      "events filter",
      "events add",
      "events remove",
      "FILTER",
      "measurement name",
      "measurement object",
      "measurement meta",
      "measurement clear",
      "scope set",
      "scope show",
      "scope widen",
      "scope clear",
      "command",
      "state",
      "search",
      "extent",
      "value",
      "wait",
      "whoami",
      "session list",
      "session new",
      "session share",
      "session delete",
      "--server",
      "--session",
      "--token",
      "--wait",
      "--timeout",
      "--pretty",
    ]) {
      expect(text, form).toContain(form);
    }
    expect(h.requests.length).toBe(before); // no server contact
    const short = await runCli(["window", "range", "w1", "--help"], { KIPSCOPE_URL: h.url });
    expect(short.code).toBe(0);
    expect(h.requests.length).toBe(before);
  });

  it("ends the help with the attribution", async () => {
    const result = await runCli(["--help"], { KIPSCOPE_URL: h.url });
    expect(result.code).toBe(0);
    const lines = result.stdout
      .join("\n")
      .split("\n")
      .filter((l) => l.trim() !== "");
    expect(lines.at(-1)).toBe(
      "KIPscope © 2026 Jan Kipping, Agentic engineer, https://kipp.ing · Attribution Assurance License (AAL)",
    );
  });

  it("keeps results one JSON line without the attribution", async () => {
    const result = await cli(h, "state");
    expect(result.code).toBe(0);
    expect(result.stdout).toHaveLength(1);
    expect(() => JSON.parse(result.stdout[0] as string)).not.toThrow();
    expect(result.stdout[0]).not.toContain("kipp.ing");
    expect(result.stderr.join("\n")).not.toContain("kipp.ing");
  });

  it("sets and reads measurement info over HTTP", async () => {
    await withServer(async (s) => {
      const start = await revisionOf(s);
      const name = await cli(s, "measurement", "name", "Testfahrt A9");
      const object = await cli(s, "measurement", "object", "smart451");
      const meta = await cli(s, "measurement", "meta", "driver", "Jan");
      for (const [i, r] of [name, object, meta].entries()) {
        expect(r.code).toBe(0);
        expect(r.out).toMatchObject({ ok: true, revision: start + i + 1 });
      }
      const state = await cli(s, "state");
      expect(state.out.data.workspace.measurement).toEqual({
        name: "Testfahrt A9",
        object: "smart451",
        meta: [{ key: "driver", value: "Jan" }],
      });

      const tooLong = await cli(s, "measurement", "meta", "k", "x".repeat(201));
      expect(tooLong.code).toBe(1);
      expect(tooLong.out.error.code).toBe("invalid_command");
      expect(await revisionOf(s)).toBe(start + 3);

      const cleared = await cli(s, "measurement", "clear");
      expect(cleared.code).toBe(0);
      expect((await s.workspace()).workspace).not.toHaveProperty("measurement");
    });
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
        // The session the call served (add-multiuser M13): the harness has the one, `0000000000`.
        session: expect.stringMatching(/^[a-z0-9]{10}$/),
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

  it("value shows the state label of a state signal", async () => {
    await withServer(async (s) => {
      const r = await cli(
        s,
        "value",
        "testcar/Ign_A20h.MODE",
        "2026-10-01T01:20:00Z",
        "--mode",
        "step",
      );
      expect(r.code, r.stderr.join("")).toBe(0);
      expect(r.out.data.value.label).toBe("KEYON: Ignition on");
      expect(r.out.data.value.value).toBe(3);
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

      // A state name rides along: line mode next to a named point is held, `--mode step` as well.
      const mode = "testcar/Ign_A20h.MODE";
      const named = await cli(s, "value", mode, "2026-10-01T01:20:00.05Z", "--mode", "step");
      expect(named.code, named.stderr.join("")).toBe(0);
      expect(named.out.data.value).toEqual({
        kind: "held",
        value: 3,
        label: "KEYON: Ignition on",
      });
      const heldInLine = await cli(s, "value", mode, "2026-10-01T01:20:00.05Z");
      expect(heldInLine.out.data.value).toEqual(named.out.data.value);

      // Inside the stub's logger gap (02:00:02Z - 02:00:04Z), between the points 11 (02:00:01.1Z) and
      // 12 (02:00:05Z): no value, the server's reason unchanged, exit code 0.
      const gap = await cli(s, "value", SPEED, "2026-10-01T02:00:03Z", "--mode", "step");
      expect(gap.code, gap.stderr.join("")).toBe(0);
      expect(gap.out.data.value).toEqual({ kind: "none", reason: "logger_gap" });
      expect(gap.out.data.at.v).toBe(11);
      expect(gap.out.data.next.v).toBe(12);
      // Outside the gap the same pair is still held in step mode (up to the gap's start).
      const before = await cli(s, "value", SPEED, "2026-10-01T02:00:01.5Z", "--mode", "step");
      expect(before.out.data.value).toEqual({ kind: "held", value: 11 });

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

describe("events", () => {
  const MODE = "testcar/Ign_A20h.MODE";

  /** A server whose window w1 shows testcar/Sna_800h.RPM, so `events list` finds the data ref. */
  async function withWindow<T>(fn: (s: Harness) => Promise<T>): Promise<T> {
    return withServer(async (s) => {
      await s.command({ type: "window.create", from: "0", to: "1000" });
      await s.command({ type: "window.addSignal", windowId: "w1", signalId: RPM });
      return fn(s);
    });
  }

  it("lists events with the workspace filter or the given one", async () => {
    await withWindow(async (s) => {
      const def = await cli(s, "events", "list");
      expect(def.code, def.stderr.join("")).toBe(0);
      // The workspace's default `active changes`: 2 active faults and 2 changes of 18.
      expect(def.out.data.events).toHaveLength(4);
      expect(def.out.data.filter).toBe("active changes");
      expect(def.out.data.description).toBe("Active faults and state changes");
      expect(def.out.data.total).toBe(18);
      expect(def.out.local.t).toEqual([
        "2026-10-01 03:03:00+02:00",
        "2026-10-01 04:00:00+02:00",
        "2026-10-01 07:00:00+02:00",
        "2026-10-01 07:00:00+02:00",
      ]);

      const faults = await cli(s, "events", "list", "faults", "ecu:bms");
      expect(faults.code).toBe(0);
      expect(faults.out.data.events).toHaveLength(5);
      expect(faults.out.data.filter).toBe("faults ecu:bms");

      const ranged = await cli(
        s,
        "events",
        "list",
        "changes",
        "-snapshots",
        "--from",
        "2026-10-01T00:00Z",
        "--to",
        "2026-10-01T03:00Z",
      );
      expect(ranged.code, ranged.stderr.join("")).toBe(0);
      expect(ranged.out.data.events).toHaveLength(2);
      expect(ranged.out.data.filter).toBe("changes -snapshots");

      // A workspace filter applies when no words are given.
      await s.command({ type: "events.setFilter", filter: "logger" });
      const logger = await cli(s, "events", "list");
      expect(logger.out.data.events).toHaveLength(2);
      expect(logger.out.data.description).toBe("Logger errors");

      const bad = await cli(s, "events", "list", "ecu:");
      expect(bad.code).toBe(1);
      expect(bad.out.error.code).toBe("invalid_filter");

      // The data ref is that of the first signal, or --ref; without both it is rejected.
      const other = await cli(s, "events", "list", "--ref", "othercar");
      expect(other.code).toBe(0);
      expect(other.out.data.total).toBe(0);
      const unknown = await cli(s, "events", "list", "--ref", "nope");
      expect(unknown.code).toBe(1);
      expect(unknown.out.error.code).toBe("unknown_data_ref");
    });
    await withServer(async (s) => {
      const none = await cli(s, "events", "list");
      expect(none.code).toBe(1);
      expect(none.out.error.code).toBe("no_data_ref");
    });
  });

  it("puts the count line last when signals were skipped", () => {
    const data = {
      dataRef: "testcar",
      total: 18,
      filter: "changes",
      description: "State changes",
      events: [
        {
          t: "1790820180000000000",
          category: "change",
          kind: "state",
          source: "VCU",
          name: "VCU.door",
          text: "open",
          detail: "from closed",
          value: 0,
          from: { t: "1790820000000000000", value: 0, text: "closed" },
        },
      ],
      skipped: [
        { signalId: "testcar/Sna_800h.RPM", reason: "no_states" },
        { signalId: "testcar/DIAG.door", reason: "in_events_table" },
      ],
    } as unknown as EventListData;
    const lines = eventTable(data, ["2026-10-01 03:03:00+02:00"]).split("\n");
    expect(lines).toEqual([
      "2026-10-01 03:03:00.000+02:00  State change  VCU  VCU.door  closed → open",
      "skipped: testcar/Sna_800h.RPM (no_states)",
      "skipped: testcar/DIAG.door (in_events_table)",
      "1 of 18 events · changes · State changes",
    ]);
  });

  it("prints events as a table", async () => {
    await withWindow(async (s) => {
      const result = await cli(s, "events", "list", "changes", "--table");
      expect(result.code, result.stderr.join("")).toBe(0);
      expect(result.out).toBeUndefined(); // not JSON
      const lines = result.stdout
        .join("\n")
        .split("\n")
        .filter((l) => l.trim() !== "");
      expect(lines).toEqual([
        "2026-10-01 03:03:00.000+02:00  State change  VCU  VCU.door  closed → open",
        "2026-10-01 04:00:00.000+02:00  State change  VCU  VCU.door  open → closed",
        "2 of 18 events · changes · State changes",
      ]);

      // Skipped signals follow as lines of their own.
      await s.command({ type: "window.addSignal", windowId: "w1", signalId: MODE });
      await s.command({ type: "events.addSignal", signalId: MODE });
      const withSignal = await cli(s, "events", "list", "changes", "ecu:Ign_A20h.MODE", "--table");
      expect(withSignal.code).toBe(0);
      const text = withSignal.stdout.join("\n");
      expect(text).toContain("Ign_A20h.MODE");
      expect(text).toContain("NONE → KEYON: Ignition on");
    });
  });

  it("sets the event filter and events-line signals over HTTP", async () => {
    await withWindow(async (s) => {
      const start = await revisionOf(s);
      const set = await cli(s, "events", "filter", "Faults", "bms");
      expect(set.code, set.stderr.join("")).toBe(0);
      expect(set.out).toMatchObject({ ok: true, revision: start + 1 });
      const state = await cli(s, "state");
      expect(state.out.data.workspace.eventFilter).toBe("faults bms");

      const bad = await cli(s, "events", "filter", "ecu:");
      expect(bad.code).toBe(1);
      expect(bad.out.error.code).toBe("invalid_filter");
      expect(await revisionOf(s)).toBe(start + 1);

      // The empty filter is a filter of its own: everything.
      const all = await cli(s, "events", "filter", "");
      expect(all.code).toBe(0);
      expect((await s.workspace()).workspace).toMatchObject({ eventFilter: "" });

      // Events-line signals: add by full ID, refuse twice and without states, remove by bare name.
      const add = await cli(s, "events", "add", MODE);
      expect(add.code, add.stderr.join("")).toBe(0);
      expect((await s.workspace()).workspace).toMatchObject({ eventSignals: [MODE] });
      const twice = await cli(s, "events", "add", MODE);
      expect(twice.out.error.code).toBe("already_listed");
      const noStates = await cli(s, "events", "add", RPM);
      expect(noStates.code).toBe(1);
      expect(noStates.out.error.code).toBe("not_state_signal");

      // The listed signal's changes join the list.
      const list = await cli(s, "events", "list", "all");
      expect(list.out.data.total).toBe(20);
      expect(
        list.out.data.events.filter((e: { kind: string }) => e.kind === "signal"),
      ).toHaveLength(2);

      const removed = await cli(s, "events", "remove", "MODE");
      expect(removed.code, removed.stderr.join("")).toBe(0);
      expect((await s.workspace()).workspace).not.toHaveProperty("eventSignals");
      const gone = await cli(s, "events", "remove", MODE);
      expect(gone.out.error.code).toBe("not_listed");
    });
  });
});

describe("views", () => {
  const speeds = async (s: Harness) => {
    const { workspace } = await s.workspace();
    return workspace.windows.find((w) => w.title === "Speeds");
  };

  // The spec says `window create --title Speeds`; a fresh workspace has no range to share, so --from/--to are given.
  it("saves, lists and opens views", async () => {
    const s = await startServer();
    try {
      expect(
        (await cli(s, "window", "create", "--title", "Speeds", "--from", "0", "--to", "10")).code,
      ).toBe(0);
      const saved = await cli(s, "view", "save", "Speeds");
      expect(saved.code).toBe(0);
      expect(saved.out).toMatchObject({
        ok: true,
        data: { view: { name: "speeds", title: "Speeds" } },
      });
      expect(typeof saved.out.revision).toBe("number");
      expect((await cli(s, "window", "remove", "w1")).code).toBe(0);
      expect(await speeds(s)).toBeUndefined();

      const before = await revisionOf(s);
      const opened = await cli(s, "view", "open", "speeds");
      expect(opened.code).toBe(0);
      expect(opened.out).toMatchObject({
        ok: true,
        accepted: true,
        data: { report: { missing: [] } },
      });
      expect(opened.out.revision).toBe(before + 1);
      expect(await speeds(s)).toBeDefined();

      // The workspace was empty before the open: no `_previous`.
      const list = await cli(s, "view", "list");
      expect(list.code).toBe(0);
      expect(list.out.data.views.map((v: { name: string }) => v.name)).toEqual(["speeds"]);
    } finally {
      await s.close();
    }
  });

  it("prints the same link as Copy link", async () => {
    const s = await startServer();
    try {
      const page = "http://127.0.0.1:5173/";
      expect(
        (await cli(s, "window", "create", "--title", "Speeds", "--from", "0", "--to", "10")).code,
      ).toBe(0);
      expect((await cli(s, "view", "save", "Drive 3", "--note", "BRK_LMP first")).code).toBe(0);
      const opened = await cli(s, "view", "open", "drive-3");
      expect(opened.code).toBe(0);

      const { workspace } = await s.workspace();
      expect(workspace.view?.note).toBe("BRK_LMP first");
      const link = await cli(s, "view", "link", "--page", page);
      expect(link.code).toBe(0);
      // What the web's "Copy link" calls: viewLinkUrl on GET /api/workspace.
      const url: string = link.out.data.url;
      expect(url).toBe(await viewLinkUrl(workspace as unknown as SharedWorkspace, page));
      expect(link.out.data.chars).toBe(url.length);
      const decoded = (await decodeViewLink(
        url.slice(url.indexOf("#view=") + "#view=".length),
      )) as Record<string, unknown>;
      expect(decoded.title).toBe("Drive 3");
      expect(decoded.note).toBe("BRK_LMP first");
      expect("saved" in decoded).toBe(false);
    } finally {
      await s.close();
    }
  });

  it("prints a link to the open workspace", async () => {
    const s = await startServer();
    try {
      expect(
        (await cli(s, "window", "create", "--title", "Speeds", "--from", "0", "--to", "10")).code,
      ).toBe(0);
      const link = await cli(s, "view", "link", "--page", "http://127.0.0.1:5173/");
      expect(link.code).toBe(0);
      expect(link.out.ok).toBe(true);
      const url: string = link.out.data.url;
      expect(url.startsWith("http://127.0.0.1:5173/#view=")).toBe(true);
      expect(link.out.data.chars).toBe(url.length);
      const decoded = (await decodeViewLink(
        url.slice(url.indexOf("#view=") + "#view=".length),
      )) as {
        windows: unknown[];
      };
      expect(decoded.windows).toHaveLength(1);
      expect(decoded).toMatchObject({ kipscope: "view", windows: [{ title: "Speeds" }] });
    } finally {
      await s.close();
    }
  });

  it("rejects an unknown view and an existing name", async () => {
    const s = await startServer();
    try {
      const missing = await cli(s, "view", "open", "nope");
      expect(missing.code).toBe(1);
      expect(missing.out).toMatchObject({
        ok: false,
        outcome: "rejected",
        error: { code: "unknown_view" },
      });

      expect((await cli(s, "view", "save", "Speeds")).code).toBe(0);
      const again = await cli(s, "view", "save", "Speeds");
      expect(again.code).toBe(1);
      expect(again.out).toMatchObject({
        ok: false,
        outcome: "rejected",
        error: { code: "view_exists" },
      });
      const forced = await cli(s, "view", "save", "Speeds", "--overwrite");
      expect(forced.code).toBe(0);
    } finally {
      await s.close();
    }
  });

  it("deletes a view and reports one that is gone", async () => {
    const s = await startServer();
    try {
      await cli(s, "view", "save", "Speeds", "--note", "first");
      const deleted = await cli(s, "view", "delete", "speeds");
      expect(deleted.code).toBe(0);
      expect(deleted.out.data).toEqual({ deleted: "speeds" });
      const gone = await cli(s, "view", "delete", "speeds");
      expect(gone.code).toBe(1);
      expect(gone.out.error.code).toBe("unknown_view");
    } finally {
      await s.close();
    }
  });

  it("keeps the replaced workspace as _previous and honours --wait", async () => {
    const s = await startServer();
    const browser = await s.browser({ autoAckMs: 5 });
    try {
      await cli(s, "view", "save", "Empty");
      await cli(s, "window", "create", "--title", "Speeds", "--from", "0", "--to", "10");
      const opened = await cli(s, "view", "open", "empty", "--wait");
      expect(opened.code).toBe(0);
      expect(opened.out).toMatchObject({
        ok: true,
        accepted: true,
        render: { status: "complete" },
      });
      const list = await cli(s, "view", "list");
      expect(list.out.data.views.at(-1)).toMatchObject({
        name: "_previous",
        title: "Before last open",
        windows: 1,
      });
    } finally {
      await browser.close();
      await s.close();
    }
  });

  it("answers 503 as unavailable when the catalog never loaded", async () => {
    const s = await startServer({ loadCatalog: false });
    try {
      s.views.write("v", {
        kipscope: "view",
        version: 1,
        title: "V",
        data: [],
        linkTime: true,
        cursors: { diff: false },
        digits: 3,
        windows: [],
      });
      const opened = await cli(s, "view", "open", "v");
      expect(opened.code).toBe(7);
      expect(opened.out).toMatchObject({
        ok: false,
        outcome: "unavailable",
        error: { code: "catalog_unavailable" },
      });
    } finally {
      await s.close();
    }
  });

  it("imports a file and opens it, and refuses an unreadable one without sending anything", async () => {
    const s = await startServer();
    const dir = mkdtempSync(join(tmpdir(), "kipscope-cli-import-"));
    try {
      const file = join(dir, "v.yaml");
      writeFileSync(
        file,
        [
          "kipscope: view",
          "version: 1",
          "title: Imported",
          "data:",
          "  - testcar",
          "linkTime: true",
          "cursors:",
          "  diff: false",
          "digits: 3",
          "windows:",
          "  - kind: values",
          "    mode: line",
          "    signals:",
          "      - testcar/Sna_800h.RPM",
          "",
        ].join("\n"),
      );
      const imported = await cli(s, "view", "import", file, "--open");
      expect(imported.code).toBe(0);
      expect(imported.out.data.view).toMatchObject({ name: "imported", title: "Imported" });
      expect((await s.workspace()).workspace.windows).toHaveLength(1);

      const requests = s.requests.length;
      const missing = await cli(s, "view", "import", join(dir, "nope.yaml"));
      expect(missing.code).toBe(2);
      expect(missing.out).toMatchObject({ ok: false, outcome: "usage" });
      const big = join(dir, "big.yaml");
      writeFileSync(big, "x".repeat(256 * 1024 + 1));
      const tooBig = await cli(s, "view", "import", big);
      expect(tooBig.code).toBe(2);
      expect(s.requests.length).toBe(requests);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await s.close();
    }
  });
});

describe("scope", () => {
  // 2026-10-01T01:00:00Z and 02:00:00Z in ns, by hand; TZ Europe/Berlin is +02:00 then.
  const T1 = 1790816400000000000n;
  const T2 = 1790820000000000000n;
  const H = 3_600_000_000_000n;

  it("sets, shows, widens and clears the scope", async () => {
    await withServer(async (s) => {
      // Widen without a scope: rejected, nothing sent.
      const revision = await revisionOf(s);
      const before = s.requests.filter((r) => r.startsWith("POST")).length;
      const none = await cli(s, "scope", "widen");
      expect(none.code).toBe(1);
      expect(none.out).toMatchObject({ ok: false, error: { code: "scope_required" } });
      expect(await revisionOf(s)).toBe(revision);
      expect(s.requests.filter((r) => r.startsWith("POST")).length).toBe(before);

      // Set: one new revision.
      const set = await cli(s, "scope", "set", "testcar", "2026-10-01 03:00", "2026-10-01 04:00");
      expect(set.code).toBe(0);
      expect(set.out.ok).toBe(true);
      expect(await revisionOf(s)).toBe(revision + 1);

      // Show: the scope, the catalog's mode and the scope's time in local time.
      const shown = await cli(s, "scope", "show");
      expect(shown.code).toBe(0);
      expect(shown.out.data.scope).toEqual({
        dataRef: "testcar",
        from: T1.toString(),
        to: T2.toString(),
      });
      expect(shown.out.data.catalog.mode).toBe("full");
      expect(shown.out.data.catalog.state).toBe("loaded");
      expect(shown.out.local.from).toBe("2026-10-01 03:00:00+02:00");
      expect(shown.out.local.to).toBe("2026-10-01 04:00:00+02:00");

      // Widen: one span on each side, one new revision.
      const widened = await cli(s, "scope", "widen");
      expect(widened.code).toBe(0);
      expect(await revisionOf(s)).toBe(revision + 2);
      const again = await cli(s, "scope", "show");
      expect(again.out.data.scope).toEqual({
        dataRef: "testcar",
        from: (T1 - H).toString(),
        to: (T2 + H).toString(),
      });

      // Clear: the state shows no scope any more.
      const cleared = await cli(s, "scope", "clear");
      expect(cleared.code).toBe(0);
      expect(await revisionOf(s)).toBe(revision + 3);
      const state = await cli(s, "state");
      expect(state.out.data.workspace).not.toHaveProperty("scope");
      const empty = await cli(s, "scope", "show");
      expect(empty.out.data).not.toHaveProperty("scope");
    });
  });

  it("refuses a cursor outside the scope with out_of_scope", async () => {
    await withServer(async (s) => {
      // A cursor beyond the scope's end is refused with the server's code (exit 1).
      expect((await cli(s, "scope", "set", "testcar", T1.toString(), T2.toString())).code).toBe(0);
      const refused = await cli(s, "cursor", "set", "a", (T2 + 1n).toString());
      expect(refused.code).toBe(1);
      expect(refused.out).toMatchObject({ ok: false, error: { code: "out_of_scope" } });
    });
  });
});

describe("sessions (add-multiuser M13)", () => {
  let m: MultiServer | undefined;
  afterEach(async () => {
    await m?.close();
    m = undefined;
  });
  const sessionCli = (server: MultiServer, ...argv: string[]) =>
    runCli(["--server", server.url, ...argv]);
  const start = async (options?: Parameters<typeof startMulti>[0]) => {
    m = await startMulti({ identity: "none", ...options });
    return m;
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("addresses a session", async () => {
    const s = await start();
    const a = s.app.sessions.create("local");
    await wait(5);
    const b = s.app.sessions.create("local");
    await wait(5);

    const dflt = await sessionCli(s, "state");
    expect(dflt.code).toBe(0);
    expect(dflt.out.session).toBe(b.record.id);

    const named = await sessionCli(s, "--session", a.record.id, "state");
    expect(named.out.session).toBe(a.record.id);
    expect(named.out.data.revision).toBe(0);

    const created = await sessionCli(
      s,
      "--session",
      a.record.id,
      "window",
      "create",
      "--from",
      "0",
      "--to",
      "10",
    );
    expect(created.code, created.stderr.join("")).toBe(0);
    expect(created.out.session).toBe(a.record.id);
    expect(a.store.revision).toBe(1);
    expect(b.store.revision).toBe(0);
    // The session of the environment and a session link work alike.
    const viaEnv = await runCli(["--server", s.url, "state"], { KIPSCOPE_SESSION: a.record.id });
    expect(viaEnv.out.session).toBe(a.record.id);
    expect(viaEnv.out.data.revision).toBe(1);
    const viaLink = await runCli(["--server", `${s.url}/s/${a.record.id}`, "state"]);
    expect(viaLink.out.session).toBe(a.record.id);
    // A session that does not exist is rejected with the server's code.
    const unknown = await sessionCli(s, "--session", "zzzzzzzzzz", "state");
    expect(unknown.code).toBe(1);
    expect(unknown.out).toMatchObject({ ok: false, error: { code: "unknown_session" } });
  });

  it("keeps every request of one call on one session", async () => {
    const s = await start();
    const a = s.app.sessions.create("local");
    await wait(5);
    s.app.sessions.create("local");
    // `window create --from/--to` and a signal add read the workspace and send commands: more than
    // one request. Without --session the call's session is the first answer's, for all of them.
    const first = await sessionCli(s, "window", "create", "--from", "0", "--to", "10");
    const id = first.out.session as string;
    expect(id).not.toBe(a.record.id);
    const added = await sessionCli(
      s,
      "--session",
      id,
      "signal",
      "add",
      "w1",
      "testcar/Sna_800h.RPM",
    );
    expect(added.code, added.stderr.join("")).toBe(0);
    expect(s.app.sessions.get(id)?.store.workspace.windows[0]?.signals).toHaveLength(1);
    expect(a.store.revision).toBe(0);
  });

  it("waits for a UI of the same session", async () => {
    const s = await start();
    const a = s.app.sessions.create("local");
    await wait(5);
    const b = s.app.sessions.create("local");
    // A browser is connected to A only; B is the default session.
    const browser = await s.browser(a.record.id, { autoAckMs: 5 });
    // The live connect made A the latest session; B becomes the default again.
    await wait(5);
    s.app.sessions.touch(b.record.id);
    try {
      const other = await sessionCli(s, "--wait", "diff", "on");
      expect(other.code).toBe(6);
      expect(other.out.render.status).toBe("no_ui");
      expect(other.out.session).toBe(b.record.id);

      const same = await sessionCli(s, "--session", a.record.id, "--wait", "diff", "on");
      expect(same.code, same.stderr.join("")).toBe(0);
      expect(same.out.render.status).toBe("complete");
      expect(same.out.session).toBe(a.record.id);
    } finally {
      await browser.close();
    }
  }, 20_000);

  it("manages sessions", async () => {
    const s = await start();
    const created = await sessionCli(s, "session", "new");
    expect(created.code, created.stderr.join("")).toBe(0);
    const id = created.out.data.session.id as string;
    expect(id).toMatch(/^[a-z0-9]{10}$/);
    expect(created.out.local.url).toBe(`${s.url}/s/${id}`);
    expect(created.out.session).toBeUndefined();

    const listed = await sessionCli(s, "session", "list");
    expect(listed.out.data.sessions[0].id).toBe(id);

    const shared = await sessionCli(s, "--session", id, "session", "share", "write");
    expect(shared.code, shared.stderr.join("")).toBe(0);
    expect(shared.out.data.session).toMatchObject({ id, share: "write" });
    expect(s.app.sessions.get(id)?.record.share).toBe("write");

    const deleted = await sessionCli(s, "session", "delete", id);
    expect(deleted.out.data).toEqual({ deleted: id });
    const after = await sessionCli(s, "session", "list");
    expect(after.out.data.sessions.map((x: { id: string }) => x.id)).not.toContain(id);
    const again = await sessionCli(s, "session", "delete", id);
    expect(again.code).toBe(1);
    expect(again.out.error.code).toBe("unknown_session");
  });

  it("tells who is signed in without a login", async () => {
    const s = await start();
    const me = await sessionCli(s, "whoami");
    expect(me.code).toBe(0);
    expect(me.out.data).toEqual({
      user: "local",
      identity: "none",
      roles: [],
      rights: { data: ["*"], share: true },
    });
  });
});

describe("identity over the CLI (add-multiuser M13)", () => {
  let m: MultiServer | undefined;
  let jwks: JwksServer | undefined;
  afterEach(async () => {
    await m?.close();
    await jwks?.close();
    m = undefined;
    jwks = undefined;
  });
  const dir = mkdtempSync(join(tmpdir(), "kipscope-cli-token-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** A server with `oidc` against a local key set, and a token factory. */
  async function oidcServer() {
    const key = makeKey("RS256");
    jwks = await jwksServer([key]);
    const identity = await oidcAdapter(jwks);
    m = await startMulti({ identity });
    const token = (over: Record<string, unknown> = {}) =>
      signToken(key, tokenClaims(jwks as JwksServer, over));
    return { server: m, token };
  }

  it("sends the token", async () => {
    const { server, token } = await oidcServer();
    const alice = token();
    const call = (argv: string[], env: Record<string, string> = {}) =>
      runCli(["--server", server.url, ...argv], env);
    const noLeak = (r: CliResult, ...tokens: string[]) => {
      const text = [...r.stdout, ...r.stderr].join("\n");
      for (const t of tokens) expect(text).not.toContain(t);
    };

    const none = await call(["whoami"]);
    expect(none.code).toBe(1);
    expect(none.out).toMatchObject({ ok: false, error: { code: "unauthenticated" } });

    const flag = await call(["--token", alice, "whoami"]);
    expect(flag.code, flag.stderr.join("")).toBe(0);
    expect(flag.out.data).toMatchObject({ user: "alice", identity: "oidc", roles: ["testers"] });
    noLeak(flag, alice);

    const garbage = await call(["whoami"], { KIPSCOPE_TOKEN: "garbage" });
    expect(garbage.code).toBe(1);
    expect(garbage.out.error.code).toBe("invalid_token");
    noLeak(garbage, "garbage");

    const viaCommand = await call(["whoami"], { KIPSCOPE_TOKEN_COMMAND: `echo '${alice}'` });
    expect(viaCommand.code, viaCommand.stderr.join("")).toBe(0);
    expect(viaCommand.out.data.user).toBe("alice");
    noLeak(viaCommand, alice);

    // A failing token command: usage error, nothing sent.
    const before = server.identified();
    const failing = await call(["whoami"], {
      KIPSCOPE_TOKEN_COMMAND: "echo 'no luck' >&2; exit 3",
    });
    expect(failing.code).toBe(2);
    expect(failing.out.error.code).toBe("token_command_failed");
    expect(JSON.stringify(failing.out)).toContain("no luck");
    expect(server.identified()).toBe(before);

    // A command that prints nothing is a failure, too.
    const empty = await call(["whoami"], { KIPSCOPE_TOKEN_COMMAND: "true" });
    expect([empty.code, empty.out.error.code]).toEqual([2, "token_command_failed"]);
    expect(server.identified()).toBe(before);

    // --token wins over the environment; the command does not run when a token is given.
    const marker = join(dir, "ran");
    const given = await call(["--token", alice, "whoami"], {
      KIPSCOPE_TOKEN: "garbage",
      KIPSCOPE_TOKEN_COMMAND: `touch ${marker}`,
    });
    expect(given.code).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  it("runs the token command once per call", async () => {
    const { server, token } = await oidcServer();
    const alice = token();
    const counter = join(dir, "count");
    writeFileSync(counter, "");
    const command = `echo x >> '${counter}'; echo '${alice}'`;
    // `--wait` after a command makes several requests (the command, the render status polls).
    const waited = await runCli(
      ["--server", server.url, "--wait", "--timeout", "3s", "diff", "on"],
      {
        KIPSCOPE_TOKEN_COMMAND: command,
      },
    );
    expect([0, 6]).toContain(waited.code);
    expect(readFileSync(counter, "utf8").trim().split("\n")).toHaveLength(1);
    expect(server.identified()).toBeGreaterThan(1);
  }, 15_000);

  it("times a token command out", async () => {
    await expect(runTokenCommand("sleep 5", {}, 200)).rejects.toMatchObject({
      outcome: "usage",
      code: "token_command_failed",
    });
    await expect(runTokenCommand("echo '  tok  '", {})).resolves.toBe("tok");
  });

  it("never prints a token, not even when the call fails", async () => {
    const { server, token } = await oidcServer();
    const secret = token();
    const down = await closedUrl();
    for (const argv of [
      ["--server", server.url, "--token", secret, "window", "create", "--bogus"],
      ["--server", server.url, "--token", secret, "--session", "zzzzzzzzzz", "state"],
      ["--server", down, "--token", secret, "state"],
      ["--server", server.url, "--token", `${secret}x`, "state"],
    ]) {
      const r = await runCli(argv);
      expect([...r.stdout, ...r.stderr].join("\n"), argv.join(" ")).not.toContain(
        secret.slice(0, 40),
      );
    }
  });

  it("keeps a role to its data", async () => {
    const { server, token } = await oidcServer();
    const alice = token();
    const call = (...argv: string[]) => runCli(["--server", server.url, "--token", alice, ...argv]);

    // She has a window of her own with a visible signal; its revision must not move.
    const made = await call("window", "create", "--from", "0", "--to", "10");
    expect(made.code, made.stderr.join("")).toBe(0);
    const id = made.out.session as string;
    const revision = server.app.sessions.get(id)?.store.revision;

    const search = await call("--session", id, "search", "Fast");
    expect(search.code).toBe(0);
    expect(search.out.data.items.length).toBeGreaterThan(0);
    for (const item of search.out.data.items)
      expect(item.dataRef.startsWith("test"), item.id).toBe(true);
    expect(search.out.data.total).toBe(search.out.data.items.length);

    const hidden = "othercar/Fast_100h.SIG_A";
    const forbidden = [
      await call("--session", id, "extent", hidden),
      await call("--session", id, "value", hidden, "2026-10-01T02:00:01Z"),
      await call("--session", id, "events", "list", "--ref", "othercar"),
      await call("--session", id, "signal", "add", "w1", hidden),
      await call(
        "--session",
        id,
        "scope",
        "set",
        "othercar",
        "2026-10-01T01:00:00Z",
        "2026-10-01T02:00:00Z",
      ),
    ];
    for (const r of forbidden) {
      expect(r.code, r.stdout.join("")).toBe(1);
      expect(r.out.error.code).toBe("forbidden_data");
    }
    expect(server.app.sessions.get(id)?.store.revision).toBe(revision);

    // A name that two data refs share is not ambiguous for her: only one of them is hers.
    const bare = await call("--session", id, "signal", "add", "w1", "Fast_100h.SIG_A");
    expect(bare.code, bare.stdout.join("")).toBe(0);
    expect(server.app.sessions.get(id)?.store.workspace.windows[0]?.signals[0]?.signalId).toBe(
      "testcar/Fast_100h.SIG_A",
    );
    // For an administrator the same name is ambiguous.
    const admin = token({ sub: "root", roles: ["admins"] });
    const first = await runCli([
      "--server",
      server.url,
      "--token",
      admin,
      "window",
      "create",
      "--from",
      "0",
      "--to",
      "10",
    ]);
    const adminId = first.out.session as string;
    const ambiguous = await runCli([
      "--server",
      server.url,
      "--token",
      admin,
      "--session",
      adminId,
      "signal",
      "add",
      "w1",
      "Fast_100h.SIG_A",
    ]);
    expect(ambiguous.code).toBe(1);
  });

  it("maps a server that cannot reach its identity provider to exit 7", async () => {
    m = await startMulti({
      identity: {
        kind: "test-down",
        identify: async () => {
          throw new Error("idp unreachable");
        },
      },
    });
    const r = await runCli(["--server", m.url, "--token", "anything", "whoami"]);
    expect(r.code).toBe(7);
    expect(r.out.error.code).toBe("identity_unavailable");
    expect(JSON.stringify(r.out)).not.toContain("idp unreachable");
  });

  it("is rejected by a server without rights for the roles, with the server's code", async () => {
    const { server, token } = await oidcServer();
    const nobody = token({ roles: ["nobody"] });
    const me = await runCli(["--server", server.url, "--token", nobody, "whoami"]);
    expect(me.code).toBe(0);
    expect(me.out.data.rights).toEqual({ data: [], share: false });
    const state = await runCli(["--server", server.url, "--token", nobody, "state"]);
    expect(state.code).toBe(1);
    expect(state.out.error.code).toBe("no_rights");
  });
});
