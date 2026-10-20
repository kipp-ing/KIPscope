import {
  type CommandResult,
  type CreateWorkspaceRequest,
  LEGACY_UI_PATH,
  type Me,
  WORKSPACE_ID,
  type WorkspaceSummary,
  workspacePath,
} from "@kipscope/shared";
import { useEffect, useState } from "react";
import { ApiRequestError, createWorkspace, fetchMe, fetchWorkspace } from "../api.ts";
import { startupView } from "../views/link.ts";
import { setWorkspace } from "./apiPath.ts";
import { type Gate, gateOf } from "./gate.ts";

type Address = Pick<Location, "pathname" | "search" | "hash">;

/** Where the page starts (add-multiuser M12 "Start-up"). */
export type StartupTarget =
  | { workspace: string; path: string }
  | { create: CreateWorkspaceRequest };

const REUSE: StartupTarget = { create: { reuse: true } };
const WORKSPACE_PAGE = /^\/w\/([^/]+)\/?$/;
const LEGACY_PAGE = new RegExp(`^${LEGACY_UI_PATH}([^/]+)/?$`);

/**
 * The workspace the address asks for: `#view=` or `?view=` on any path → a new workspace with that
 * view open; `/w/<id>`, or the legacy `/s/<id>`, → that workspace at `/w/<id>`; `/` or any other
 * path → a free workspace of the user reused, else a new one (M4). Rejects a view code that does
 * not decode.
 */
export async function startupTarget(location: Address): Promise<StartupTarget> {
  const asked = await startupView(location);
  if (asked) {
    return {
      create: { open: "name" in asked ? asked : { view: asked.view as Record<string, unknown> } },
    };
  }
  const id = (WORKSPACE_PAGE.exec(location.pathname) ?? LEGACY_PAGE.exec(location.pathname))?.[1];
  if (id !== undefined && WORKSPACE_ID.test(id)) return { workspace: id, path: workspacePath(id) };
  return REUSE;
}

/** The outcome of the start-up: the page's workspace, or a gate page. */
export type Startup =
  | { kind: "pending" }
  | { kind: "gate"; gate: Gate; me?: Me }
  | {
      kind: "ready";
      workspace: string;
      me: Me;
      /** The open's error, or a link that did not decode, for the message line. */
      message?: string;
      /** The open of a `#view=`/`?view=` link in the new workspace, for the "Opened" notice. */
      opened?: CommandResult;
    };

const RETRY_MS = 1000;
// The server refuses an open with `catalog_unavailable` until its catalog first loaded.
const CATALOG_WAIT_MS = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The gate for an error of the start-up: a gate page's own (M12), else any other refusal with its
 * text; undefined for what passes by itself (no network, a 5xx while the server restarts).
 */
function gateFor(e: unknown): Gate | undefined {
  if (!(e instanceof ApiRequestError)) return undefined;
  const gate = gateOf(e);
  if (gate || e.status >= 500) return gate;
  return { title: "Cannot open KIPscope", text: e.message, actions: [] };
}

/** Retries `request` every second until it answers or fails with a gate's error. */
async function patiently<T>(request: () => Promise<T>): Promise<T | { gate: Gate }> {
  for (;;) {
    try {
      return await request();
    } catch (e) {
      const gate = gateFor(e);
      if (gate) return { gate };
      await sleep(RETRY_MS);
    }
  }
}

const isGate = (v: unknown): v is { gate: Gate } =>
  typeof v === "object" && v !== null && "gate" in v;

/** A new workspace with `req`'s view open; waits while the catalog first loads. */
async function create(
  req: CreateWorkspaceRequest,
): Promise<{ workspace?: WorkspaceSummary; result?: CommandResult }> {
  const deadline = Date.now() + CATALOG_WAIT_MS;
  for (;;) {
    try {
      const answer = await createWorkspace(req);
      const waiting =
        !answer.workspace &&
        answer.result?.ok === false &&
        answer.result.code === "catalog_unavailable";
      if (waiting && Date.now() < deadline) {
        await sleep(RETRY_MS);
        continue;
      }
      return answer;
    } catch (e) {
      const waiting = e instanceof ApiRequestError && e.code === "catalog_unavailable";
      if (!waiting || Date.now() >= deadline) throw e;
      await sleep(RETRY_MS);
    }
  }
}

/**
 * Runs the start-up (M12): reads `/api/me`, picks the workspace per `startupTarget`, opens a link's
 * view in a new workspace, checks a named one or reuses a free one, and replaces the address with
 * `/w/<id>` without a reload. A refused open falls back to what `/` gives, with its error.
 */
export async function startWorkspace(
  location: Address,
): Promise<Exclude<Startup, { kind: "pending" }>> {
  const me = await patiently(() => fetchMe());
  if (isGate(me)) return { kind: "gate", gate: me.gate };

  let message: string | undefined;
  let target: StartupTarget;
  try {
    target = await startupTarget(location);
  } catch (e) {
    message = `Cannot read the view link: ${errorText(e)}`;
    target = REUSE;
  }

  let opened: CommandResult | undefined;
  let id: string | undefined;
  if ("create" in target && target.create.open) {
    try {
      const answer = await create(target.create);
      if (answer.workspace) {
        id = answer.workspace.id;
        opened = answer.result;
      } else {
        const r = answer.result;
        message = r && !r.ok ? `${r.code}: ${r.message}` : "the view did not open";
      }
    } catch (e) {
      // Only the identity's own refusals stop the page; a refused open falls back as `/`.
      const gate = e instanceof ApiRequestError ? gateOf(e) : undefined;
      if (gate) return { kind: "gate", gate, me };
      message = errorText(e);
    }
    target = REUSE;
  }

  if (id === undefined && "workspace" in target) {
    const named = target.workspace;
    const checked = await patiently(() => fetchWorkspace(named));
    if (isGate(checked)) return { kind: "gate", gate: checked.gate, me };
    id = named;
  } else if (id === undefined) {
    const reused = await patiently(() => createWorkspace({ reuse: true }));
    if (isGate(reused)) return { kind: "gate", gate: reused.gate, me };
    if (!reused.workspace) {
      return { kind: "gate", gate: { title: "No workspace", actions: [] }, me };
    }
    id = reused.workspace.id;
  }
  setWorkspace(id);
  history.replaceState(null, "", workspacePath(id));
  return {
    kind: "ready",
    workspace: id,
    me,
    ...(message ? { message } : {}),
    ...(opened ? { opened } : {}),
  };
}

// One start-up per page: StrictMode runs effects twice, and a second run would create a second
// workspace for a link.
let started: Promise<Exclude<Startup, { kind: "pending" }>> | undefined;

/** The start-up as React state: pending until the page's workspace is chosen (before the live channel opens). */
export function useStartup(): Startup {
  const [state, setState] = useState<Startup>({ kind: "pending" });
  useEffect(() => {
    let live = true;
    started ??= startWorkspace(location);
    void started.then((s) => {
      if (live) setState(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}
