import { describe, expect, it } from "vitest";
import { AZ_TIMEOUT_MS, azCliToken, type CommandRunner, TOKEN_MARGIN_MS } from "../src/azcli.ts";

const CLUSTER = "https://help.kusto.windows.net";
const START = Date.UTC(2026, 9, 17, 12, 0, 0);
const MIN = 60_000;

/** A runner that answers with the next token, valid for `lifetimeMs` from the fake clock's time. */
function fakeRunner(clock: { now: number }, lifetimeMs = 60 * MIN) {
  const runs: { file: string; args: readonly string[]; timeoutMs: number }[] = [];
  const run: CommandRunner = async (file, args, timeoutMs) => {
    runs.push({ file, args, timeoutMs });
    await Promise.resolve();
    return JSON.stringify({
      accessToken: `tok-${runs.length}`,
      expires_on: Math.floor((clock.now + lifetimeMs) / 1000),
      tokenType: "Bearer",
    });
  };
  return { run, runs };
}

describe("azCliToken", () => {
  it("caches the token until five minutes before expiry", async () => {
    expect(TOKEN_MARGIN_MS).toBe(5 * MIN);
    const clock = { now: START };
    const { run, runs } = fakeRunner(clock);
    const token = azCliToken(CLUSTER, run, () => clock.now);

    // Three at once share one run.
    const first = await Promise.all([token(), token(), token()]);
    expect(first).toEqual(["tok-1", "tok-1", "tok-1"]);
    expect(runs).toHaveLength(1);

    // 54 min later (6 min before expiry) the cached token is still used.
    clock.now = START + 54 * MIN;
    expect(await token()).toBe("tok-1");
    expect(runs).toHaveLength(1);

    // At 56 min (4 min before expiry) a new one is fetched.
    clock.now = START + 56 * MIN;
    expect(await token()).toBe("tok-2");
    expect(runs).toHaveLength(2);

    expect(runs[0]).toEqual({
      file: "az",
      args: ["account", "get-access-token", "--resource", CLUSTER, "--output", "json"],
      timeoutMs: AZ_TIMEOUT_MS,
    });
    expect(AZ_TIMEOUT_MS).toBe(30_000);
  });

  it("explains a missing or logged-out CLI", async () => {
    const clock = { now: START };
    const answers: (() => Promise<string>)[] = [
      () => Promise.reject(Object.assign(new Error("spawn az ENOENT"), { code: "ENOENT" })),
      () =>
        Promise.reject(
          Object.assign(new Error("Command failed: az account get-access-token"), {
            code: 1,
            stderr: "ERROR: Please run 'az login' to setup account.\n",
          }),
        ),
    ];
    let calls = 0;
    const run: CommandRunner = async () => {
      const next = answers[calls++];
      if (next) return next();
      return JSON.stringify({
        accessToken: "tok-ok",
        expires_on: Math.floor((clock.now + 60 * MIN) / 1000),
      });
    };
    const token = azCliToken(CLUSTER, run, () => clock.now);

    const missing = await token().catch((error: Error) => error);
    expect(missing).toBeInstanceOf(Error);
    expect((missing as Error).message).toBe(
      "Azure CLI (az) not found; install it and run az login",
    );

    const loggedOut = await token().catch((error: Error) => error);
    expect((loggedOut as Error).message).toBe("Azure CLI: Please run 'az login' to setup account.");

    // A failed run is not cached: the next call runs again and succeeds.
    expect(await token()).toBe("tok-ok");
    expect(calls).toBe(3);
  });
});
