import type { CursorValueResult, RenderError, ValuesMode } from "@letsview/shared";

export interface ValueRequest {
  /** One row and cursor of a values window, e.g. `${assignmentId}|a`. */
  key: string;
  signalId: string;
  /** Cursor time, decimal ns. */
  t: string;
  mode: ValuesMode;
}

export interface ValueState {
  status: "loading" | "complete" | "error";
  /** Identity of the request this state belongs to. */
  request: string;
  /** While loading, the previous result stays here so the row keeps showing it (dimmed). */
  result?: CursorValueResult;
  error?: string;
}

export type FetchValue = (request: ValueRequest, abort: AbortSignal) => Promise<CursorValueResult>;

const requestId = (r: ValueRequest) => `${r.signalId}|${r.t}|${r.mode}`;

/**
 * Loads the values of one values window per row and cursor (design C8), the counterpart of
 * SeriesLoader: a changed cursor time or mode aborts the previous request, and a response is
 * applied only if it belongs to the latest request for its key, so an older answer can never
 * replace a newer one.
 */
export class ValueLoader {
  private readonly fetch: FetchValue;
  private readonly onChange: () => void;
  private readonly states = new Map<string, ValueState>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly latest = new Map<string, number>();
  private seq = 0;

  constructor(fetch: FetchValue, onChange: () => void) {
    this.fetch = fetch;
    this.onChange = onChange;
  }

  get(key: string): ValueState | undefined {
    return this.states.get(key);
  }

  /** True when every request has finished (complete or error) for its current identity. */
  settled(requests: ValueRequest[]): boolean {
    return requests.every((r) => {
      const s = this.states.get(r.key);
      return s !== undefined && s.request === requestId(r) && s.status !== "loading";
    });
  }

  update(requests: ValueRequest[]): void {
    const wanted = new Set(requests.map((r) => r.key));
    let changed = false;
    for (const key of [...this.states.keys()]) {
      if (!wanted.has(key)) {
        this.controllers.get(key)?.abort();
        this.controllers.delete(key);
        this.states.delete(key);
        this.latest.delete(key);
        changed = true;
      }
    }
    for (const request of requests) {
      if (this.states.get(request.key)?.request === requestId(request)) continue;
      this.start(request);
      changed = true;
    }
    if (changed) this.onChange();
  }

  /**
   * Aborts every request and forgets every state, so a later update starts all of them again
   * (React's StrictMode disposes and remounts once; a kept "loading" state would never fill).
   */
  dispose(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.states.clear();
    this.latest.clear();
  }

  private start(request: ValueRequest): void {
    const { key } = request;
    this.controllers.get(key)?.abort();
    const controller = new AbortController();
    this.controllers.set(key, controller);
    const seq = ++this.seq;
    this.latest.set(key, seq);
    const previous = this.states.get(key)?.result;
    const id = requestId(request);
    this.states.set(key, {
      status: "loading",
      request: id,
      ...(previous ? { result: previous } : {}),
    });

    const isCurrent = () => this.latest.get(key) === seq;
    this.fetch(request, controller.signal).then(
      (result) => {
        if (!isCurrent()) return;
        this.states.set(key, { status: "complete", request: id, result });
        this.onChange();
      },
      (error: unknown) => {
        if (!isCurrent() || controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        this.states.set(key, { status: "error", request: id, error: message });
        this.onChange();
      },
    );
  }
}

/**
 * The state of one cell for its current request; undefined while its cursor is off. A state of an
 * older request counts as loading and keeps its result, so the cell shows it dimmed meanwhile.
 */
export function cellState(
  state: ValueState | undefined,
  request: ValueRequest | undefined,
): ValueState | undefined {
  if (!request) return undefined;
  const id = requestId(request);
  if (state?.request === id) return state;
  return { status: "loading", request: id, ...(state?.result ? { result: state.result } : {}) };
}

/** Requests of one values window: A for every row, B too in diff mode; none for a cursor that is off. */
export function valueRequests(
  rows: { id: string; signalId: string }[],
  cursors: { a?: string; b?: string; diff: boolean },
  mode: ValuesMode,
): ValueRequest[] {
  const times = [
    ["a", cursors.a],
    ["b", cursors.diff ? cursors.b : undefined],
  ] as const;
  return rows.flatMap((row) =>
    times.flatMap(([cursor, t]) =>
      t === undefined ? [] : [{ key: `${row.id}|${cursor}`, signalId: row.signalId, t, mode }],
    ),
  );
}

/** Render errors of a values window: one per row whose A or B request failed, naming its signal. */
export function valueErrors(
  windowId: string,
  requests: ValueRequest[],
  loader: Pick<ValueLoader, "get">,
): RenderError[] {
  const errors = new Map<string, string>();
  for (const r of requests) {
    const state = loader.get(r.key);
    if (state?.status === "error" && state.request === requestId(r) && !errors.has(r.signalId)) {
      errors.set(r.signalId, state.error ?? "error");
    }
  }
  return [...errors].map(([signalId, message]) => ({ windowId, signalId, message }));
}
