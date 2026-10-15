let holds = 0;
const block = (e: Event) => e.preventDefault();

/**
 * Blocks text selection on the whole page while a drag runs (a cursor line, a legend row, the
 * height handle), so a pointer that leaves the dragged element selects nothing on its way.
 * Clears the current selection; returns the release, which is safe to call more than once.
 */
export function holdNoSelect(): () => void {
  window.getSelection()?.removeAllRanges();
  if (holds++ === 0) {
    document.documentElement.classList.add("no-select");
    document.addEventListener("selectstart", block, true);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--holds === 0) {
      document.documentElement.classList.remove("no-select");
      document.removeEventListener("selectstart", block, true);
    }
  };
}
