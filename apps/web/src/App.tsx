import type { CommandInput, CommandResult, RenderError, SignalInfo } from "@letsview/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchExtent, sendCommand, signalInfo } from "./api.ts";
import { TimeseriesWindow } from "./chart/TimeseriesWindow.tsx";
import { useLive } from "./live.ts";
import { NEW_WINDOW, SignalExplorer } from "./SignalExplorer.tsx";

export function App() {
  const [live, send] = useLive();
  const [message, setMessage] = useState<string | undefined>();

  // Signal metadata seen in the explorer or looked up for signals already in the workspace.
  const infos = useRef(new Map<string, SignalInfo>());
  const [, setInfoVersion] = useState(0);
  const remember = useCallback((signals: SignalInfo[]) => {
    let added = false;
    for (const s of signals) {
      if (!infos.current.has(s.id)) {
        infos.current.set(s.id, s);
        added = true;
      }
    }
    if (added) setInfoVersion((v) => v + 1);
  }, []);
  const info = useCallback((id: string) => infos.current.get(id), []);

  const windows = live.workspace?.windows ?? [];
  const signalIds = [...new Set(windows.flatMap((w) => w.signals.map((s) => s.signalId)))];
  const missingKey = signalIds.filter((id) => !infos.current.has(id)).join(",");
  useEffect(() => {
    for (const id of missingKey ? missingKey.split(",") : []) {
      signalInfo(id).then((s) => s && remember([s]));
    }
  }, [missingKey, remember]);

  const command = useCallback(async (input: CommandInput): Promise<CommandResult> => {
    const result = await sendCommand(input);
    setMessage(result.ok ? undefined : `${result.code}: ${result.message}`);
    return result;
  }, []);

  const addSignal = async (signal: SignalInfo, target: string) => {
    let windowId = target;
    if (target === NEW_WINDOW) {
      try {
        const extent = await fetchExtent(signal.id);
        const created = await command({
          type: "window.create",
          title: signal.name,
          from: extent.first,
          // Half-open range: end just after the last point, rounded up to the next millisecond.
          to: ((BigInt(extent.last) / 1_000_000n + 1n) * 1_000_000n).toString(),
        });
        if (!created.ok || !created.created) return;
        windowId = created.created;
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    await command({ type: "window.addSignal", windowId, signalId: signal.id });
  };

  // Render acknowledgement: a revision counts as rendered once every window reported it.
  const ready = useRef(new Map<string, { revision: number; errors: RenderError[] }>());
  const lastSent = useRef(-1);
  const liveRef = useRef(live);
  liveRef.current = live;
  const acknowledge = useCallback(() => {
    const { revision, workspace } = liveRef.current;
    if (!workspace || revision === lastSent.current) return;
    const reports = workspace.windows.map((w) => ready.current.get(w.id));
    if (reports.some((r) => r?.revision !== revision)) return;
    const errors = reports.flatMap((r) => r?.errors ?? []);
    lastSent.current = revision;
    send({ type: "rendered", revision, status: errors.length ? "error" : "complete", errors });
  }, [send]);
  const onReady = useCallback(
    (windowId: string, revision: number, errors: RenderError[]) => {
      ready.current.set(windowId, { revision, errors });
      acknowledge();
    },
    [acknowledge],
  );
  useEffect(() => {
    if (live.revision >= 0) acknowledge();
  }, [live.revision, acknowledge]);
  useEffect(() => {
    if (!live.connected) lastSent.current = -1;
  }, [live.connected]);

  return (
    <div className="app">
      <SignalExplorer windows={windows} onAdd={addSignal} onSeen={remember} />
      <main>
        <header className="topbar">
          <h1>letsview</h1>
          <span className={`conn ${live.connected ? "ok" : "down"}`}>
            {live.connected ? `connected · revision ${live.revision}` : "disconnected"}
          </span>
          {message && (
            <button type="button" className="message" onClick={() => setMessage(undefined)}>
              {message} ✕
            </button>
          )}
        </header>
        {windows.map((w) => (
          <TimeseriesWindow
            key={w.id}
            window={w}
            revision={live.revision}
            info={info}
            onCommand={command}
            onReady={onReady}
          />
        ))}
        {live.workspace && windows.length === 0 && (
          <p className="hint">No windows yet. Search a signal and add it to a new window.</p>
        )}
      </main>
    </div>
  );
}
