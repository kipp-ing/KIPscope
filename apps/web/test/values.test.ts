import type { CursorValue, CursorValueResult } from "@letsview/shared";
import { fromIso } from "@letsview/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCursorValue } from "../src/api.ts";
import { deltaCell, formatCell, formatCursorTime, formatDeltaT } from "../src/values/format.ts";
import { ValueLoader } from "../src/values/loader.ts";

process.env.TZ = "Europe/Berlin"; // also set by the package's test script

const raw = (value: number): CursorValue => ({ kind: "raw", value });
const lin = (value: number): CursorValue => ({ kind: "interpolated", value });
const hold = (value: number): CursorValue => ({ kind: "held", value });

describe("formatCell", () => {
  it("formats raw, interpolated and held values with their tags", () => {
    const raw23 = formatCell(raw(23));
    expect(raw23.text).toBe("23");
    expect(raw23.tag).toBeUndefined();
    expect(raw23.sna).toBeFalsy();

    // DVL 179.5 at .083 s and 180 at .103 s (UTC 13:08, local 15:08), cursor at .093 s.
    const at = { t: "1791896880083000000", v: 179.5 };
    const next = { t: "1791896880103000000", v: 180 };
    const dvl = formatCell(lin(179.75), at, next);
    expect(dvl.text).toBe("179.75");
    expect(dvl.tag).toBe("lin");
    expect(dvl.title).toContain("15:08:00.083 → 179.5");
    expect(dvl.title).toContain("15:08:00.103 → 180");

    const held = formatCell(hold(23));
    expect(held.text).toBe("23");
    expect(held.tag).toBe("hold");

    // Float noise is cut to nine significant digits.
    expect(formatCell(lin(362.40000000000003)).text).toBe("362.4");
    expect(formatCell(raw(-5)).text).toBe("-5");
  });

  it("formats SNA and missing values without a number", () => {
    const sna = formatCell({ kind: "sna" });
    expect(sna.text).toBe("SNA");
    expect(sna.sna).toBe(true);
    expect(sna.tag).toBeUndefined();
    expect(sna.text).not.toMatch(/\d/);

    const none = (reason: "no_data" | "before_first" | "after_last" | "next_sna") =>
      formatCell({ kind: "none", reason });
    for (const reason of ["no_data", "before_first", "after_last", "next_sna"] as const) {
      const cell = none(reason);
      expect(cell.text).toBe("—");
      expect(cell.tag).toBeUndefined();
      expect(cell.sna).toBeFalsy();
      expect(cell.title).toBeTruthy();
    }
    expect(none("before_first").title).toContain("before the first point");
    expect(none("after_last").title).toContain("after the last point");
    expect(none("next_sna").title).toContain("next point is SNA");
    // Not yet loaded or cursor off.
    expect(formatCell(undefined).text).toBe("—");
  });
});

describe("deltaCell", () => {
  it("computes Δ only from numeric values and tags it by the weaker kind", () => {
    // Raw and raw: V_ANZ 23 → 18.
    const speed = deltaCell(raw(23), raw(18));
    expect(speed.text).toBe("-5");
    expect(speed.tag).toBeUndefined();
    // Interpolated values with float noise: PTC_HV_Volt 362.40000000000003 → 362.9.
    const volt = deltaCell(lin(362.40000000000003), lin(362.9));
    expect(volt.text).toBe("0.5");
    expect(volt.tag).toBe("lin");
    expect(deltaCell(raw(10), raw(10)).text).toBe("0");
    // Tag: lin beats hold beats none.
    expect(deltaCell(raw(1), lin(3)).tag).toBe("lin");
    expect(deltaCell(lin(1), raw(3)).tag).toBe("lin");
    expect(deltaCell(hold(1), lin(3)).tag).toBe("lin");
    expect(deltaCell(raw(1), hold(3)).tag).toBe("hold");
    expect(deltaCell(hold(1), hold(3)).tag).toBe("hold");
    expect(deltaCell(hold(1), hold(3)).text).toBe("2");
    // Any non-number gives "—" without tag: SNA at A, no value at B, not loaded.
    for (const [a, b] of [
      [{ kind: "sna" }, lin(0)],
      [raw(1), { kind: "sna" }],
      [{ kind: "none", reason: "next_sna" }, raw(1)],
      [raw(1), { kind: "none", reason: "after_last" }],
      [undefined, raw(1)],
      [raw(1), undefined],
    ] as [CursorValue | undefined, CursorValue | undefined][]) {
      const cell = deltaCell(a, b);
      expect(cell.text).toBe("—");
      expect(cell.tag).toBeUndefined();
    }
  });
});

describe("formatDeltaT", () => {
  it("formats Δt exactly with sign", () => {
    expect(formatDeltaT(902_000_000n)).toBe("+902 ms");
    expect(formatDeltaT(-1500n)).toBe("-1.5 µs");
    expect(formatDeltaT(3_723_500_000_000n)).toBe("+1:02:03.5");
    expect(formatDeltaT(0n)).toBe("0 ns");
    expect(formatDeltaT(5n)).toBe("+5 ns");
    expect(formatDeltaT(-902_000_000n)).toBe("-902 ms");
    expect(formatDeltaT(2_500_000_000n)).toBe("+2.5 s");
  });
});

describe("formatCursorTime", () => {
  it("formats cursor times in local time down to nanoseconds", () => {
    // Europe/Berlin is UTC+2 in October (CEST) and UTC+1 in December (CET).
    expect(formatCursorTime(1791896880093000000n)).toBe("2026-10-13 15:08:00.093");
    expect(formatCursorTime(1791896880000000000n)).toBe("2026-10-13 15:08:00");
    expect(formatCursorTime(1791896880093456000n)).toBe("2026-10-13 15:08:00.093456");
    expect(formatCursorTime(1791896880093456789n)).toBe("2026-10-13 15:08:00.093456789");
    expect(formatCursorTime(1791896880000000001n)).toBe("2026-10-13 15:08:00.000000001");
    expect(formatCursorTime(fromIso("2026-12-01T12:00:00Z"))).toBe("2026-12-01 13:00:00");
  });
});

/** Fetch stub whose responses are resolved by hand, in any order. */
function controllableFetch() {
  const pending: {
    abort: AbortSignal;
    resolve: (r: CursorValueResult) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const fetch = (_request: unknown, abort: AbortSignal) =>
    new Promise<CursorValueResult>((resolve, reject) => pending.push({ abort, resolve, reject }));
  return { fetch, pending };
}

const result = (t: string, value: CursorValue, signalId = "c/V_ANZ"): CursorValueResult => ({
  signalId,
  t,
  mode: "line",
  value,
});

const row = (t: string, key = "a1:a", signalId = "c/V_ANZ") => ({
  key,
  signalId,
  t,
  mode: "line" as const,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("ValueLoader", () => {
  it("discards stale value responses", async () => {
    const { fetch, pending } = controllableFetch();
    const loader = new ValueLoader(fetch, () => {});
    // Three quick cursor moves: three requests for the same row.
    loader.update([row("100000000")]);
    loader.update([row("200000000")]);
    loader.update([row("300000000")]);
    expect(pending).toHaveLength(3);
    expect(pending[0]?.abort.aborted).toBe(true);
    expect(pending[1]?.abort.aborted).toBe(true);
    expect(pending[2]?.abort.aborted).toBe(false);
    // Answers arrive out of order: newest first, then the older ones.
    pending[2]?.resolve(result("300000000", raw(3)));
    await flush();
    pending[0]?.resolve(result("100000000", raw(1)));
    pending[1]?.resolve(result("200000000", raw(2)));
    await flush();
    expect(loader.get("a1:a")).toMatchObject({
      status: "complete",
      result: { t: "300000000", value: { kind: "raw", value: 3 } },
    });
    // Same request again: no new fetch.
    loader.update([row("300000000")]);
    expect(pending).toHaveLength(3);
    // A mode change is a new request as well.
    loader.update([{ ...row("300000000"), mode: "step" as const }]);
    expect(pending).toHaveLength(4);
    expect(pending[3]).toBeDefined();
  });

  it("reports failed value requests per row", async () => {
    const { fetch, pending } = controllableFetch();
    const changes = vi.fn();
    const loader = new ValueLoader(fetch, changes);
    const rows = [row("100", "r1:a", "c/V_ANZ"), row("100", "r2:a", "c/DVL")];
    loader.update(rows);
    expect(loader.settled(rows)).toBe(false);
    pending[0]?.reject(new Error("source_error: timeout"));
    pending[1]?.resolve(result("100", lin(179.75), "c/DVL"));
    await flush();
    expect(loader.get("r1:a")).toMatchObject({
      status: "error",
      error: expect.stringContaining("source_error: timeout"),
    });
    expect(loader.get("r2:a")).toMatchObject({
      status: "complete",
      result: { value: { kind: "interpolated", value: 179.75 } },
    });
    // Both rows have finished, so the revision can be reported (with an error).
    expect(loader.settled(rows)).toBe(true);
    expect(changes).toHaveBeenCalled();
  });
});

describe("fetchCursorValue", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws the error message of a failed value request", async () => {
    const ok = result("1791896880093000000", raw(23));
    const stub = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ok })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { code: "source_error", message: "database unreachable" } }),
      });
    vi.stubGlobal("fetch", stub);
    const abort = new AbortController().signal;
    await expect(
      fetchCursorValue("c/V_ANZ", "1791896880093000000", "line", abort),
    ).resolves.toEqual(ok);
    const url = new URL(String(stub.mock.calls[0]?.[0]), "http://x");
    expect(url.pathname).toBe("/api/value");
    expect(url.searchParams.get("signal")).toBe("c/V_ANZ");
    expect(url.searchParams.get("t")).toBe("1791896880093000000");
    expect(url.searchParams.get("mode")).toBe("line");
    await expect(fetchCursorValue("c/V_ANZ", "1", "step", abort)).rejects.toThrow(
      "database unreachable",
    );
  });
});
