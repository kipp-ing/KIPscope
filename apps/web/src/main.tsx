import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { GatePage } from "./workspaces/Gate.tsx";
import { useStartup } from "./workspaces/startup.ts";
import "./styles.css";

/** Chooses the page's workspace before the workspace and its live channel open (add-multiuser M12). */
function Root() {
  const start = useStartup();
  if (start.kind === "pending") return null;
  if (start.kind === "gate") return <GatePage gate={start.gate} />;
  return <App start={start} />;
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
