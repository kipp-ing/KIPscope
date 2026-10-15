import {
  type CommandInput,
  type CommandResult,
  type WorkspaceWindow,
  windowTitle,
} from "@letsview/shared";
import type React from "react";
import { useRef } from "react";

/** Header tooltip of the marked window (design L5). */
export const MARKED_HINT = "Adds from the explorer go here";

/** A header click marks the window unless it hit `.window-controls` (design L5). */
export function markFromHeader(
  e: React.MouseEvent,
  windowId: string,
  onMark: (windowId: string) => void,
): void {
  if (!(e.target as Element).closest(".window-controls")) onMark(windowId);
}

/**
 * Window title (design L4, L5). A single click bubbles to the header, which marks the window; a
 * double-click, or the menu's "Rename" via `editing`, turns it into a text field (Enter or blur
 * saves, Esc cancels).
 */
export function WindowTitle({
  window: w,
  editing,
  onEditing,
  onCommand,
}: {
  window: WorkspaceWindow;
  editing: boolean;
  onEditing: (editing: boolean) => void;
  onCommand: (command: CommandInput) => Promise<CommandResult>;
}) {
  const cancelled = useRef(false);
  const title = windowTitle(w);
  if (!editing) {
    return (
      <button
        type="button"
        className="window-title"
        title={`${title} · Double-click to rename`}
        onDoubleClick={() => {
          cancelled.current = false;
          onEditing(true);
        }}
      >
        {title}
      </button>
    );
  }
  // The field starts with the shown name, "Window <n>" when untitled. Saving it unchanged or empty
  // is a no-op, so an untitled window stays untitled.
  const save = (value: string) => {
    onEditing(false);
    if (cancelled.current) return;
    const next = value.trim();
    if (next && next !== title) onCommand({ type: "window.rename", windowId: w.id, title: next });
  };
  return (
    <input
      className="window-title-input"
      // biome-ignore lint/a11y/noAutofocus: the field appears on an explicit double-click or menu pick
      autoFocus
      defaultValue={title}
      maxLength={200}
      aria-label="Window title"
      onFocus={(e) => {
        cancelled.current = false;
        e.currentTarget.select();
      }}
      onBlur={(e) => save(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
