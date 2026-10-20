/**
 * Helpers of the object-scope tests (add-case-open): a server over the test DB (or another
 * adapter) with catalog C4 open and its workspace unlinked. Tests call `afterEach(closeApps)`.
 */
import { expect } from "vitest";
import type { SourceAdapter } from "../src/datasource.ts";
import { c4, classRecording } from "./caseKit.ts";
import { type Client, type MultiApp, multiApp } from "./identityApp.ts";
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
