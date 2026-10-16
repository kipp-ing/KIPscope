export interface FitInput {
  /** Inner width of the bar in px. */
  available: number;
  /** Width of `.conn`. */
  status: number;
  /** Width of the attribution group. */
  attribution: number;
  /** Px between two parts. */
  gap: number;
  /** Natural width of the message button, when shown. */
  message?: number;
  /** In display order. */
  items: { key: string; width: number; rank: number }[];
}

/** `shown` in display order; `wrap` when the attribution goes to a second line. */
export interface FitResult {
  shown: string[];
  wrap: boolean;
}

/**
 * Which items fit the bar's first line (design F5): the attribution wraps when it does not fit
 * beside the status alone; then items are removed lowest rank first until status, message, the
 * rest and (unwrapped) the attribution fit `available`. The message truncates by CSS after that.
 */
export function fitFooter(input: FitInput): FitResult {
  const { available, status, attribution, gap, message } = input;
  const wrap = status + gap + attribution > available;
  let width = status + (message !== undefined ? message + gap : 0) + (wrap ? 0 : gap + attribution);
  const shown = new Set(input.items.map((i) => i.key));
  for (const item of input.items) width += item.width + gap;
  // Stable: of equal ranks the later item hides first.
  const order = input.items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.rank - b.item.rank || b.index - a.index);
  for (const { item } of order) {
    if (width <= available) break;
    shown.delete(item.key);
    width -= item.width + gap;
  }
  return { shown: input.items.filter((i) => shown.has(i.key)).map((i) => i.key), wrap };
}
