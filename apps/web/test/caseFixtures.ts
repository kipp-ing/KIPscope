import {
  applyCommand,
  type CaseAlign,
  type CaseCatalog,
  type CaseEntry,
  type CasePreview,
  type Command,
  type CommandInput,
  caseScope,
  EMPTY_WORKSPACE,
  openCase,
  type Workspace,
} from "@kipscope/shared";

/**
 * Catalog C4 of add-case-open design "Test fixtures" (2026-10-01 UTC, pad 60 s), by hand:
 * 2026-10-01T00:00:00Z = 1790812800 s, so 01:00:00 = 1790816400 s and 04:50:00 = 1790830200 s.
 */
export const NS = 1_000_000_000n;
export const PAD = 60n * NS;
const BASE = 1790812800n;
/** Decimal ns of 2026-10-01 + h:m:s. */
export const at = (h: number, m: number, s = 0): string =>
  String((BASE + BigInt(h * 3600 + m * 60 + s)) * NS);

export const C4_ENTRIES: CaseEntry[] = [
  {
    id: "testcar|driving|2026-10-01T01:00:00Z",
    object: "testcar",
    dataRef: "testcar",
    kind: "driving",
    from: at(1, 0),
    to: at(1, 10),
    meta: { distance_km: 6.2 },
  },
  {
    id: "othercar|driving|2026-10-01T00:00:00Z",
    object: "othercar",
    dataRef: "othercar",
    kind: "driving",
    from: at(0, 0),
    to: at(0, 0, 1),
  },
  {
    id: "testcar|charging|2026-10-01T04:50:00Z",
    object: "testcar",
    dataRef: "testcar",
    kind: "charging",
    from: at(4, 50),
    to: at(5, 10),
    anchor: at(4, 55),
  },
  {
    id: "testcar|idle|2026-10-01T04:58:00Z",
    object: "testcar",
    dataRef: "testcar",
    kind: "idle",
    from: at(4, 58),
    to: at(5, 2),
  },
];

export const C4: CaseCatalog = { catalogId: "c4c4c4c4c4", entries: C4_ENTRIES };

export const entryAt = (index: number): CaseEntry => C4_ENTRIES[index] as CaseEntry;

const known = (id: string) => id.startsWith("testcar/") || id.startsWith("othercar/");

/** A workspace opened at entry `current` of C4 with the timeseries windows given as [from, to) and signals. */
export function caseWorkspace(
  options: {
    current?: number;
    align?: CaseAlign;
    alignAt?: string;
    windows?: { from: string; to: string; signals: string[] }[];
    catalog?: CaseCatalog;
    /** Windows keep their own ranges (no time link while the layout is built). */
    unlinkedTime?: boolean;
  } = {},
): Workspace {
  const catalog = options.catalog ?? C4;
  const current = options.current ?? 0;
  const align = options.align ?? { mode: "start" };
  const entry = catalog.entries[current] as CaseEntry;
  const alignAt = options.alignAt ?? entry.from;
  let layout: Workspace = EMPTY_WORKSPACE;
  const ctx = { signalExists: known, hasStates: () => false };
  if (options.unlinkedTime) {
    const result = applyCommand(layout, { type: "workspace.setLinkTime", linked: false }, ctx);
    if (result.ok) layout = result.workspace;
  }
  for (const w of options.windows ?? []) {
    const run = (input: CommandInput) => {
      const result = applyCommand(layout, input as Command, ctx);
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      layout = result.workspace;
      return result.created;
    };
    const id = run({ type: "window.create", from: w.from, to: w.to }) as string;
    for (const signalId of w.signals) run({ type: "window.addSignal", windowId: id, signalId });
  }
  const { workspace } = openCase({
    catalog,
    current,
    pad: PAD,
    align,
    alignAt,
    ...(layout.windows.length > 0 ? { layout, layoutAlignAt: alignAt } : {}),
    known,
  });
  return workspace;
}

/** What `GET /api/case/preview?index=N` answers for C4 with align start. */
export function previewOf(index: number, catalog: CaseCatalog = C4): CasePreview {
  const entry = catalog.entries[index] as CaseEntry;
  return { index, scope: caseScope(entry, PAD), alignAt: entry.from };
}
