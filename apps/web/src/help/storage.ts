/**
 * Per-browser help state (add-guidance H7): the start card's dismissal and the learned next-step
 * hints. Every storage access goes through try/catch; when storage is missing or blocked, the
 * state lives for this page only.
 */

export const START_CARD_KEY = "kipscope.startCard";
export const LEARNED_KEY = "kipscope.learned";

export type Learned = "b" | "diff";

/** The page's own copy: set by every write, so a blocked storage still remembers within the page. */
let dismissed: boolean | undefined;
const learned = new Set<Learned>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

export function startDismissed(): boolean {
  if (dismissed !== undefined) return dismissed;
  try {
    return storage()?.getItem(START_CARD_KEY) === "dismissed";
  } catch {
    return false;
  }
}

export function dismissStart(): void {
  dismissed = true;
  try {
    storage()?.setItem(START_CARD_KEY, "dismissed");
  } catch {
    // Blocked or full: dismissed for this page only.
  }
}

export function showStartAgain(): void {
  dismissed = false;
  try {
    storage()?.removeItem(START_CARD_KEY);
  } catch {
    // Blocked: shown again for this page only.
  }
}

/** The stored array; an unreadable or malformed entry counts as empty. */
function storedLearned(): Learned[] {
  try {
    const raw = storage()?.getItem(LEARNED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((l): l is Learned => l === "b" || l === "diff")
      : [];
  } catch {
    return [];
  }
}

export function hasLearned(l: Learned): boolean {
  return learned.has(l) || storedLearned().includes(l);
}

export function learn(l: Learned): void {
  learned.add(l);
  try {
    const all = new Set([...storedLearned(), ...learned]);
    storage()?.setItem(LEARNED_KEY, JSON.stringify([...all]));
  } catch {
    // Blocked or full: learned for this page only.
  }
}
