import {
  type CommandInput,
  type CommandResult,
  formatLocal,
  parseSignalId,
  parseTime,
  type Workspace,
  windowsScope,
} from "@kipscope/shared";
import { type ChangeEvent, useState } from "react";
import "./help.css";

// "Set a scope" card (scope "Scope card", design B8 of speed-up-whole-scans): in scoped mode a
// workspace without a scope queries nothing until the user picks a data ref and a time window.

/** The card's three fields as typed. */
export interface ScopeFields {
  dataRef: string;
  from: string;
  to: string;
}

/** The data refs of the workspace's signals, first occurrence first: the data ref suggestions. */
export function scopeCardRefs(ws: Workspace): string[] {
  const refs = new Set<string>();
  for (const w of ws.windows) {
    for (const s of w.signals) {
      const ref = parseSignalId(s.signalId)?.dataRef;
      if (ref !== undefined) refs.add(ref);
    }
  }
  return [...refs];
}

/**
 * The prefilled fields: `windowsScope(ws, pad)` (the windows' ranges and cursors, padded) in local
 * time; the data ref of the first window's first signal; empty without one.
 */
export function scopeCardFields(ws: Workspace, pad: bigint): ScopeFields {
  const derived = windowsScope(ws, pad);
  const first = ws.windows.find((w) => w.signals.length > 0)?.signals[0];
  const dataRef = derived?.dataRef ?? (first && parseSignalId(first.signalId)?.dataRef) ?? "";
  return {
    dataRef,
    from: derived ? formatLocal(BigInt(derived.from)) : "",
    to: derived ? formatLocal(BigInt(derived.to)) : "",
  };
}

/** The fields as one `scope.set` (times as `kipscope` takes them, `parseTime`), or why not. */
export function scopeSetCommand(
  f: ScopeFields,
): { ok: true; command: CommandInput } | { ok: false; message: string } {
  const dataRef = f.dataRef.trim();
  if (dataRef === "") return { ok: false, message: "Data ref is empty" };
  try {
    const from = parseTime(f.from.trim());
    const to = parseTime(f.to.trim());
    if (to <= from) return { ok: false, message: "To lies before From" };
    return {
      ok: true,
      command: { type: "scope.set", dataRef, from: from.toString(), to: to.toString() },
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Sends the fields' `scope.set` with `send`; resolves to the message to show under the button
 * (a refusal's, or why the fields make no command), undefined when it was accepted.
 */
export async function submitScope(
  f: ScopeFields,
  send: (command: CommandInput) => Promise<CommandResult>,
): Promise<string | undefined> {
  const made = scopeSetCommand(f);
  if (!made.ok) return made.message;
  const result = await send(made.command);
  return result.ok ? undefined : result.message;
}

/**
 * The card above the Start card while the workspace has no scope in scoped mode (B8): Data ref
 * (suggesting the workspace's data refs), From and To prefilled from the windows, and **Set
 * scope**. A refusal shows its message under the button; the fields keep their text. App removes
 * the card once a scope is set.
 */
export function ScopeCard({
  workspace,
  pad,
  onCommand,
  hidden = false,
}: {
  workspace: Workspace;
  /** `KIPSCOPE_SCOPE_PAD` (meta `limits.scopePad`) in ns. */
  pad: bigint;
  onCommand: (command: CommandInput) => Promise<CommandResult>;
  /** During a drag: kept in place but hidden, as the Start card. */
  hidden?: boolean;
}) {
  const [fields, setFields] = useState<ScopeFields>(() => scopeCardFields(workspace, pad));
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const refs = scopeCardRefs(workspace);
  const field = (name: keyof ScopeFields) => ({
    value: fields[name],
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      setFields((f) => ({ ...f, [name]: e.target.value })),
  });
  const set = async () => {
    setBusy(true);
    try {
      setMessage(await submitScope(fields, onCommand));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className={hidden ? "start-card scope-card drag-hidden" : "start-card scope-card"}
      aria-label="Set a scope"
      aria-hidden={hidden || undefined}
      inert={hidden}
    >
      <div className="start-card-head">
        <h2>Set a scope</h2>
      </div>
      <form
        className="scope-card-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void set();
        }}
      >
        <label>
          Data ref
          <input {...field("dataRef")} list="scope-card-refs" spellCheck={false} />
        </label>
        <datalist id="scope-card-refs">
          {refs.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <label>
          From
          <input {...field("from")} spellCheck={false} />
        </label>
        <label>
          To
          <input {...field("to")} spellCheck={false} />
        </label>
        <button type="submit" disabled={busy}>
          Set scope
        </button>
      </form>
      {message !== undefined && (
        <p className="scope-card-message" role="alert">
          {message}
        </p>
      )}
      <p className="scope-card-line">
        Open a session from the search tool, or drop a catalog file here.
      </p>
      <p className="scope-card-line">
        CLI: kipscope scope set REF FROM TO · kipscope case drives REF FROM TO
      </p>
    </section>
  );
}
