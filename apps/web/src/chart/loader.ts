import type { SeriesResult } from "@letsview/shared";

export interface LoadRequest {
  /** Assignment ID: one signal's place in a window. */
  key: string;
  signalId: string;
  from: string;
  to: string;
  target: number;
}

export interface LoadState {
  status: "loading" | "complete" | "error";
  /** Identity of the request this state belongs to. */
  request: string;
  /** While loading, the previous result stays here so the window keeps showing it. */
  result?: SeriesResult;
  error?: string;
}

export type FetchSeries = (request: LoadRequest, abort: AbortSignal) => Promise<SeriesResult>;

const requestId = (r: LoadRequest) => `${r.signalId}|${r.from}|${r.to}|${r.target}`;

/**
 * Loads series per signal of one window (design D9). A new range aborts the previous request,
 * and a response is applied only if it belongs to the latest request for its signal, so an
 * out-of-order answer can never replace newer data.
 */
export class SeriesLoader {
  private readonly fetch: FetchSeries;
  private readonly onChange: () => void;
  private readonly states = new Map<string, LoadState>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly latest = new Map<string, number>();
  private seq = 0;

  constructor(fetch: FetchSeries, onChange: () => void) {
    this.fetch = fetch;
    this.onChange = onChange;
  }

  get(key: string): LoadState | undefined {
    return this.states.get(key);
  }

  /** True when every requested signal has finished (complete or error) for its current request. */
  settled(requests: LoadRequest[]): boolean {
    return requests.every((r) => {
      const s = this.states.get(r.key);
      return s !== undefined && s.request === requestId(r) && s.status !== "loading";
    });
  }

  update(requests: LoadRequest[]): void {
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

  dispose(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }

  private start(request: LoadRequest): void {
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
