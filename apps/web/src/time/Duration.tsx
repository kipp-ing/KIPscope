import { HINTS } from "../help/hints.ts";

/**
 * A duration in a slot (add-range-picker R6, D-093): the stopwatch, then `text` ("0:12", "41 s",
 * "902 ms"); its tooltip says the format. Styles in bar/bar.css (`.duration-tag`).
 */
export function DurationTag({ text }: { text: string }) {
  return (
    <span className="duration-tag" title={HINTS.duration}>
      <svg
        className="duration-icon"
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="14" r="8" />
        <line x1="12" y1="14" x2="12" y2="10" />
        <line x1="10" y1="2" x2="14" y2="2" />
      </svg>
      {text}
    </span>
  );
}
