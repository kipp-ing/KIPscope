// Minimal Chrome DevTools Protocol client for scripts/capture.mjs: own headless Chrome with a fresh
// temp profile (never Jan's), the built-in WebSocket, no dependencies. Same approach as smoke.mjs.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width, height, scale = 1 }) {
  const profile = mkdtempSync(join(tmpdir(), "kipscope-capture-"));
  const flags = `--headless=new --remote-debugging-port=0 --no-first-run --no-default-browser-check
    --disable-extensions --use-mock-keychain --password-store=basic --hide-scrollbars
    --window-size=${width},${height}`;
  const chrome = spawn(
    process.env.CHROME ?? CHROME,
    [...flags.split(/\s+/), `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" },
  );
  const close = () => {
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  };
  process.on("exit", close);
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const port = readFileSync(portFile, "utf8").split("\n")[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((ok, err) => {
    ws.onopen = ok;
    ws.onerror = () => err(new Error("CDP WebSocket failed"));
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    const p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      if (m.error) p.err(new Error(`${p.method}: ${m.error.message}`));
      else p.ok(m.result);
    } else listeners.get(m.method)?.(m.params);
  };
  const send = (method, params = {}) =>
    new Promise((ok, err) => {
      const id = ++nextId;
      pending.set(id, { ok, err, method });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const js = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.text} ${expression}`);
    return r.result.value;
  };
  for (const d of ["Runtime", "Page"]) await send(`${d}.enable`);
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: scale,
    mobile: false,
  });

  /** Centre of the first element matching `sel` (optionally whose text contains `text`). */
  const center = async (sel, text) => {
    const r = await js(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(sel)})]
        .find((e) => ${JSON.stringify(text ?? "")} === "" || e.textContent.includes(${JSON.stringify(text ?? "")}));
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, left: b.x, top: b.y, width: b.width, height: b.height };
    })()`);
    if (!r) throw new Error(`no element ${sel} ${text ?? ""}`);
    return r;
  };
  const mouse = (type, x, y, extra = {}) =>
    send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: type === "mouseMoved" && !extra.held ? "none" : "left",
      buttons: extra.held || type === "mousePressed" ? 1 : 0,
      clickCount: type === "mouseMoved" ? 0 : (extra.clickCount ?? 1),
      modifiers: extra.modifiers ?? 0,
    });
  /** Moves the pointer from (x0, y0) to (x1, y1) in `steps`, `ms` apart; `held` drags. */
  const glide = async (x0, y0, x1, y1, { steps = 20, ms = 16, held = false } = {}) => {
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      const e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2; // ease in-out
      await mouse("mouseMoved", x0 + (x1 - x0) * e, y0 + (y1 - y0) * e, { held });
      await sleep(ms);
    }
  };
  const click = async (x, y, extra = {}) => {
    await mouse("mousePressed", x, y, extra);
    await mouse("mouseReleased", x, y, extra);
  };
  const key = async (key, code, vk, text) => {
    await send("Input.dispatchKeyEvent", {
      type: text ? "keyDown" : "rawKeyDown",
      key,
      code,
      text,
      windowsVirtualKeyCode: vk,
    });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
  };
  const screenshot = async () =>
    Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64");
  const on = (method, fn) => listeners.set(method, fn);
  return { send, js, center, mouse, glide, click, key, screenshot, on, close };
}
