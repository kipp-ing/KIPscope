import {
  CLOSE_NO_ACCESS,
  CLOSE_WORKSPACE_GONE,
  type LiveServerMessage,
  type RenderedMessage,
  type Workspace,
  type WorkspaceSummary,
} from "@kipscope/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { tabSeriesCache } from "./chart/cache.ts";
import { apiPath } from "./workspaces/apiPath.ts";

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
  /** The workspace with this connection's rights, owner and grant, from the `summary` messages (add-multiuser M8). */
  summary?: WorkspaceSummary;
  /** Close code 4403 or 4404: the channel stays shut and the page shows its gate (M12). */
  closed?: number;
  /** The user's favourite signal names from the last `favourites` message (add-favourites F9). */
  favourites?: string[];
}

/** The live state after one server message (design H7). */
export function applyLiveMessage(state: LiveState, message: LiveServerMessage): LiveState {
  if (message.type === "hello") return { ...state, clientId: message.clientId };
  if (message.type === "summary") return { ...state, summary: message.summary };
  // Per user, not workspace state (add-favourites F4): revision and workspace stay as they are.
  if (message.type === "favourites") return { ...state, favourites: message.names };
  return {
    ...state,
    revision: message.revision,
    workspace: message.workspace,
    rangeSets: state.rangeSets + (message.command === "window.setRange" ? 1 : 0),
    ...(message.command === "view.open" ? { lastOpen: message } : {}),
  };
}

/** Close codes after which the channel does not reconnect (add-multiuser M8). */
export const FINAL_CLOSES: readonly number[] = [CLOSE_NO_ACCESS, CLOSE_WORKSPACE_GONE];

/**
 * Connection to `WS /api/live` of `workspaceId` (none until the start-up chose it): receives the
 * workspace after every accepted command and sends render acknowledgements. Reconnects after a
 * second when the connection drops, except after 4403 and 4404. `send` returns whether the socket
 * took the message (design H6).
 */
export function useLive(
  workspaceId: string | undefined,
): [LiveState, (message: RenderedMessage) => boolean] {
  const [state, setState] = useState<LiveState>({ connected: false, revision: -1, rangeSets: 0 });
  const socket = useRef<WebSocket | undefined>(undefined);

  useEffect(() => {
    if (workspaceId === undefined) return;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      const path = apiPath("/api/live", workspaceId);
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`;
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
      ws.onclose = (event) => {
        const final = FINAL_CLOSES.includes(event.code);
        setState((s) => ({ ...s, connected: false, ...(final ? { closed: event.code } : {}) }));
        if (!closed && !final) timer = setTimeout(open, 1000);
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket.current?.close();
    };
  }, [workspaceId]);

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
