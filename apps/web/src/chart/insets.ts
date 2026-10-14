/** Space left and right of a window's plot, in CSS px (axes, padding). */
export interface Insets {
  left: number;
  right: number;
}

/**
 * The widest natural inset per side over the given windows, so the same timestamp sits at the
 * same x in all of them. Windows without a reported inset are skipped; none gives 0 per side.
 */
export function mergeInsets(windowIds: string[], natural: ReadonlyMap<string, Insets>): Insets {
  let left = 0;
  let right = 0;
  for (const id of windowIds) {
    const n = natural.get(id);
    if (n) {
      left = Math.max(left, n.left);
      right = Math.max(right, n.right);
    }
  }
  return { left, right };
}
