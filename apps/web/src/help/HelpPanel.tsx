import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import manualText from "../../../../docs/manual.md?raw";
import { isTextField } from "../keys.ts";
import { type Block, type Inline, inlineText, parseMarkdown } from "./markdown.ts";
import { SHORTCUT_GROUPS, SHORTCUTS } from "./shortcuts.ts";
import "./help.css";

export type HelpTab = "manual" | "keys";

/** Pairs each item with a stable key; the manual and the shortcut table never change at runtime. */
function keyed<T>(items: T[], prefix: string): { key: string; item: T }[] {
  const out: { key: string; item: T }[] = [];
  for (const item of items) out.push({ key: `${prefix}${out.length}`, item });
  return out;
}

/** Id of a manual section heading, prefixed so it never clashes with an app id (e.g. `go-to`). */
export function sectionId(text: string): string {
  return `help-${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

const MANUAL = keyed(parseMarkdown(manualText), "b");
const SECTIONS = MANUAL.filter(({ item }) => item.type === "h2").map(({ item }) => {
  const text = inlineText((item as { text: Inline[] }).text);
  return { id: sectionId(text), text };
});

/** Inline code of at most 12 characters and no space is a key or gesture: a key cap. */
function renderInline(text: Inline[]): ReactNode[] {
  return keyed(text, "i").map(({ key, item }) => {
    if (item.type === "bold") return <strong key={key}>{item.text}</strong>;
    if (item.type === "code") {
      return item.text.length <= 12 && !item.text.includes(" ") ? (
        <kbd key={key}>{item.text}</kbd>
      ) : (
        <code key={key}>{item.text}</code>
      );
    }
    return item.text;
  });
}

function renderBlock(block: Block, key: string): ReactNode {
  switch (block.type) {
    case "h1":
      return <h1 key={key}>{renderInline(block.text)}</h1>;
    case "h2":
      return (
        <h2 key={key} id={sectionId(inlineText(block.text))}>
          {renderInline(block.text)}
        </h2>
      );
    case "h3":
      return <h3 key={key}>{renderInline(block.text)}</h3>;
    case "p":
      return <p key={key}>{renderInline(block.text)}</p>;
    case "ul":
    case "ol": {
      const items = keyed(block.items, "l").map(({ key: k, item }) => (
        <li key={k}>{renderInline(item)}</li>
      ));
      return block.type === "ul" ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>;
    }
  }
}

/** Each alternative of a shortcut's keys (two spaces apart) as a key cap. */
function KeyCaps({ keys }: { keys: string }) {
  return (
    <span className="help-keys">
      {keyed(keys.split(/ {2,}/), "k").map(({ key, item }) => (
        <kbd key={key}>{item}</kbd>
      ))}
    </span>
  );
}

const KEY_GROUPS = SHORTCUT_GROUPS.map((group) => ({
  group,
  rows: keyed(
    SHORTCUTS.filter((s) => s.group === group),
    `${group}-`,
  ),
}));

/**
 * Help panel (add-guidance H7): non-modal, fixed at the right between the top row and the status
 * strip, with the tabs Manual and Keys. Esc closes it while the focus is inside, or when no text
 * field has focus and no drag runs (a drag's own Esc stops or marks the event first).
 */
export function HelpPanel({
  tab,
  onTab,
  onClose,
  onShowStart,
}: {
  tab: HelpTab;
  onTab(t: HelpTab): void;
  onClose(): void;
  onShowStart(): void;
}) {
  const root = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; bottom: number } | undefined>();

  // Between the sticky top area's bottom and the status strip's top, re-measured as they change.
  useLayoutEffect(() => {
    const top = document.querySelector(".top-area");
    const strip = document.querySelector(".status-strip");
    const measure = () => {
      const next = {
        top: Math.max(0, Math.round(top?.getBoundingClientRect().bottom ?? 0)),
        bottom: Math.max(
          0,
          Math.round(
            window.innerHeight - (strip?.getBoundingClientRect().top ?? window.innerHeight),
          ),
        ),
      };
      setBox((b) => (b && b.top === next.top && b.bottom === next.bottom ? b : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const el of [top, strip]) if (el) observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector(".app.dragging")) return;
      const focused = document.activeElement;
      const inside = !!focused && !!root.current?.contains(focused);
      if (!inside && isTextField(focused)) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const jump = (id: string) => {
    const el = document.getElementById(id);
    const scroller = body.current;
    if (!el || !scroller) return;
    scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  };

  return (
    <aside ref={root} className="help-panel" aria-label="Help" style={box}>
      <div className="help-head">
        <h2>Help</h2>
        <div className="help-tabs" role="tablist" aria-label="Help">
          {(["manual", "keys"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => onTab(t)}
            >
              {t === "manual" ? "Manual" : "Keys"}
            </button>
          ))}
        </div>
        <button type="button" className="help-close" aria-label="Close help" onClick={onClose}>
          ×
        </button>
      </div>
      <div ref={body} className="help-body" key={tab}>
        {tab === "manual" ? (
          <>
            <nav className="help-sections" aria-label="Manual sections">
              <ol>
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="link" onClick={() => jump(s.id)}>
                      {s.text}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
            <article className="help-manual">
              {MANUAL.map(({ key, item }) => renderBlock(item, key))}
            </article>
            <button type="button" className="help-start-again" onClick={onShowStart}>
              Show the start card again
            </button>
          </>
        ) : (
          <div className="help-shortcuts">
            {KEY_GROUPS.map(({ group, rows }) => (
              <section key={group}>
                <h3>{group}</h3>
                <dl>
                  {rows.map(({ key, item }) => (
                    <div key={key} className="help-shortcut">
                      <dt>
                        <KeyCaps keys={item.keys} />
                      </dt>
                      <dd>{item.action}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
