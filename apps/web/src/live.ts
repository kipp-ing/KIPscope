import type { LiveServerMessage, RenderedMessage, Workspace } from "@letsview/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { tabSeriesCache } from "./chart/cache.ts";

export interface LiveState {
  connected: boolean;
  clientId?: string;
  revision: number;
  workspace?: Workspace;
}

/**
 * Connection to `WS /api/live`: receives the workspace after every accepted command and sends
 * render acknowledgements. Reconnects after a second when the connection drops.
 */
export function useLive(): [LiveState, (message: RenderedMessage) => void] {
  const [state, setState] = useState<LiveState>({ connected: false, revision: -1 });
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
        if (message.type === "hello") setState((s) => ({ ...s, clientId: message.clientId }));
        else setState((s) => ({ ...s, revision: message.revision, workspace: message.workspace }));
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

  const send = useCallback((message: RenderedMessage) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message));
  }, []);

  return [state, send];
}
