import type { LiveServerMessage, RenderedMessage, Workspace } from "@kipscope/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { tabSeriesCache } from "./chart/cache.ts";

export interface LiveState {
  connected: boolean;
  clientId?: string;
  revision: number;
  workspace?: Workspace;
  /** State pushes caused by `window.setRange` since the tab opened (design H7). */
  rangeSets: number;
  /**
   * The latest state push caused by `view.open`, kept across later pushes so a push in the same
   * React batch cannot hide it (add-saved-views V7 round 3). The state sent on connect never sets it.
   */
  lastOpen?: Extract<LiveServerMessage, { type: "state" }>;
}

/** The live state after one server message (design H7). */
export function applyLiveMessage(state: LiveState, message: LiveServerMessage): LiveState {
  if (message.type === "hello") return { ...state, clientId: message.clientId };
  return {
    ...state,
    revision: message.revision,
    workspace: message.workspace,
    rangeSets: state.rangeSets + (message.command === "window.setRange" ? 1 : 0),
    ...(message.command === "view.open" ? { lastOpen: message } : {}),
  };
}

/**
 * Connection to `WS /api/live`: receives the workspace after every accepted command and sends
 * render acknowledgements. Reconnects after a second when the connection drops. `send` returns
 * whether the socket took the message (design H6).
 */
export function useLive(): [LiveState, (message: RenderedMessage) => boolean] {
  const [state, setState] = useState<LiveState>({ connected: false, revision: -1, rangeSets: 0 });
  const socket = useRef<WebSocket | undefined>(undefined);

  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`;
      const ws = new WebSocket(url);
      socket.current = ws;
      ws.onopen = () => {
        setState((s) => ({ ...s, connected: true }));
        // The server may have lost the source while the channel was down: failed loads retry (R7).
        tabSeriesCache().recover();
      };
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data) as LiveServerMessage;
        setState((s) => applyLiveMessage(s, message));
      };
      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (!closed) timer = setTimeout(open, 1000);
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket.current?.close();
    };
  }, []);

  const send = useCallback((message: RenderedMessage): boolean => {
    const ws = socket.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }, []);

  return [state, send];
}
