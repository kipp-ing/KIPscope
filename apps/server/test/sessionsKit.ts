/** Shared bits of the session store tests (add-multiuser M4). */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMPTY_WORKSPACE, type Workspace } from "@kipscope/shared";
import { SessionStore } from "../src/sessions.ts";

/** An apply context that knows every signal (the store tests do not need a catalog). */
export const ctx = {
  signalExists: () => true,
  hasStates: () => false,
  catalogReady: () => true,
};

/** 2026-10-01T01:00:00Z and 02:00:00Z in ns, by hand (1790816400 s and 1790820000 s). */
export const T1 = "1790816400000000000";
export const T2 = "1790820000000000000";

export interface Logs {
  info: string[];
  warn: string[];
  log: { info(m: string): void; warn(m: string): void };
}

export function logs(): Logs {
  const info: string[] = [];
  const warn: string[] = [];
  return { info, warn, log: { info: (m) => info.push(m), warn: (m) => warn.push(m) } };
}

/** A temp state dir, removed by `cleanup`. */
export function tempState(prefix = "kipscope-sessions-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    dir,
    sessionsDir: join(dir, "sessions"),
    files: () =>
      existsSync(join(dir, "sessions")) ? readdirSync(join(dir, "sessions")).sort() : [],
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export const seedEmpty = (): Workspace => EMPTY_WORKSPACE;

/** A store on `dir` whose clock is `Date.now()` (so vitest's fake timers move it). */
export function newStore(
  dir: string,
  extra: Partial<ConstructorParameters<typeof SessionStore>[0]> = {},
  seed: () => Workspace = seedEmpty,
) {
  const out = logs();
  const store = new SessionStore({
    dir,
    seed,
    idleDays: 30,
    now: () => Date.now(),
    log: out.log,
    ...extra,
  });
  return { store, ...out };
}
