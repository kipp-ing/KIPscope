/**
 * The Markdown subset of the manual (add-guidance H8): `#`–`###` headings, paragraphs, `- ` and
 * `1. ` lists, `**bold**` and `` `code` ``. No HTML is produced; HelpPanel maps blocks to elements.
 */

export type Inline = { type: "text" | "bold" | "code"; text: string };
export type Block =
  | { type: "h1" | "h2" | "h3" | "p"; text: Inline[] }
  | { type: "ul" | "ol"; items: Inline[][] };

const HEADING = /^(#{1,3}) +(.*)$/;
const UL_ITEM = /^[-*] +(.*)$/;
const OL_ITEM = /^\d+\. +(.*)$/;
const INLINE = /\*\*(.+?)\*\*|`([^`]+)`/g;
/** Tables, quotes, images, HTML, fenced and indented code: outside the subset. */
const UNSUPPORTED = /^(\||>|!\[|<|```| {4}|\t)/;

/** Splits a line into text, bold and code runs; an unclosed marker stays text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const text = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last?.type === "text") last.text += t;
    else out.push({ type: "text", text: t });
  };
  let at = 0;
  for (const m of src.matchAll(INLINE)) {
    text(src.slice(at, m.index));
    if (m[1] !== undefined) out.push({ type: "bold", text: m[1] });
    else out.push({ type: "code", text: m[2] ?? "" });
    at = m.index + m[0].length;
  }
  text(src.slice(at));
  return out;
}

/**
 * Blocks of `src`. Lines of a paragraph join with a space; a line after a list item that starts no
 * new item continues it (as in CommonMark); a blank line ends either.
 */
export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | undefined;
  const flush = () => {
    if (para.length > 0) blocks.push({ type: "p", text: parseInline(para.join(" ")) });
    para = [];
    if (list) blocks.push({ type: list.type, items: list.items.map(parseInline) });
    list = undefined;
  };
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = heading[1]?.length;
      const type = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      blocks.push({ type, text: parseInline((heading[2] ?? "").trim()) });
      continue;
    }
    const ul = UL_ITEM.exec(line);
    const ol = ul ? null : OL_ITEM.exec(line);
    const item = ul ?? ol;
    if (item) {
      const type = ul ? "ul" : "ol";
      if (list?.type !== type) flush();
      list ??= { type, items: [] };
      list.items.push((item[1] ?? "").trim());
      continue;
    }
    if (list) {
      const last = list.items.length - 1;
      list.items[last] = `${list.items[last]} ${line}`;
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

/** 1-based numbers of the lines outside the subset. */
export function unsupportedLines(src: string): number[] {
  const out: number[] = [];
  src.split(/\r?\n/).forEach((line, i) => {
    if (UNSUPPORTED.test(line)) out.push(i + 1);
  });
  return out;
}

/** Plain text of inline runs, e.g. for a heading's id. */
export function inlineText(text: Inline[]): string {
  return text.map((t) => t.text).join("");
}
