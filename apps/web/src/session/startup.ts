import {
  type CommandResult,
  type CreateSessionRequest,
  type Me,
  SESSION_ID,
  type SessionSummary,
  sessionPath,
} from "@kipscope/shared";
import { useEffect, useState } from "react";
import { ApiRequestError, createSession, fetchMe, fetchSession, listSessions } from "../api.ts";
import { startupView } from "../views/link.ts";
import { setSession } from "./apiPath.ts";
import { type Gate, gateOf } from "./gate.ts";

type Address = Pick<Location, "pathname" | "search" | "hash">;

/** Where the page starts (add-multiuser M12 "Start-up"). */
export type StartupTarget =
  | { session: string }
  | { create: CreateSessionRequest }
  | { latest: true };

const SESSION_PAGE = /^\/s\/([^/]+)\/?$/;

/**
 * The session the address asks for: `#view=` or `?view=` on any path → a new session with that
 * view open; `/s/<id>` → that session; `/` → the first of `sessions` the user may open, else a new
 * one; any other path → the latest session. Rejects a view code that does not decode.
 */
export async function startupTarget(
  location: Address,
  sessions: readonly SessionSummary[],
): Promise<StartupTarget> {
  const asked = await startupView(location);
  if (asked) {
    return {
      create: { open: "name" in asked ? asked : { view: asked.view as Record<string, unknown> } },
    };
  }
  const page = SESSION_PAGE.exec(location.pathname);
  if (page?.[1] !== undefined && SESSION_ID.test(page[1])) return { session: page[1] };
  if (location.pathname === "/") {
    const first = sessions.find((s) => s.rights !== undefined);
    return first ? { session: first.id } : { create: {} };
  }
  return { latest: true };
}

/** The outcome of the start-up: the page's session, or a gate page. */
export type Startup =
  | { kind: "pending" }
  | { kind: "gate"; gate: Gate; me?: Me }
  | {
      kind: "ready";
      session: string;
      me: Me;
      /** The open's error, or a link that did not decode, for the message line. */
      message?: string;
      /** The open of a `#view=`/`?view=` link in the new session, for the "Opened" notice. */
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
function gateFor(e: unknown, me?: Me): Gate | undefined {
  if (!(e instanceof ApiRequestError)) return undefined;
  const gate = gateOf(e, me);
  if (gate || e.status >= 500) return gate;
  return { title: "Cannot open KIPscope", text: e.message, actions: [] };
}

/** Retries `request` every second until it answers or fails with a gate's error. */
async function patiently<T>(request: () => Promise<T>, me?: Me): Promise<T | { gate: Gate }> {
  for (;;) {
    try {
      return await request();
    } catch (e) {
      const gate = gateFor(e, me);
      if (gate) return { gate };
      await sleep(RETRY_MS);
    }
  }
}

const isGate = (v: unknown): v is { gate: Gate } =>
  typeof v === "object" && v !== null && "gate" in v;

/** A new session with `req`'s view open; waits while the catalog first loads. */
async function create(
  req: CreateSessionRequest,
): Promise<{ session?: SessionSummary; result?: CommandResult }> {
  const deadline = Date.now() + CATALOG_WAIT_MS;
  for (;;) {
    try {
      const answer = await createSession(req);
      const waiting =
        !answer.session &&
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
 * Runs the start-up (M12): reads `/api/me` and the session list, picks the session per
 * `startupTarget`, creates one when needed, checks a named one, and replaces the address with
 * `/s/<id>` without a reload. A refused open falls back to the latest session with its error.
 */
export async function startSession(
  location: Address,
): Promise<Exclude<Startup, { kind: "pending" }>> {
  const me = await patiently(() => fetchMe());
  if (isGate(me)) return { kind: "gate", gate: me.gate };
  const list = await patiently(() => listSessions(), me);
  if (isGate(list)) return { kind: "gate", gate: list.gate, me };

  let message: string | undefined;
  let target: StartupTarget;
  try {
    target = await startupTarget(location, list.sessions);
  } catch (e) {
    message = `Cannot read the view link: ${errorText(e)}`;
    target = { latest: true };
  }

  let opened: CommandResult | undefined;
  if ("create" in target && target.create.open) {
    try {
      const answer = await create(target.create);
      if (answer.session) {
        target = { session: answer.session.id };
        opened = answer.result;
      } else {
        const r = answer.result;
        message = r && !r.ok ? `${r.code}: ${r.message}` : "the view did not open";
        target = { latest: true };
      }
    } catch (e) {
      // Only the identity's own refusals stop the page; a refused open falls back to the latest.
      const gate = e instanceof ApiRequestError ? gateOf(e, me) : undefined;
      if (gate) return { kind: "gate", gate, me };
      message = errorText(e);
      target = { latest: true };
    }
  }
  if ("latest" in target) {
    const first = list.sessions.find((s) => s.rights !== undefined);
    target = first ? { session: first.id } : { create: {} };
  }

  let id: string;
  if ("session" in target) {
    const named = target.session;
    const checked = await patiently(() => fetchSession(named), me);
    if (isGate(checked)) return { kind: "gate", gate: checked.gate, me };
    id = named;
  } else {
    const created = await patiently(() => createSession({}), me);
    if (isGate(created)) return { kind: "gate", gate: created.gate, me };
    if (!created.session) return { kind: "gate", gate: { title: "No session", actions: [] }, me };
    id = created.session.id;
  }
  setSession(id);
  history.replaceState(null, "", sessionPath(id));
  return {
    kind: "ready",
    session: id,
    me,
    ...(message ? { message } : {}),
    ...(opened ? { opened } : {}),
  };
}

// One start-up per page: StrictMode runs effects twice, and a second run would create a second
// session for `/` or a link.
let started: Promise<Exclude<Startup, { kind: "pending" }>> | undefined;

/** The start-up as React state: pending until the page's session is chosen (before the live channel opens). */
export function useStartup(): Startup {
  const [state, setState] = useState<Startup>({ kind: "pending" });
  useEffect(() => {
    let live = true;
    started ??= startSession(location);
    void started.then((s) => {
      if (live) setState(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}
