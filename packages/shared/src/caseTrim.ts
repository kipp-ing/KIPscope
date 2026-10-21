/** What trimCases needs of a catalog; unknown keys pass through unchanged. */
export interface TrimmableCases {
  cases: readonly unknown[];
  /** Default 0. */
  current?: number;
}

export type TrimResult<D> =
  | {
      ok: true;
      /** The input object itself when nothing was dropped; else {...doc, cases: slice, current}. */
      doc: D;
      /** encode(doc): the text whose length was measured (the link, or what a signer gave). */
      text: string;
      dropped: { before: number; after: number };
    }
  | { ok: false; code: "link_too_long" /** Length with current alone. */; chars: number };

/**
 * Sessions dropped before and after `current` after k drops (design X1): the far end of the longer
 * side goes first, the side before on a tie.
 */
function dropsOf(before: number, after: number, k: number): { before: number; after: number } {
  const first = Math.min(k, Math.abs(before - after));
  const rest = k - first;
  const tie = { before: Math.ceil(rest / 2), after: Math.floor(rest / 2) };
  return before >= after
    ? { before: first + tie.before, after: tie.after }
    : { before: tie.before, after: first + tie.after };
}

/**
 * Balanced trim (case-handoff "Balanced trim"). Pure apart from `encode`. Throws RangeError when
 * `cases` is empty or `current` is not an integer in [0, cases.length).
 */
export async function trimCases<D extends TrimmableCases>(
  doc: D,
  options: { maxChars: number; encode: (doc: D) => string | Promise<string> },
): Promise<TrimResult<D>> {
  const n = doc.cases.length;
  const current = doc.current ?? 0;
  if (n === 0) throw new RangeError("trimCases: cases is empty");
  if (!Number.isInteger(current) || current < 0 || current >= n) {
    throw new RangeError(`trimCases: current ${current} is not an index into ${n} cases`);
  }
  const { maxChars, encode } = options;
  const windowOf = (k: number) => {
    const dropped = dropsOf(current, n - 1 - current, k);
    const trimmed = {
      ...doc,
      cases: doc.cases.slice(dropped.before, n - dropped.after),
      current: current - dropped.before,
    } as D;
    return { doc: trimmed, dropped };
  };

  const whole = await encode(doc);
  if (whole.length <= maxChars) {
    return { ok: true, doc, text: whole, dropped: { before: 0, after: 0 } };
  }
  // Bisect k in (lo, hi]: lo drops do not fit, hi drops fit with `best`.
  let lo = 0;
  let hi = n - 1;
  let best = windowOf(hi);
  let bestText = n === 1 ? whole : await encode(best.doc);
  if (bestText.length > maxChars)
    return { ok: false, code: "link_too_long", chars: bestText.length };
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const window = windowOf(mid);
    const text = await encode(window.doc);
    if (text.length <= maxChars) {
      hi = mid;
      best = window;
      bestText = text;
    } else {
      lo = mid;
    }
  }
  return { ok: true, doc: best.doc, text: bestText, dropped: best.dropped };
}
