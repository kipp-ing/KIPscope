/**
 * Ignores files dragged onto the page (design H8): without this a dropped file navigates the tab
 * away. Signal drags are pointer-based, not HTML drag and drop, so they pass. Returns the remover.
 */
export function ignoreFileDrops(target: EventTarget): () => void {
  const onDrag = (event: Event) => {
    const transfer = (event as DragEvent).dataTransfer;
    if (!transfer || !Array.from(transfer.types).includes("Files")) return;
    event.preventDefault();
    if (event.type === "dragover") transfer.dropEffect = "none";
  };
  target.addEventListener("dragover", onDrag);
  target.addEventListener("drop", onDrag);
  return () => {
    target.removeEventListener("dragover", onDrag);
    target.removeEventListener("drop", onDrag);
  };
}
