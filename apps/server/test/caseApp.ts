/**
 * Helpers of the object-scope tests (add-case-open): a server over the test DB (or another
 * adapter) with catalog C4 open and its workspace unlinked. Tests call `afterEach(closeApps)`.
 */
import { expect } from "vitest";
import type { SourceAdapter } from "../src/datasource.ts";
import { c4, classRecording } from "./caseKit.ts";
import { type Client, type MultiApp, multiApp, realSleep } from "./identityApp.ts";
import { testSource } from "./testdb.ts";

const apps: MultiApp[] = [];

/** Closes every server `unlinked` started. */
export async function closeApps() {
  await Promise.all(apps.splice(0).map((a) => a.close()));
}

type Options = Parameters<typeof multiApp>[0];

/** A scoped-mode server with the catalog open at entry 0 (the caller unlinks). */
export async function unlinked(options: Options = {}, doc: Record<string, unknown> = c4()) {
  const log = classRecording((options?.adapter ?? testSource()) as SourceAdapter);
  const t = await multiApp({
    mode: "scoped",
    identity: "none",
    dbc: true,
    ...options,
    adapter: log.adapter,
  });
  apps.push(t);
  const opened = await t.anon.post("/api/workspaces", { open: { cases: doc } });
  expect(opened.status, JSON.stringify(opened.body)).toBe(200);
  const id = opened.body.workspace.id as string;
  return { t, id, log: log.log, calls: t.calls };
}

/** `case.unlink` on the workspace; demands success. */
export async function unlink(client: Client, id: string) {
  const answer = await client.command({ type: "case.unlink" }, id);
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return answer;
}

export const stateOf = async (client: Client, id: string) =>
  (await client.get(`/api/w/${id}/workspace`)).body;

/**
 * An adapter whose calls matching `hold` wait for `release()` before they run: the way a test holds
 * the prefetch chain (`chainPrefetch`, one job after another per app) at its first job, so the jobs
 * behind it start only when the test lets them. `held` lists the methods that waited.
 */
export function gated<T extends SourceAdapter>(
  adapter: T,
  hold: (method: string, args: unknown[]) => boolean,
): { adapter: T; release: () => void; held: string[] } {
  const held: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const wrapped = new Proxy(adapter, {
    get(target, key, receiver) {
      const member = Reflect.get(target, key, receiver);
      if (typeof member !== "function") return member;
      return async (...args: unknown[]) => {
        if (hold(String(key), args)) {
          held.push(String(key));
          await gate;
        }
        return member.apply(target, args);
      };
    },
    has: (target, key) => Reflect.has(target, key),
  });
  return { adapter: wrapped, release, held };
}

/**
 * Waits until `calls` stopped growing for `idleMs` (the prefetch chain has drained), on real
 * timers. For a test that must tell the calls of its own request from queued background work.
 */
export async function quiet(calls: readonly unknown[], idleMs = 200, limitMs = 10_000) {
  const end = Date.now() + limitMs;
  let seen = -1;
  let since = Date.now();
  while (Date.now() < end) {
    if (calls.length !== seen) {
      seen = calls.length;
      since = Date.now();
    } else if (Date.now() - since >= idleMs) return;
    await realSleep(25);
  }
  throw new Error(`source calls never went quiet (${calls.length} calls)`);
}
