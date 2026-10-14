/** A signal in the catalog. Optional fields are absent (not empty) when the metadata is unknown. */
export interface SignalInfo {
  /** Stable ID: `<dataRef>/<name>`, e.g. `smart451/MS_312h.DNMOT`. */
  id: string;
  /** Data reference the signal belongs to (for vehicle data: the vehicle). */
  dataRef: string;
  /** Name as stored in the source. */
  name: string;
  description?: string;
  alias?: string;
  unit?: string;
}

export interface SignalPage {
  items: SignalInfo[];
  /** Number of all matches, of which `items` is one page. */
  total: number;
  /** True when matches exist beyond this page. */
  more: boolean;
}

export function signalId(dataRef: string, name: string): string {
  return `${dataRef}/${name}`;
}

/** Splits at the first `/`; data references never contain one, signal names may. */
export function parseSignalId(id: string): { dataRef: string; name: string } | undefined {
  const slash = id.indexOf("/");
  if (slash <= 0 || slash === id.length - 1) return undefined;
  return { dataRef: id.slice(0, slash), name: id.slice(slash + 1) };
}
