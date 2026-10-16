import type { RenderStatus } from "@kipscope/shared";
import { CliError, type RenderWait } from "./output.ts";

export const POLL_MS = 100;
/** No UI connected this long in a row ends the wait with no_ui; a reconnect gap is shorter. */
export const NO_UI_GRACE_MS = 2000;

export interface WaitDeps {
  renderStatus(): Promise<RenderStatus>;
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** Design L4: the first UI that acknowledges `target` or a later revision ends the wait; deadline is an absolute now()-time. */
export async function waitForRender(
  target: number,
  deadline: number,
  deps: WaitDeps,
): Promise<RenderWait> {
  const start = deps.now();
  let lastClientSeen = start;
  for (;;) {
    let status: RenderStatus;
    try {
      status = await deps.renderStatus();
    } catch (error) {
      // The deadline ran out inside the request: still a wait that timed out.
      if (error instanceof CliError && error.outcome === "timeout") {
        return { status: "timeout", target, waitedMs: deps.now() - start };
      }
      throw error;
    }
    const now = deps.now();
    const waitedMs = now - start;
    const acked = status.clients.filter(
      (client) => client.rendered !== undefined && client.rendered.revision >= target,
    );
    const failed = acked.find((client) => client.rendered?.status === "error");
    const first = failed ?? acked[0];
    if (first?.rendered !== undefined) {
      const { revision, errors } = first.rendered;
      return failed !== undefined
        ? { status: "error", target, revision, clientId: first.clientId, errors, waitedMs }
        : { status: "complete", target, revision, clientId: first.clientId, waitedMs };
    }
    if (status.clients.length > 0) lastClientSeen = now;
    else if (now - lastClientSeen >= NO_UI_GRACE_MS) return { status: "no_ui", target, waitedMs };
    if (now >= deadline) return { status: "timeout", target, waitedMs };
    await deps.sleep(POLL_MS);
  }
}
