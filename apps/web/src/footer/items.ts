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
const RANK_BUILD = 1;
const RANK_ZONE = 2;
const RANK_CATALOG = 3;
const RANK_META = 4;
// Who the user acts as stays longer than build, zone and catalog (add-multiuser M12).
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

/**
 * Items `source`, `catalog`, `zone`, `build` in that order, then `user` unless the identity is
 * `none` (add-multiuser M12); [] when meta is undefined (design F3).
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

  const { source, catalog, build } = meta;
  const label = `${KIND_LABEL[source.kind] ?? source.kind} ${source.database}`;
  const checked = `checked ${localTime(source.checkedAt, now)}`;
  const sourceTitle = source.reachable
    ? `${label}.${source.table} · reachable · ${checked}`
    : `${label}.${source.table} · unreachable: ${source.error ?? "unknown error"} · ${checked}`;
  items.push({
    key: "source",
    text: source.reachable ? label : `${label} unreachable`,
    title: stale ? `last known; server not reachable · ${sourceTitle}` : sourceTitle,
    tone: stale ? "muted" : source.reachable ? "ok" : "error",
    rank: RANK_SOURCE,
  });

  if (catalog.state === "loaded") {
    items.push({
      key: "catalog",
      text: `${catalog.size} signals`,
      title: catalog.loadedAt
        ? `catalog loaded ${localTime(catalog.loadedAt, now)}`
        : "catalog loaded",
      tone: "plain",
      rank: RANK_CATALOG,
    });
  } else if (catalog.state === "no_scope") {
    // Scoped mode without a scope: no signal list is loaded (add-scope Z12).
    items.push({
      key: "catalog",
      text: "No scope",
      title: "scoped catalog: no scope set; open a view link or run kipscope scope set REF FROM TO",
      tone: "muted",
      rank: RANK_CATALOG,
    });
  } else {
    const loading = catalog.state === "loading";
    const text = loading ? "catalog loading" : "catalog unavailable";
    items.push({
      key: "catalog",
      text,
      title: catalog.reason ?? text,
      tone: loading ? "muted" : "error",
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

  if (build.commit !== null) {
    const started = new Date(build.startedAt);
    const startedText = Number.isNaN(started.getTime())
      ? build.startedAt
      : `${day(started)} ${clock(started)}`;
    items.push({
      key: "build",
      text: build.dirty ? `${build.commit}*` : build.commit,
      title: [
        `server commit ${build.commit}`,
        ...(build.dirty ? ["uncommitted changes at start"] : []),
        `started ${startedText}`,
      ].join(" · "),
      tone: "plain",
      rank: RANK_BUILD,
    });
  }

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
