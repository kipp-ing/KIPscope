import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { DiagInfo, DiagScaleRow } from "@kipscope/shared";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";

/** Metadata for one signal name from a diagnostic catalog (design M3). */
export interface DiagSignal {
  unit?: string;
  diag: DiagInfo;
}

/** Manifest shape of design M3; only the keys read here are checked, the rest passes through. */
const ScaleSchema = z.looseObject({
  low: z.number(),
  high: z.number(),
  text: z.string().optional(),
  invalid: z.boolean().optional(),
});
const FieldSchema = z.looseObject({
  name: z.string(),
  unit: z.string().optional(),
  enum: z.boolean().optional(),
  ascii: z.boolean().optional(),
  hexdump: z.boolean().optional(),
  element_count: z.number().optional(),
  scales: z.array(ScaleSchema).optional(),
});
const ManifestSchema = z.looseObject({
  format: z.literal("uds-catalog-manifest/1"),
  ecu: z.looseObject({ name: z.string().min(1) }),
  groups: z.array(
    z.looseObject({
      name: z.string(),
      did: z.number(),
      services: z.array(z.string()).optional(),
      fields: z.array(FieldSchema),
    }),
  ),
});

type Group = z.infer<typeof ManifestSchema>["groups"][number];
type Field = z.infer<typeof FieldSchema>;
type Scale = z.infer<typeof ScaleSchema>;

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const DID = /^0[xX][0-9A-Fa-f]{1,4}$/;
const MANIFEST_SUFFIX = /\.manifest\.json$/;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Names file next to a manifest (design M2): `.manifest.json` → `.names.toml`, else appended. */
function namesPathOf(manifestPath: string): string {
  return MANIFEST_SUFFIX.test(manifestPath)
    ? manifestPath.replace(MANIFEST_SUFFIX, ".names.toml")
    : `${manifestPath}.names.toml`;
}

/** Resolves a names key to its field (decoder `_resolve_field`); a string is the problem. */
function resolveField(key: string, groups: readonly Group[]): Field | string {
  const slash = key.lastIndexOf("/");
  if (slash >= 0) {
    const service = key.slice(0, slash);
    const fieldName = key.slice(slash + 1);
    const group = DID.test(service)
      ? groups.find((g) => g.did === Number.parseInt(service.slice(2), 16))
      : groups.find((g) => g.name === service || g.services?.includes(service));
    if (!group) return "no group";
    return group.fields.find((f) => f.name === fieldName) ?? `no such field in ${group.name}`;
  }
  const matches = groups.flatMap((g) =>
    g.fields.filter((f) => f.name === key).map((field) => ({ group: g, field })),
  );
  const [first, ...more] = matches;
  if (!first) return "no such field";
  if (more.length > 0) {
    const names = matches.map((m) => m.group.name).join(", ");
    return `ambiguous, write <service>/<field> (groups: ${names})`;
  }
  return first.field;
}

/** The `[fields]` entries of a names file in file order; none when it is absent or does not parse. */
function namesEntries(
  namesText: string | undefined,
  namesPath: string,
  warn: (message: string) => void,
): [string, unknown][] {
  if (namesText === undefined) return [];
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(namesText);
  } catch (error) {
    warn(`${namesPath}: ${messageOf(error)}; fields keep their catalog names`);
    return [];
  }
  const fields = parsed.fields;
  if (fields === undefined) return [];
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    warn(`${namesPath}: [fields] is not a table; fields keep their catalog names`);
    return [];
  }
  return Object.entries(fields);
}

const rows = (scales: readonly Scale[]): DiagScaleRow[] | undefined =>
  scales.length > 0
    ? scales.map((s) => ({ low: s.low, high: s.high, text: s.text ?? "" }))
    : undefined;

/** One manifest with its names file text (undefined: no names file). Problems go to `warn`. */
export function parseDiagCatalog(
  manifestText: string,
  namesText: string | undefined,
  file: string,
  warn: (message: string) => void,
  namesPath: string = namesPathOf(file),
): Map<string, DiagSignal> {
  const checked = ManifestSchema.safeParse(JSON.parse(manifestText));
  if (!checked.success) {
    const issue = checked.error.issues[0];
    const where = issue?.path.join(".") || "(root)";
    throw new Error(`not a manifest: ${where}: ${issue?.message ?? "invalid"}`);
  }
  const { ecu, groups } = checked.data;

  const named = new Map<Field, string>();
  const given = new Set<string>();
  for (const [key, value] of namesEntries(namesText, namesPath, warn)) {
    const ignore = (problem: string) => warn(`${namesPath}: ${key}: ${problem}; entry ignored`);
    if (typeof value !== "string" || !NAME.test(value)) {
      ignore("not a name");
      continue;
    }
    const field = resolveField(key, groups);
    if (typeof field === "string") ignore(field);
    else if (given.has(value)) ignore("name already given");
    else if (named.has(field)) ignore("field already named");
    else {
      named.set(field, value);
      given.add(value);
    }
  }

  const result = new Map<string, DiagSignal>();
  const add = (name: string, signal: DiagSignal) => {
    if (result.has(name)) warn(`two fields end up as signal ${name}`);
    else result.set(name, signal);
  };
  for (const group of groups) {
    for (const field of group.fields) {
      const name = named.get(field);
      const base = name ? `${ecu.name}.${name}` : `${ecu.name}.${group.name}.${field.name}`;
      const scales = field.scales ?? [];
      const unit = field.unit?.trim() || undefined;
      const info: DiagInfo = {
        file,
        ecu: ecu.name,
        group: group.name,
        did: group.did,
        field: field.name,
        kind: field.enum ? "enum" : field.ascii || field.hexdump ? "text" : "number",
      };
      const states = field.enum
        ? rows(scales.filter((s) => !s.invalid && s.text?.trim()))
        : undefined;
      const invalid = rows(scales.filter((s) => s.invalid));
      if (states) info.states = states;
      if (invalid) info.invalid = invalid;
      const signal = (diag: DiagInfo): DiagSignal => (unit ? { unit, diag } : { diag });

      const count = field.element_count ?? 1;
      if (count > 1) {
        const width = String(count).length;
        for (let n = 1; n <= count; n++) {
          const diag: DiagInfo = { ...info, element: n };
          add(`${base}.${String(n).padStart(width, "0")}`, signal(diag));
        }
      } else {
        add(base, signal(info));
      }
    }
  }
  return result;
}

/** Reads the manifests in order; never rejects. First catalog wins per name (M5). */
export async function loadDiagCatalogs(
  paths: readonly string[],
  warn: (message: string) => void,
): Promise<Map<string, DiagSignal>> {
  const merged = new Map<string, DiagSignal>();
  for (const path of paths) {
    let manifestText: string;
    try {
      manifestText = await readFile(path, "utf8");
    } catch (error) {
      warn(`${path} skipped: ${messageOf(error)}`);
      continue;
    }
    // Held back until the manifest parses: a skipped manifest gets one warning, not two.
    const pending: string[] = [];
    const namesPath = namesPathOf(path);
    let namesText: string | undefined;
    try {
      namesText = await readFile(namesPath, "utf8");
    } catch (error) {
      pending.push(`${namesPath}: ${messageOf(error)}; fields keep their catalog names`);
    }
    let parsed: Map<string, DiagSignal>;
    try {
      parsed = parseDiagCatalog(
        manifestText,
        namesText,
        basename(path),
        (m) => pending.push(m),
        namesPath,
      );
    } catch (error) {
      warn(`${path} skipped: ${messageOf(error)}`);
      continue;
    }
    for (const message of pending) warn(message);
    const taken: string[] = [];
    for (const [name, signal] of parsed) {
      if (merged.has(name)) taken.push(name);
      else merged.set(name, signal);
    }
    if (taken.length > 0) {
      warn(
        `${path}: ${taken.length} signals already named by an earlier catalog, the earlier wins: ${taken.slice(0, 10).join(", ")}`,
      );
    }
  }
  return merged;
}
