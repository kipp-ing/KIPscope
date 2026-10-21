import type { Me, Measurement, ServerMeta } from "@kipscope/shared";

export type Tone = "plain" | "ok" | "error" | "muted";

/** One item of the footer; `rank` decides which hides first when the line lacks space (design F5). */
export interface FooterItem {
  key: string;
  text: string;
  title: string;
  tone: Tone;
  rank: number;
}

/** Most characters a measurement item shows, the trailing "…" included (design F3). */
export const MEASUREMENT_CLIP = 40;

// Ranks of design F3: lower hides first.
const RANK_ZONE = 2;
const RANK_CATALOG = 3;
const RANK_META = 4;
// Who the user acts as stays longer than zone and catalog (add-multiuser M12).
const RANK_USER = 19;
const RANK_SOURCE = 20;
const RANK_OBJECT = 21;
const RANK_NAME = 22;

/** Labels of the known source kinds; any other kind shows as given (design C10). */
const KIND_LABEL: Record<string, string> = { clickhouse: "ClickHouse", adx: "ADX" };

function clip(text: string): string {
  const chars = Array.from(text);
  return chars.length <= MEASUREMENT_CLIP
    ? text
    : `${chars.slice(0, MEASUREMENT_CLIP - 1).join("")}…`;
}

/**
 * Items `m:name`, `m:object`, `m:meta:<key>` in that order, texts clipped to 40 characters with "…";
 * `title` of the group: "Measurement: …\nObject: …\n<key>: <value>…" (lines of absent fields left out).
 */
export function measurementItems(m: Measurement | undefined): {
  items: FooterItem[];
  title: string;
} {
  if (!m) return { items: [], title: "" };
  const meta = m.meta ?? [];
  const lines = [
    ...(m.name ? [`Measurement: ${m.name}`] : []),
    ...(m.object ? [`Object: ${m.object}`] : []),
    ...meta.map((e) => `${e.key}: ${e.value}`),
  ];
  const title = lines.join("\n");
  const item = (key: string, text: string, rank: number): FooterItem => ({
    key,
    text: clip(text),
    title,
    tone: "plain",
    rank,
  });
  const items = [
    ...(m.name ? [item("m:name", m.name, RANK_NAME)] : []),
    ...(m.object ? [item("m:object", m.object, RANK_OBJECT)] : []),
    // The last entry hides first.
    ...meta.map((e, i) =>
      item(`m:meta:${e.key}`, `${e.key}: ${e.value}`, RANK_META + (meta.length - 1 - i)),
    ),
  ];
  return { items, title };
}

const pad = (n: number) => String(n).padStart(2, "0");

const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local clock time of an ISO instant; with the date when it is not on the day of `now`. */
function localTime(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return day(d) === day(now) ? clock(d) : `${day(d)} ${clock(d)}`;
}

function utcOffset(minutes: number): string {
  const abs = Math.abs(minutes);
  return `UTC${minutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const sourceLabel = (source: ServerMeta["source"]) =>
  `${KIND_LABEL[source.kind] ?? source.kind} ${source.database}`;

function sourceTitle(source: ServerMeta["source"], now: Date): string {
  const label = sourceLabel(source);
  const checked = `checked ${localTime(source.checkedAt, now)}`;
  return source.reachable
    ? `${label}.${source.table} · reachable · ${checked}`
    : `${label}.${source.table} · unreachable: ${source.error ?? "unknown error"} · ${checked}`;
}

const NO_SCOPE_TITLE =
  "scoped catalog: no scope set; open a view link or run kipscope scope set REF FROM TO";

const catalogText = (catalog: ServerMeta["catalog"]) =>
  catalog.state === "loading" ? "catalog loading" : "catalog unavailable";

function catalogTitle(catalog: ServerMeta["catalog"], now: Date): string {
  if (catalog.state === "loaded")
    return catalog.loadedAt
      ? `catalog loaded ${localTime(catalog.loadedAt, now)}`
      : "catalog loaded";
  if (catalog.state === "no_scope") return NO_SCOPE_TITLE;
  return catalog.reason ?? catalogText(catalog);
}

/** Build details; undefined without a commit. */
function buildTitle(build: ServerMeta["build"]): string | undefined {
  if (build.commit === null) return undefined;
  const started = new Date(build.startedAt);
  const startedText = Number.isNaN(started.getTime())
    ? build.startedAt
    : `${day(started)} ${clock(started)}`;
  return [
    `server commit ${build.commit}`,
    ...(build.dirty ? ["uncommitted changes at start"] : []),
    `started ${startedText}`,
  ].join(" · ");
}

/**
 * Lines of the status tooltip (app-footer "Status tooltip", design DW9), joined by "\n": first
 * `revision <n> · <source> · <count> signals · server <commit>`, prefixed when the last meta fetch
 * failed; then the source, catalog and build details. `revision <n>` alone before the first answer.
 */
export function statusTooltip(
  revision: number,
  meta: ServerMeta | undefined,
  stale: boolean,
  now: Date = new Date(),
): string {
  if (!meta) return `revision ${revision}`;
  const { source, catalog, build } = meta;
  const count =
    catalog.state === "loaded"
      ? `${catalog.size} signals`
      : catalog.state === "no_scope"
        ? "No scope"
        : catalogText(catalog);
  const head = [
    `revision ${revision}`,
    sourceLabel(source),
    count,
    ...(build.commit !== null ? [`server ${build.commit}${build.dirty ? "*" : ""}`] : []),
  ].join(" · ");
  const details = buildTitle(build);
  return [
    stale ? `last known; server not reachable · ${head}` : head,
    sourceTitle(source, now),
    catalogTitle(catalog, now),
    ...(details ? [details] : []),
  ].join("\n");
}

/**
 * Items `source` (only while unreachable), `catalog` (only failed or without a scope), `zone`, then
 * `user` unless the identity is `none` (add-multiuser M12); [] when meta is undefined. Revision,
 * a reachable source, the signal count and the build live in `statusTooltip` (design DW9).
 */
export function footerItems(
  meta: ServerMeta | undefined,
  stale: boolean,
  zone: { name: string; offsetMinutes: number },
  now: Date = new Date(),
  me?: Me,
): FooterItem[] {
  if (!meta) return [];
  const items: FooterItem[] = [];

  const { source, catalog } = meta;
  if (!source.reachable) {
    const title = sourceTitle(source, now);
    items.push({
      key: "source",
      text: `${sourceLabel(source)} unreachable`,
      title: stale ? `last known; server not reachable · ${title}` : title,
      tone: stale ? "muted" : "error",
      rank: RANK_SOURCE,
    });
  }

  if (catalog.state === "failed") {
    items.push({
      key: "catalog",
      text: catalogText(catalog),
      title: catalogTitle(catalog, now),
      tone: "error",
      rank: RANK_CATALOG,
    });
  } else if (catalog.state === "no_scope") {
    // Scoped mode without a scope: no signal list is loaded (add-scope Z12).
    items.push({
      key: "catalog",
      text: "No scope",
      title: NO_SCOPE_TITLE,
      tone: "muted",
      rank: RANK_CATALOG,
    });
  }

  items.push({
    key: "zone",
    text: zone.name,
    title: `display time zone · ${utcOffset(zone.offsetMinutes)}`,
    tone: "plain",
    rank: RANK_ZONE,
  });

  const user = userItem(me);
  if (user) items.push(user);
  return items;
}

/**
 * Who the user acts as (add-multiuser M12): text the user, title "Signed in as <user> (<identity>)
 * · roles: <roles>"; undefined without `me` or with the identity `none`. The footer and the gate
 * pages show it.
 */
export function userItem(me: Me | undefined): FooterItem | undefined {
  if (!me || me.identity === "none") return undefined;
  const roles = me.roles.length > 0 ? me.roles.join(", ") : "none";
  return {
    key: "user",
    text: me.user,
    title: `Signed in as ${me.user} (${me.identity}) · roles: ${roles}`,
    tone: "plain",
    rank: RANK_USER,
  };
}

/** The browser's time zone (`Intl` `resolvedOptions().timeZone`) and its UTC offset at `date`. */
export function browserZone(date: Date = new Date()): { name: string; offsetMinutes: number } {
  const offsetMinutes = -date.getTimezoneOffset();
  return {
    name: Intl.DateTimeFormat().resolvedOptions().timeZone || utcOffset(offsetMinutes),
    // getTimezoneOffset gives -0 for UTC.
    offsetMinutes: offsetMinutes === 0 ? 0 : offsetMinutes,
  };
}
