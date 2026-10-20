import {
  type CasePreview,
  caseRanges,
  isTimeseries,
  parseSignalId,
  rebindSignalId,
  type Workspace,
} from "@kipscope/shared";
import { fetchCasePreview } from "../api.ts";
import { CACHE_LIMIT, type SeriesCache, tabSeriesCache } from "../chart/cache.ts";
import { windowTargets } from "../chart/loader.ts";
import {
  BUCKET_WEIGHT,
  levelFor,
  TILE_BUCKETS,
  TILE_OVERHEAD,
  tileable,
  tileWeight,
  touchedTiles,
} from "../chart/tiles.ts";

/** Quiet time after a complete render before the neighbours are preloaded (K13). */
export const PRELOAD_DELAY_MS = 500;
/** Weight preloaded at most since the last step: 25 % of the cache (K13). */
export const PRELOAD_BUDGET = CACHE_LIMIT / 4;
/** Bucket target of a window whose width the preload does not know yet. */
const DEFAULT_TARGET = 1000;
/** A tile's weight before any preloaded tile was seen: a full bucket tile. */
const FIRST_TILE_WEIGHT = TILE_OVERHEAD + BUCKET_WEIGHT * TILE_BUCKETS;
/** Keys that are no gesture on their own (K13: "other than a lone modifier"). */
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"]);

export interface PreloadOptions {
  cache?: SeriesCache;
  /** `GET /api/case/preview` with the preload class. */
  preview?: (index: number, abort: AbortSignal) => Promise<CasePreview>;
  delayMs?: number;
  budget?: number;
  /** A window's bucket target (its plot width); default the windows' own (windowTargets). */
  targetOf?: (windowId: string) => number | undefined;
}

/**
 * Neighbour preload of one tab (add-case-open K13). While the workspace has a linked case, 500 ms
 * after the tab's render acknowledgement for the current revision was `complete` and no visible
 * load is in flight, it previews the next entry, then the previous one, and fetches for each the
 * tiles every timeseries window will request there (ranges by `caseRanges`, signals rebound by
 * `rebindSignalId`) with `case=<n>` and the preload class, one run after another, within
 * PRELOAD_BUDGET since the last step. Any gesture, command of the tab and new revision aborts it;
 * tiles already stored stay; it starts again after the next complete acknowledgement.
 */
export class NeighbourPreload {
  private readonly cache: SeriesCache;
  private readonly preview: (index: number, abort: AbortSignal) => Promise<CasePreview>;
  private readonly delayMs: number;
  private readonly budget: number;
  private readonly targetOf: (windowId: string) => number | undefined;
  private revision = -1;
  private workspace: Workspace | undefined;
  /** The plan (planKey) armed or running now, and the last one that ran to its end. */
  private plan: string | undefined;
  private done: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private owner: string | undefined;
  private runs = 0;
  /** Weight preloaded since the last step, and the catalog position it counts for. */
  private spent = 0;
  private spentFor: string | undefined;
  /** Mean weight of a tile of the last preloaded run: the estimate of the next run before it starts. */
  private tileEstimate = FIRST_TILE_WEIGHT;

  constructor(options: PreloadOptions = {}) {
    this.cache = options.cache ?? tabSeriesCache();
    this.preview = options.preview ?? fetchCasePreview;
    this.delayMs = options.delayMs ?? PRELOAD_DELAY_MS;
    this.budget = options.budget ?? PRELOAD_BUDGET;
    this.targetOf = options.targetOf ?? ((id) => windowTargets.get(id));
  }

  /** A state push: a new revision aborts the preload (K13). */
  state(revision: number): void {
    if (revision === this.revision) return;
    this.cancel();
    this.revision = revision;
    this.workspace = undefined;
  }

  /**
   * The tab acknowledged `revision` of `workspace` with `status`: a `complete` one of the current
   * revision with a linked case starts the quiet time (K13).
   */
  rendered(revision: number, workspace: Workspace, status: "complete" | "error"): void {
    if (revision !== this.revision) this.state(revision);
    const c = workspace.case;
    const position = c ? `${c.catalogId}|${c.current}` : undefined;
    if (position !== this.spentFor) {
      this.spent = 0;
      this.spentFor = position;
    }
    if (status !== "complete" || !c?.linked) {
      this.cancel();
      return;
    }
    // Acknowledgements come again and again for one revision: a plan armed, running or run to its
    // end is not started again, so no tile and no preview is asked twice.
    const plan = this.planKey(workspace);
    if (plan === this.done) return;
    if (plan === this.plan && (this.timer !== undefined || this.controller)) return;
    this.cancel();
    this.workspace = workspace;
    this.plan = plan;
    this.arm();
  }

  /** A command of this tab, a gesture or a new revision: aborts every preload request (K13). */
  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    this.controller = undefined;
    if (this.owner !== undefined) this.cache.release(this.owner);
    this.owner = undefined;
    this.workspace = undefined;
    this.plan = undefined;
  }

  /** What a run would fetch: the case position and every timeseries window's range, target and signals. */
  private planKey(workspace: Workspace): string {
    const c = workspace.case;
    const windows = workspace.windows
      .filter(isTimeseries)
      .map((w) => [
        w.id,
        w.range.from,
        w.range.to,
        this.targetOf(w.id) ?? DEFAULT_TARGET,
        ...w.signals.map((s) => s.signalId),
      ]);
    return JSON.stringify([c?.catalogId, c?.current, c?.alignAt, workspace.scope, windows]);
  }

  /** Pointer down, wheel and key presses (not a lone modifier) on `target` cancel; returns detach. */
  listen(target: EventTarget = window): () => void {
    const onGesture = (e: Event) => {
      if (e.type === "keydown" && MODIFIERS.has((e as KeyboardEvent).key)) return;
      this.cancel();
    };
    const types = ["pointerdown", "wheel", "keydown"];
    for (const type of types)
      target.addEventListener(type, onGesture, { capture: true, passive: true });
    return () => {
      for (const type of types) target.removeEventListener(type, onGesture, { capture: true });
    };
  }

  dispose(): void {
    this.cancel();
  }

  /** Starts the quiet time; a visible load still in flight when it ends starts it again. */
  private arm(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const workspace = this.workspace;
      if (!workspace) return;
      if (this.cache.visibleInFlight > 0) {
        this.arm();
        return;
      }
      const controller = new AbortController();
      this.controller = controller;
      this.owner = `preload|${++this.runs}`;
      const plan = this.plan;
      const end = () => {
        // Run to its end, stopped by the budget or failed: not again for this plan. An aborted run
        // starts again after the next settle.
        if (!controller.signal.aborted) this.done = plan;
        this.finished(controller);
      };
      this.run(workspace, controller.signal, this.owner).then(end, end);
    }, this.delayMs);
  }

  private finished(controller: AbortController): void {
    if (this.controller !== controller) return;
    // Stored tiles stay; the owner is let go so nothing of this run keeps a request alive.
    if (this.owner !== undefined) this.cache.release(this.owner);
    this.owner = undefined;
    this.controller = undefined;
  }

  /** The next entry, then the previous one: preview, then each window's tiles (K13). */
  private async run(workspace: Workspace, abort: AbortSignal, owner: string): Promise<void> {
    const c = workspace.case;
    if (!c) return;
    const neighbours = [c.current + 1, c.current - 1].filter((j) => j >= 0 && j < c.count);
    for (const index of neighbours) {
      if (abort.aborted) return;
      const preview = await this.preview(index, abort);
      if (abort.aborted) return;
      if (!(await this.tiles(workspace, preview, abort, owner))) return;
    }
  }

  /** Loads one neighbour's tiles run by run; false once the budget stops the preload. */
  private async tiles(
    workspace: Workspace,
    preview: CasePreview,
    abort: AbortSignal,
    owner: string,
  ): Promise<boolean> {
    const { scope } = preview;
    const target = { case: preview.index, scope };
    const ranges = caseRanges(workspace, preview.alignAt, scope);
    const fromRef = workspace.scope?.dataRef;
    for (const w of workspace.windows) {
      if (!isTimeseries(w)) continue;
      const range = ranges[w.id]?.range;
      if (!range) continue;
      const from = BigInt(range.from);
      const to = BigInt(range.to);
      const level = levelFor(from, to, this.targetOf(w.id) ?? DEFAULT_TARGET);
      const { first, last } = touchedTiles(from, to, level);
      if (!tileable(level, first, last)) continue;
      for (const s of w.signals) {
        const ref = parseSignalId(s.signalId)?.dataRef;
        const signalId = ref === fromRef ? rebindSignalId(s.signalId, scope.dataRef) : s.signalId;
        // A signal of another data ref answers out_of_scope there.
        if (parseSignalId(signalId)?.dataRef !== scope.dataRef) continue;
        const missing: bigint[] = [];
        for (let i = first; i <= last; i++) {
          if (!this.cache.storable(level, i)) continue;
          if (!this.cache.find(signalId, level, i, scope)) missing.push(i);
        }
        if (missing.length === 0) continue;
        if (this.spent + missing.length * this.tileEstimate > this.budget) return false;
        const loaded = await Promise.all(
          this.cache.load(owner, signalId, level, missing, "preload", target),
        ).catch(() => undefined);
        if (abort.aborted) return false;
        if (!loaded || loaded.length === 0) continue;
        const weight = loaded.reduce((sum, tile) => sum + tileWeight(tile), 0);
        this.spent += weight;
        this.tileEstimate = weight / loaded.length;
      }
    }
    return true;
  }
}
