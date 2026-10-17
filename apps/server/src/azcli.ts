import { execFile } from "node:child_process";

/** Runs `file` with `args`; resolves with stdout, rejects with `{code?, stderr?}`. */
export type CommandRunner = (
  file: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<string>;

/** A token is renewed this long before it expires (a query never runs on a dying token). */
export const TOKEN_MARGIN_MS = 300_000;
/** Longest wait for one `az` run (a cold CLI start takes a few seconds). */
export const AZ_TIMEOUT_MS = 30_000;
/** Lifetime assumed when the CLI answer names no expiry. */
const DEFAULT_LIFETIME_MS = 600_000;

// On Windows the CLI is `az.cmd`, which only a shell runs.
const runCommand: CommandRunner = (file, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: timeoutMs,
        shell: process.platform === "win32",
        windowsHide: true,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { stderr }));
        else resolve(stdout);
      },
    );
  });

interface TokenAnswer {
  accessToken?: string;
  /** Epoch seconds (CLI ≥ 2.54). */
  expires_on?: number | string;
  /** Local time, `YYYY-MM-DD HH:MM:SS.ffffff` (older CLIs). */
  expiresOn?: string;
}

function expiry(answer: TokenAnswer, now: number): number {
  const epoch = Number(answer.expires_on);
  if (answer.expires_on !== undefined && Number.isFinite(epoch)) return epoch * 1000;
  if (answer.expiresOn) {
    // Without an offset, Date reads it as local time; keep milliseconds only.
    const local = Date.parse(answer.expiresOn.replace(" ", "T").replace(/(\.\d{3})\d+/, "$1"));
    if (Number.isFinite(local)) return local;
  }
  return now + DEFAULT_LIFETIME_MS;
}

/** What to do about a failed `az` run; never the token (a failed run prints none). */
function cliError(error: unknown): Error {
  const { code, stderr, killed } = (error ?? {}) as {
    code?: unknown;
    stderr?: unknown;
    killed?: boolean;
  };
  if (code === "ENOENT") return new Error("Azure CLI (az) not found; install it and run az login");
  const line = String(stderr ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1)
    ?.replace(/^ERROR: /, "");
  if (line) return new Error(`Azure CLI: ${line}`);
  if (killed) return new Error(`Azure CLI: no answer within ${AZ_TIMEOUT_MS / 1000} s`);
  return new Error(`Azure CLI: az account get-access-token failed${code ? ` (exit ${code})` : ""}`);
}

/**
 * Token getter for `resource` (the cluster origin) from the user's `az login` (design C6, A-1 (a)):
 * cached in memory until TOKEN_MARGIN_MS before expiry, one run shared by concurrent callers, a
 * failed run not cached.
 */
export function azCliToken(
  resource: string,
  run: CommandRunner = runCommand,
  now: () => number = Date.now,
): () => Promise<string> {
  let cached: { token: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;
  const args = ["account", "get-access-token", "--resource", resource, "--output", "json"];

  const fetchToken = async (): Promise<string> => {
    let stdout: string;
    try {
      stdout = await run("az", args, AZ_TIMEOUT_MS);
    } catch (error) {
      throw cliError(error);
    }
    let answer: TokenAnswer;
    try {
      answer = JSON.parse(stdout);
    } catch {
      throw new Error("Azure CLI: az account get-access-token gave no JSON");
    }
    if (typeof answer.accessToken !== "string" || !answer.accessToken) {
      throw new Error("Azure CLI: az account get-access-token gave no accessToken");
    }
    cached = { token: answer.accessToken, expiresAt: expiry(answer, now()) };
    return answer.accessToken;
  };

  return () => {
    if (cached && now() < cached.expiresAt - TOKEN_MARGIN_MS) return Promise.resolve(cached.token);
    pending ??= fetchToken().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
