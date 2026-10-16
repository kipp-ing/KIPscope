import type { RenderError } from "@kipscope/shared";
import { Component, type ReactNode } from "react";

export interface WindowBoundaryProps {
  windowId: string;
  revision: number;
  onReady: (windowId: string, revision: number, errors: RenderError[]) => void;
  children: ReactNode;
}

interface WindowBoundaryState {
  error?: string | undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Catches a window that fails to draw (design H6): shows an error box in its place and reports the
 * revision as rendered with a render error, so the other windows and `--wait` keep working.
 */
export class WindowBoundary extends Component<WindowBoundaryProps, WindowBoundaryState> {
  state: WindowBoundaryState = {};

  static getDerivedStateFromError(error: unknown): WindowBoundaryState {
    return { error: errorMessage(error) };
  }

  componentDidCatch(error: unknown): void {
    this.report(errorMessage(error));
  }

  componentDidUpdate(prev: WindowBoundaryProps): void {
    if (this.state.error !== undefined && prev.revision !== this.props.revision) {
      this.report(this.state.error);
    }
  }

  private report(message: string): void {
    const { windowId, revision, onReady } = this.props;
    onReady(windowId, revision, [{ windowId, message: `render: ${message}` }]);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    return (
      <div className="window window-failed">
        Window failed to draw: {error}{" "}
        <button type="button" onClick={() => this.setState({ error: undefined })}>
          Retry
        </button>
      </div>
    );
  }
}
