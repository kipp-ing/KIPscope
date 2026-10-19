import type { WorkspaceScope } from "./workspace.ts";

/** Attribution of footer, CLI help and server log (design F1; text per LICENSE). */
export const ATTRIBUTION = {
  product: "KIPscope",
  year: 2026,
  author: "Jan Kipping",
  identification: "Agentic engineer",
  url: "https://kipp.ing",
  urlLabel: "kipp.ing",
  slogan: "efficient agentic engineering",
  license: { spdx: "AAL", name: "Attribution Assurance License", path: "/api/license" },
} as const;

/** "KIPscope © 2026 Jan Kipping, Agentic engineer, https://kipp.ing · Attribution Assurance License (AAL)" */
export function attributionText(): string {
  const a = ATTRIBUTION;
  return `${a.product} © ${a.year} ${a.author}, ${a.identification}, ${a.url} · ${a.license.name} (${a.license.spdx})`;
}

/** no_scope: scoped mode without a scope, so no signal list is loaded (design Z5). */
export type CatalogState = "loaded" | "loading" | "failed" | "no_scope";

/** Answer of `GET /api/meta` (design F2). */
export interface ServerMeta {
  build: { commit: string | null; dirty: boolean; startedAt: string };
  source: {
    /** `clickhouse`, `adx`, or another adapter's own word (data-source "Required source methods"). */
    kind: string;
    database: string;
    table: string;
    reachable: boolean;
    /** ISO, time the ping settled. */
    checkedAt: string;
    /** When not reachable. */
    error?: string;
  };
  catalog: {
    /** KIPSCOPE_CATALOG: full start-up catalog, or a signal list per scope only. */
    mode: "full" | "scoped";
    state: CatalogState;
    size: number;
    loadedAt?: string;
    reason?: string;
    /** The scope the state and size refer to; absent for the full catalog. */
    scope?: WorkspaceScope;
  };
}
