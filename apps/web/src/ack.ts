import {
  MAX_RENDER_ERROR_LENGTH,
  MAX_RENDER_ERRORS,
  type RenderError,
  type RenderedMessage,
} from "@letsview/shared";

/**
 * Render acknowledgement (design H6): a revision counts as rendered once every window reported it.
 * Sent again for the same revision when its errors change (a retry succeeded or failed differently)
 * and after the live channel reopens; a message counts as sent only when `send` took it.
 */
export class Acknowledger {
  private readonly send: (message: RenderedMessage) => boolean;
  private readonly reports = new Map<string, { revision: number; errors: RenderError[] }>();
  private revision = -1;
  private windowIds: readonly string[] = [];
  private lastSent = "";

  constructor(send: (message: RenderedMessage) => boolean) {
    this.send = send;
  }

  /** The live state's revision and window IDs in workspace order. */
  setState(revision: number, windowIds: readonly string[]): void {
    this.revision = revision;
    this.windowIds = windowIds;
    this.trySend();
  }

  /** A window drew `revision` (its `onReady`). */
  report(windowId: string, revision: number, errors: RenderError[]): void {
    this.reports.set(windowId, { revision, errors });
    this.trySend();
  }

  /** The live channel opened: the server knows nothing of this client's earlier acknowledgements. */
  reconnected(): void {
    this.lastSent = "";
    this.trySend();
  }

  private trySend(): void {
    const revision = this.revision;
    if (revision < 0) return;
    const reports = this.windowIds.map((id) => this.reports.get(id));
    if (reports.some((r) => r?.revision !== revision)) return;
    // Bounded like RenderedMessage (design H4), so the server never ignores it.
    const errors = reports
      .flatMap((r) => r?.errors ?? [])
      .slice(0, MAX_RENDER_ERRORS)
      .map((e) =>
        e.message.length > MAX_RENDER_ERROR_LENGTH
          ? { ...e, message: e.message.slice(0, MAX_RENDER_ERROR_LENGTH) }
          : e,
      );
    const key = JSON.stringify([revision, errors]);
    if (key === this.lastSent) return;
    const status = errors.length ? "error" : "complete";
    if (this.send({ type: "rendered", revision, status, errors })) this.lastSent = key;
  }
}
