#!/usr/bin/env node
// Crash gate (docs/team.md "Crash guard"): loads the web app in its own headless Chrome and fails on
// a Vite error overlay, uncaught exceptions, console errors, a failed window or blank root and
// failed module loads; then drives every top-level UI part once and re-checks after each step.
// Plain Node >= 22 (global WebSocket), no dependencies. Never touches Jan's Chrome profile: Chrome
// runs with a fresh temp profile and only this script's own child is killed.
//
//   pnpm smoke                      http://localhost:5173/ (the running dev server): creates its own
//                                   scoped workspace by POST /api/workspaces {open: {view}}, opens it
//                                   at /w/<id> and deletes it on every exit path (speed-up-whole-scans B11)
//   pnpm smoke --scope REF FROM TO  the scope of that workspace (default smart451
//                                   2026-10-27T00:00:00Z 2026-10-28T00:00:00Z)
//   pnpm smoke --signal ID          the signal of its one timeseries window, 10:00–11:00Z of the
//                                   scope's first day (default smart451/BMS.cell_voltage_max)
//   pnpm smoke --url <url>          another page; a path other than `/` is opened as it is
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
// One day of smart451 within the scan bound (114.9 M rows, design B1, B11).
const DEFAULT_SCOPE = ["smart451", "2026-10-27T00:00:00Z", "2026-10-28T00:00:00Z"];
const DEFAULT_SIGNAL = "smart451/BMS.cell_voltage_max";
const argv = process.argv.slice(2);
const arg = (name, n = 1) =>
  argv.includes(name) ? argv.slice(argv.indexOf(name) + 1, argv.indexOf(name) + 1 + n) : undefined;
if (argv.includes("--help")) {
  console.log(`usage: node scripts/smoke.mjs [--preview] [--url URL] [--scope REF FROM TO] [--signal ID]
  --preview            check apps/web/dist served by vite preview instead of the dev server
  --url URL            the page (default http://localhost:5173/); a path other than / is opened as is
  --scope REF FROM TO  scope of the smoke's own workspace (default ${DEFAULT_SCOPE.join(" ")})
  --signal ID          signal of its timeseries window (default ${DEFAULT_SIGNAL})`);
  process.exit(0);
}
let url = arg("--url")?.[0] ?? "http://localhost:5173/";
const scopeArg = arg("--scope", 3) ?? DEFAULT_SCOPE;
const signalArg = arg("--signal")?.[0] ?? DEFAULT_SIGNAL;
// The smoke's own workspace: its ID and the origin it was created on, until it is deleted.
let own;

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
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => finish([`stopped by ${sig}`], 130));
for (const ev of ["uncaughtException", "unhandledRejection"])
  process.on(ev, (e) => finish([`smoke itself failed: ${e?.message ?? e}`]));
setTimeout(() => finish(["timed out after 90 s"]), 90_000).unref();

// Failures, tagged with the step that was running when they arrived.
const failures = [];
let step = "load";
let overflowSeen = false;
const fail = (text) => {
  const line = `[${step}] ${String(text).split("\n")[0].slice(0, 200)}`;
  if (!failures.includes(line)) failures.push(line);
};

let finishing = false;
async function finish(extra = [], code) {
  if (finishing) return;
  finishing = true;
  failures.push(...extra);
  await dropWorkspace();
  if (!failures.length) {
    console.log(
      `smoke ${url}: pass (load, help, search, sidebar, views, overflow ${overflowSeen ? "" : "(not shown) "}at`,
    );
    console.log(`  ${VIEWPORTS.map((v) => v.join("x")).join(" and ")})`);
    process.exit(code ?? 0);
  }
  console.log(`smoke ${url}: FAIL (${failures.length})`);
  for (const f of failures.slice(0, 12)) console.log(`- ${f}`);
  if (failures.length > 12) console.log(`- … ${failures.length - 12} more`);
  // A resolution error for a file that exists: Vite cached the failed lookup (2026-10-17 crash).
  const stale = failures.join("\n").match(/Failed to resolve import "([^"]+)" from "([^"]+)"/);
  if (stale && existsSync(resolve(WEB, dirname(stale[2]), stale[1].split("?")[0]))) {
    console.log("hint: Vite holds a stale resolution: the lead restarts Vite");
  }
  process.exit(code ?? 1);
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
// API answers the specs expect: a 4xx whose body names one of these codes, such as a case window with
// a signal the session lacks (case-navigation "Missing signal in the window"; the neighbour preload
// asks for the same). Chrome still logs them as "Failed to load resource"; any other code fails.
const EXPECTED_API_CODES = new Set(["unknown_signal"]);
const apiCodes = new Map(); // requestId → { code: Promise<string | undefined>, done }
const apiChecks = [];
const apiErrors = new Set(); // requestIds of /api/ answers with status >= 400
function apiCode(requestId) {
  let entry = apiCodes.get(requestId);
  if (!entry) {
    let done;
    entry = { code: new Promise((ok) => (done = ok)), done: (c) => done(c) };
    apiCodes.set(requestId, entry);
  }
  return entry;
}
const handlers = {
  "Runtime.exceptionThrown": ({ exceptionDetails: d }) =>
    fail(`uncaught: ${d.exception?.description ?? d.text}`),
  "Runtime.consoleAPICalled": ({ type, args }) =>
    type === "error" &&
    fail(`console.error: ${args.map((a) => a.value ?? a.description).join(" ")}`),
  "Log.entryAdded": ({ entry: e }) => {
    if (e.level !== "error" || /favicon/.test(e.url ?? "") || MODULE.test(e.url ?? "")) return;
    if (e.source === "network" && e.networkRequestId && /\/api\//.test(e.url ?? "")) {
      const answer = apiCode(e.networkRequestId).code;
      const late = new Promise((ok) => setTimeout(ok, 5000, undefined));
      const check = Promise.race([answer, late]).then((code) => {
        if (!EXPECTED_API_CODES.has(code))
          fail(`console: ${e.text} ${e.url} (${code ?? "no code"})`);
      });
      apiChecks.push(check);
      return;
    }
    fail(`console: ${e.text} ${e.url ?? ""}`);
  },
  "Network.requestWillBeSent": ({ requestId, request }) => {
    inflight.add(requestId);
    urls.set(requestId, request.url);
  },
  "Network.loadingFinished": ({ requestId }) => {
    inflight.delete(requestId);
    if (!apiErrors.has(requestId)) return;
    send("Network.getResponseBody", { requestId }).then(
      ({ body }) => {
        try {
          apiCode(requestId).done(JSON.parse(body)?.error?.code);
        } catch {
          apiCode(requestId).done(undefined);
        }
      },
      () => apiCode(requestId).done(undefined),
    );
  },
  "Network.loadingFailed": ({ requestId, errorText, canceled }) => {
    inflight.delete(requestId);
    apiCode(requestId).done(undefined);
    const u = urls.get(requestId) ?? "";
    if (!canceled && MODULE.test(u))
      fail(`module load failed: ${new URL(u).pathname} ${errorText}`);
  },
  "Network.responseReceived": ({ requestId, type, response: r }) => {
    if (r.status >= 400 && /\/api\//.test(r.url)) apiErrors.add(requestId);
    if (r.status >= 400 && (MODULE.test(r.url) || type === "Document")) {
      fail(`HTTP ${r.status} for ${new URL(r.url).pathname}`);
    }
  },
  // The page must not write, not even to the smoke's own workspace: writes to /api are blocked
  // and reported.
  "Fetch.requestPaused": ({ requestId, request }) => {
    if (request.method === "GET" || request.method === "HEAD") {
      return send("Fetch.continueRequest", { requestId });
    }
    fail(`blocked ${request.method} ${new URL(request.url).pathname} (smoke must not write)`);
    return send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
  },
};

// A v1 view document: the scope and one timeseries window with the signal over 10:00–11:00Z of
// the scope's first day, or the scope's first hour when that lies outside it.
function smokeView() {
  const [dataRef, fromText, toText] = scopeArg;
  const iso = (text, what) => {
    const t = Date.parse(text);
    if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(text) || Number.isNaN(t))
      throw new Error(`--scope ${what}: not an ISO time with Z or an offset: ${text}`);
    return t;
  };
  const from = iso(fromText, "FROM");
  const to = iso(toText, "TO");
  if (to <= from) throw new Error("--scope: TO must be after FROM");
  const H = 3_600_000;
  let wFrom = Math.floor(from / (24 * H)) * 24 * H + 10 * H;
  if (wFrom < from || wFrom + H > to) wFrom = from;
  const wTo = Math.min(wFrom + H, to);
  const at = (t) => new Date(t).toISOString();
  return {
    kipscope: "view",
    version: 1,
    title: "smoke",
    data: [dataRef],
    scope: { dataRef, from: at(from), to: at(to) },
    linkTime: true,
    cursors: { diff: false },
    digits: 3,
    windows: [
      {
        kind: "timeseries",
        from: at(wFrom),
        to: at(wTo),
        mode: "line",
        envelope: false,
        signals: [signalArg],
      },
    ],
  };
}

// `/` gets the smoke's own scoped workspace (sent by the script, not the page) at /w/<id>.
async function createWorkspace() {
  const page = new URL(url);
  if (page.pathname !== "/" || page.search || page.hash) return;
  const res = await fetch(new URL("/api/workspaces", page), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ open: { view: smokeView() } }),
  });
  const body = await res.json().catch(() => undefined);
  const id = body?.workspace?.id;
  if (!res.ok || typeof id !== "string") {
    const code = body?.code ?? body?.error?.code ?? `HTTP ${res.status}`;
    const message = body?.message ?? body?.error?.message ?? "";
    throw new Error(`cannot create the smoke workspace: ${code}: ${message}`);
  }
  own = { id, origin: page.origin };
  url = new URL(`/w/${id}`, page).href;
  console.log(`smoke workspace ${id} created (scope ${scopeArg.join(" ")}, ${signalArg})`);
}

// Deletes the smoke's own workspace; called on every exit path through finish().
async function dropWorkspace() {
  if (!own) return;
  const { id, origin } = own;
  own = undefined;
  try {
    const res = await fetch(new URL(`/api/workspaces/${id}`, origin), {
      method: "DELETE",
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) console.log(`smoke workspace ${id} deleted`);
    else failures.push(`cannot delete the smoke workspace ${id}: HTTP ${res.status}`);
  } catch (e) {
    failures.push(`cannot delete the smoke workspace ${id}: ${e.message}`);
  }
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
  await createWorkspace();
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
    await Promise.all(apiChecks);
    if (failures.length) break; // a broken load makes every interaction fail too
    for (const [name, run] of Object.entries(STEPS)) {
      step = `${name} ${width}x${height}`;
      await run();
      await idle(1500);
      await check();
    }
  }
  await Promise.all(apiChecks);
  finish();
}

main().catch((e) => finish([`smoke itself failed: ${e.message}`]));
