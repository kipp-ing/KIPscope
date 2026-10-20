#!/usr/bin/env node
// Crash gate (docs/team.md "Crash guard"): loads the web app in its own headless Chrome and fails on
// a Vite error overlay, uncaught exceptions, console errors, a failed window or blank root and
// failed module loads; then drives every top-level UI part once and re-checks after each step.
// Plain Node >= 22 (global WebSocket), no dependencies. Never touches Jan's Chrome profile: Chrome
// runs with a fresh temp profile and only this script's own child is killed.
//
//   pnpm smoke                      http://localhost:5173/ (the running dev server); `/` opens the
//                                   user's free workspace (or else the latest) at /w/<id>
//   pnpm smoke --url <url>          another page
//   pnpm smoke --preview            builds nothing; serves apps/web/dist with `vite preview` on a free
//                                   port (own child, stopped at the end) and checks that
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "../apps/web");
const VIEWPORTS = [
  [1440, 900],
  [1000, 557],
];
// Module requests: Vite dev (/src/, /@vite/, /@fs/, prebundled deps) and the built bundle (/assets/).
const MODULE = /\/(src|@vite|@fs|@id|node_modules|assets)\//;
const argv = process.argv.slice(2);
const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
let url = arg("--url") ?? "http://localhost:5173/";
// The start-up reuse POST (`/` with no workspace yet) may pass once; see resolveStart.
let allowReuse = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Polls `cond` up to `tries` times, `ms` apart; the caller checks the outcome itself.
const until = async (cond, tries, ms) => {
  for (let i = 0; i < tries && !(await cond()); i++) await sleep(ms);
};
const freePort = () =>
  new Promise((ok) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

// Own children only, killed by their handles on every exit path.
const children = [];
const profile = mkdtempSync(join(tmpdir(), "kipscope-smoke-"));
function cleanup() {
  for (const c of children) if (c.exitCode === null) c.kill("SIGKILL");
  rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
}
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));
setTimeout(() => finish(["timed out after 90 s"]), 90_000).unref();

// Failures, tagged with the step that was running when they arrived.
const failures = [];
let step = "load";
let overflowSeen = false;
const fail = (text) => {
  const line = `[${step}] ${String(text).split("\n")[0].slice(0, 200)}`;
  if (!failures.includes(line)) failures.push(line);
};

function finish(extra = []) {
  failures.push(...extra);
  if (!failures.length) {
    console.log(
      `smoke ${url}: pass (load, help, search, sidebar, views, overflow ${overflowSeen ? "" : "(not shown) "}at`,
    );
    console.log(`  ${VIEWPORTS.map((v) => v.join("x")).join(" and ")})`);
    process.exit(0);
  }
  console.log(`smoke ${url}: FAIL (${failures.length})`);
  for (const f of failures.slice(0, 12)) console.log(`- ${f}`);
  if (failures.length > 12) console.log(`- … ${failures.length - 12} more`);
  // A resolution error for a file that exists: Vite cached the failed lookup (2026-10-17 crash).
  const stale = failures.join("\n").match(/Failed to resolve import "([^"]+)" from "([^"]+)"/);
  if (stale && existsSync(resolve(WEB, dirname(stale[2]), stale[1].split("?")[0]))) {
    console.log("hint: Vite holds a stale resolution: the lead restarts Vite");
  }
  process.exit(1);
}

// --- CDP over the built-in WebSocket ------------------------------------------------------------
let ws;
let nextId = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((ok, err) => {
    const id = ++nextId;
    pending.set(id, { ok, err, method });
    ws.send(JSON.stringify({ id, method, params }));
  });
async function js(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.text}`);
  return r.result.value;
}

const inflight = new Set();
const urls = new Map();
const handlers = {
  "Runtime.exceptionThrown": ({ exceptionDetails: d }) =>
    fail(`uncaught: ${d.exception?.description ?? d.text}`),
  "Runtime.consoleAPICalled": ({ type, args }) =>
    type === "error" &&
    fail(`console.error: ${args.map((a) => a.value ?? a.description).join(" ")}`),
  "Log.entryAdded": ({ entry: e }) =>
    e.level === "error" && !/favicon/.test(e.url ?? "") && !MODULE.test(e.url ?? "")
      ? fail(`console: ${e.text} ${e.url ?? ""}`)
      : undefined,
  "Network.requestWillBeSent": ({ requestId, request }) => {
    inflight.add(requestId);
    urls.set(requestId, request.url);
  },
  "Network.loadingFinished": ({ requestId }) => inflight.delete(requestId),
  "Network.loadingFailed": ({ requestId, errorText, canceled }) => {
    inflight.delete(requestId);
    const u = urls.get(requestId) ?? "";
    if (!canceled && MODULE.test(u))
      fail(`module load failed: ${new URL(u).pathname} ${errorText}`);
  },
  "Network.responseReceived": ({ type, response: r }) => {
    if (r.status >= 400 && (MODULE.test(r.url) || type === "Document")) {
      fail(`HTTP ${r.status} for ${new URL(r.url).pathname}`);
    }
  },
  // The smoke must not change the shared workspace: writes to /api are blocked and reported, except
  // the one start-up `POST /api/workspaces {reuse: true}` when the user has no workspace yet.
  "Fetch.requestPaused": ({ requestId, request }) => {
    if (request.method === "GET" || request.method === "HEAD" || isStartupReuse(request)) {
      return send("Fetch.continueRequest", { requestId });
    }
    fail(`blocked ${request.method} ${new URL(request.url).pathname} (smoke must not write)`);
    return send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
  },
};

function isStartupReuse(request) {
  if (!allowReuse || request.method !== "POST") return false;
  if (new URL(request.url).pathname !== "/api/workspaces") return false;
  let body;
  try {
    body = JSON.parse(request.postData ?? "");
  } catch {
    return false;
  }
  if (JSON.stringify(body) !== '{"reuse":true}') return false;
  allowReuse = false;
  return true;
}

// `/` makes the app reuse or create a workspace by POST; the smoke instead opens the user's free
// workspace (no tab on it), or else the latest, at /w/<id>. Only a user without any workspace gets
// the one reuse POST, which creates an empty workspace.
async function resolveStart() {
  const page = new URL(url);
  if (page.pathname !== "/" || page.search || page.hash) return;
  const res = await fetch(new URL("/api/workspaces", page));
  if (!res.ok) throw new Error(`GET /api/workspaces: HTTP ${res.status}`);
  const { workspaces } = await res.json();
  const ws = workspaces.find((w) => w.clients === 0) ?? workspaces[0];
  if (ws) url = new URL(`/w/${ws.id}`, page).href;
  else allowReuse = true;
}

// Network quiet for 500 ms, at most `max` ms (the live WebSocket does not count as a request).
async function idle(max = 4000) {
  const end = Date.now() + max;
  let quietSince = Date.now();
  while (Date.now() < end) {
    await sleep(100);
    if (inflight.size) quietSince = Date.now();
    else if (Date.now() - quietSince >= 500) return;
  }
}

// Page state: overlay, blank root, failed windows (WindowBoundary), whether the app mounted.
async function check() {
  const s = await js(`(() => {
    const o = document.querySelector("vite-error-overlay");
    const root = document.getElementById("root");
    return {
      overlay: o && (o.shadowRoot?.querySelector(".message-body")?.textContent || "error overlay").trim(),
      blank: !o && (!root || root.childElementCount === 0),
      failed: [...document.querySelectorAll(".window-failed")].map((e) => e.textContent.trim()),
      explorer: !!document.querySelector(".explorer"),
    };
  })()`);
  if (s.overlay) fail(`vite overlay: ${s.overlay.replace(/\s+/g, " ")}`);
  if (s.blank) fail("blank page: #root is missing or empty");
  for (const f of s.failed) fail(`window failed to draw: ${f.slice(0, 120)}`);
  return s;
}

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
const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.click()`);
const has = (sel) => js(`!!document.querySelector(${JSON.stringify(sel)})`);
const expect = (ok, text) => ok || fail(text);

// Cheap interactions over every top-level part; none of them writes to the workspace.
const STEPS = {
  async help() {
    await js("document.activeElement?.blur()");
    await key("?", "Slash", 191, "?");
    expect(await has(".help-panel"), "`?` did not open the help panel");
    await key("Escape", "Escape", 27);
    expect(!(await has(".help-panel")), "Esc did not close the help panel");
  },
  async search() {
    const input = "document.querySelector(\"input[aria-label='Search signals']\")";
    await js(`${input}?.focus()`);
    await send("Input.insertText", { text: "speed" });
    await sleep(300);
    expect((await js(`${input}?.value`)) === "speed", "typing did not reach the signal search");
    await js(`${input}?.select()`);
    await key("Backspace", "Backspace", 8);
    expect((await js(`${input}?.value`)) === "", "the signal search did not clear");
    await js("document.activeElement?.blur()");
  },
  async sidebar() {
    const tab = (n) =>
      `[...document.querySelectorAll(".sidebar-switch [role=tab]")].find((b) => b.textContent === "${n}")?.click()`;
    await js(tab("Events"));
    expect(await has(".explorer.part-events"), "the sidebar did not switch to Events");
    await js(tab("Signals"));
    expect(!(await has(".explorer.part-events")), "the sidebar did not switch back to Signals");
  },
  views: () => toggle(".views-button", "Views menu"),
  async overflow() {
    const shown = await js(`!!document.querySelector(".overflow-button")?.checkVisibility()`);
    if (shown) await toggle(".overflow-button", "'⋯' menu");
    overflowSeen ||= shown;
  },
};
async function toggle(sel, name) {
  const open = () =>
    js(`document.querySelector(${JSON.stringify(sel)})?.getAttribute("aria-expanded")`);
  await click(sel);
  expect((await open()) === "true", `the ${name} did not open`);
  await click(sel);
  expect((await open()) === "false", `the ${name} did not close`);
}

// --- Run -----------------------------------------------------------------------------------------
async function main() {
  if (argv.includes("--preview")) {
    const port = await freePort();
    const vite = join(WEB, "node_modules/vite/bin/vite.js");
    const args = [vite, "preview", "--port", String(port), "--strictPort"];
    children.push(spawn(process.execPath, args, { cwd: WEB, stdio: "ignore" }));
    url = `http://localhost:${port}/`;
    await until(
      () =>
        fetch(url).then(
          (r) => r.ok,
          () => false,
        ),
      50,
      200,
    );
  }
  await resolveStart();
  // Port 0: Chrome picks a free port and writes it to DevToolsActivePort in the profile.
  const flags =
    "--headless=new --remote-debugging-port=0 --no-first-run --no-default-browser-check \
    --disable-extensions --use-mock-keychain --password-store=basic --window-size=1440,900";
  const chrome = spawn(
    CHROME,
    [...flags.split(/\s+/), `--user-data-dir=${profile}`, "about:blank"],
    {
      stdio: "ignore",
    },
  );
  children.push(chrome);
  chrome.on("exit", (code) => ws || finish([`Chrome exited early (code ${code})`]));
  const portFile = join(profile, "DevToolsActivePort");
  await until(() => existsSync(portFile), 100, 100);
  const port = readFileSync(portFile, "utf8").split("\n")[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((ok, err) => {
    ws.onopen = ok;
    ws.onerror = () => err(new Error("CDP WebSocket failed"));
  });
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    const p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      if (m.error) p.err(new Error(`${p.method}: ${m.error.message}`));
      else p.ok(m.result);
    } else handlers[m.method]?.(m.params);
  };

  for (const d of ["Runtime", "Log", "Network", "Page"]) await send(`${d}.enable`);
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
  for (const [i, [width, height]] of VIEWPORTS.entries()) {
    step = `load ${width}x${height}`;
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    if (i === 0) {
      const nav = await send("Page.navigate", { url });
      if (nav.errorText) return finish([`cannot load ${url}: ${nav.errorText}`]);
      await until(() => js("!!document.querySelector('.explorer, vite-error-overlay')"), 50, 200);
    }
    await idle();
    const s = await check();
    if (!s.explorer) fail("the app did not mount .explorer");
    if (failures.length) break; // a broken load makes every interaction fail too
    for (const [name, run] of Object.entries(STEPS)) {
      step = `${name} ${width}x${height}`;
      await run();
      await idle(1500);
      await check();
    }
  }
  finish();
}

main().catch((e) => finish([`smoke itself failed: ${e.message}`]));
