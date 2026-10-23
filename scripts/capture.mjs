#!/usr/bin/env node
// README pictures from the demo recording (README "Demo"): sets up each scene through the CLI, then
// screenshots the UI in its own headless Chrome (scripts/cdp.mjs) and records the GIF as a
// screencast, with a drawn pointer because headless Chrome draws none. Needs `scripts/demo.sh`
// running and ffmpeg for the GIF. Changes only the demo server's workspace.
//
//   node scripts/capture.mjs              all pictures into docs/images/
//   node scripts/capture.mjs hero gif     only these
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "./cdp.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs/images");
const UI = process.env.DEMO_UI ?? "http://localhost:5183/";
const SERVER = process.env.DEMO_SERVER ?? "http://127.0.0.1:7320";
const only = process.argv.slice(2);

// --- Workspace through the CLI ----------------------------------------------------------------------
function cli(...args) {
  const out = execFileSync(process.execPath, [join(ROOT, "apps/cli/src/main.ts"), ...args], {
    env: { ...process.env, KIPSCOPE_URL: SERVER },
    encoding: "utf8",
  });
  return JSON.parse(out.trim().split("\n").at(-1));
}
function reset() {
  for (const w of cli("state").data.workspace.windows) cli("window", "remove", w.id);
  for (const c of ["a", "b"]) {
    try {
      cli("cursor", "remove", c);
    } catch {} // already off
  }
  cli("diff", "off");
  cli("link", "on");
}
/** A window with signals; returns its ID. */
function window(title, signals, options = []) {
  const id = cli("window", "create", "--title", title, ...options).created;
  for (const s of signals) cli("signal", "add", id, s);
  return id;
}

// --- Browser ---------------------------------------------------------------------------------------------
// A drawn pointer (an arrow that follows the mouse, a ring on press) for the screencast.
const POINTER = `addEventListener("DOMContentLoaded", () => {
  const p = document.createElement("div");
  p.id = "capture-pointer";
  p.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 13.8 L10.6 20.4 L13.4 19.1 L10.4 12.6 L16.6 12.6 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  Object.assign(p.style, { position: "fixed", left: "-40px", top: "-40px", zIndex: 99999, pointerEvents: "none", width: "22px", height: "22px", marginLeft: "-3px", marginTop: "-2px" });
  const ring = document.createElement("div");
  Object.assign(ring.style, { position: "fixed", zIndex: 99998, pointerEvents: "none", width: "26px", height: "26px", margin: "-13px 0 0 -13px", borderRadius: "50%", background: "rgba(14,165,233,.35)", display: "none" });
  document.body.append(ring, p);
  const move = (e) => { p.style.left = e.clientX + "px"; p.style.top = e.clientY + "px"; ring.style.left = e.clientX + "px"; ring.style.top = e.clientY + "px"; };
  addEventListener("pointermove", move, true);
  addEventListener("pointerdown", (e) => { move(e); ring.style.display = "block"; }, true);
  addEventListener("pointerup", () => { ring.style.display = "none"; }, true);
});`;

async function open({ width, height, scale, pointer = false, startCard = false }) {
  const b = await launch({ width, height, scale });
  if (pointer) await b.send("Page.addScriptToEvaluateOnNewDocument", { source: POINTER });
  if (!startCard) {
    await b.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { localStorage.setItem("kipscope.startCard", "dismissed") } catch {}`,
    });
  }
  await b.send("Page.navigate", { url: UI });
  for (let i = 0; i < 100; i++) {
    if (await b.js("!!document.querySelector('.explorer .group-head')")) break;
    await sleep(100);
  }
  await settle(b);
  return b;
}
/** Waits until no legend row reads loading and the strip has bars. */
async function settle(b, extra = 1200) {
  for (let i = 0; i < 100; i++) {
    const busy = await b.js(
      `!!document.querySelector(".window-grid .loading") || !document.querySelector(".time-strip-track .strip-run")`,
    );
    if (!busy) break;
    await sleep(150);
  }
  await sleep(extra);
}
async function save(b, name) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.png`), await b.screenshot());
  console.log(`docs/images/${name}.png`);
}
const search = async (b, text) => {
  await b.js(
    `(() => { const i = document.querySelector("input[aria-label='Search signals']"); i.focus(); i.select(); })()`,
  );
  await b.send("Input.insertText", { text });
  await sleep(400);
};
const groupClick = (name) =>
  `[...document.querySelectorAll(".explorer .group-head")].find((g) => g.querySelector(".group-name")?.textContent === ${JSON.stringify(name)})?.click()`;
const blur = (b) => b.js("document.activeElement?.blur()");

// --- Scenes ------------------------------------------------------------------------------------------------
const SCENES = {
  /** A launch from a traffic light: speed, throttle, pack current and voltage, A/B with Diff, values. */
  async hero({ setupOnly = false } = {}) {
    reset();
    const drive = window(
      "Drive",
      ["VehSpeed", "Throttle", "PackCurrent"],
      ["--from", "2026-10-14 07:43:40", "--to", "2026-10-14 07:46:40"],
    );
    const battery = window("Battery", ["PackVoltage", "SocReal", "BatTemp"]);
    for (const id of [drive, battery]) cli("window", "height", id, "470");
    window(
      "At the cursors",
      [
        "Gear",
        "RangeEst",
        "TripStart",
        "EnergyStart",
        "Bat12V",
        "OutsideTemp",
        "CellV_09",
        "CellV_59",
      ],
      ["--values"],
    );
    cli("cursor", "set", "a", "2026-10-14 07:44:22.950");
    cli("cursor", "set", "b", "2026-10-14 07:45:12");
    cli("diff", "on");
    if (setupOnly) return;
    const b = await open({ width: 1440, height: 900, scale: 2 });
    for (const group of ["DASH", "VCU"]) await b.js(groupClick(group));
    await sleep(300);
    const plot = await b.center(".window .plot");
    await b.mouse("mouseMoved", plot.left + plot.width * 0.74, plot.top + plot.height * 0.3);
    await sleep(600);
    await save(b, "hero");
    b.close();
  },

  /** The AC charge: charger and pack values, 12 cells, the hover card of the weakest cell. */
  async charging() {
    reset();
    const charging = window(
      "Charging",
      ["AcCurrent", "PackCurrent", "SocReal", "PackVoltage", "ChargerTemp"],
      ["--from", "2026-10-14 08:05", "--to", "2026-10-14 12:10"],
    );
    // Twelve cells around the weakest, 59.
    const cells = Array.from({ length: 12 }, (_, i) => `CellV_${String(i + 52).padStart(2, "0")}`);
    const cellWindow = window("Cells 52 to 63", cells);
    for (const id of [charging, cellWindow]) cli("window", "height", id, "560");
    const b = await open({ width: 1440, height: 900, scale: 2 });
    await search(b, "cellv 5");
    const row = await b.center(".explorer .row .name", "CellV_59");
    await b.mouse("mouseMoved", row.x, row.y);
    await sleep(1200);
    await save(b, "charging");
    b.close();
  },

  /** The morning after: the fault memory read, isolation and 12 V, Events tab. */
  async events() {
    reset();
    const morning = window(
      "Morning after",
      ["VehSpeed", "Isolation"],
      ["--from", "2026-10-15 07:47:40", "--to", "2026-10-15 08:09:30"],
    );
    const power = window("12 V and HV", ["Bat12V", "PackCurrent", "HvActive"]);
    for (const id of [morning, power]) cli("window", "height", id, "640");
    cli("cursor", "set", "a", "2026-10-15 07:48:52");
    const b = await open({ width: 1440, height: 900, scale: 2 });
    await b.js(
      `[...document.querySelectorAll(".sidebar-switch [role=tab]")].find((t) => t.textContent === "Events")?.click()`,
    );
    await settle(b, 800);
    await save(b, "events");
    b.close();
  },

  /** The help panel's manual at "Measure", over the hero workspace. */
  async help() {
    await SCENES.hero({ setupOnly: true });
    const b = await open({ width: 1440, height: 900, scale: 2 });
    await blur(b);
    await b.key("?", "Slash", 191, "?");
    await sleep(500);
    await b.js(
      `[...document.querySelectorAll(".help-tabs button")].find((t) => t.textContent === "Manual")?.click()`,
    );
    await sleep(300);
    await b.js(
      `[...document.querySelectorAll(".help-panel h2")].find((h) => h.textContent === "Measure")?.scrollIntoView()`,
    );
    await sleep(500);
    await save(b, "help");
    b.close();
  },

  /** Drag two signals into a window, jump to a drive on the TIME strip, zoom, set A and B. */
  async gif() {
    reset();
    // An empty window from the start, so the GIF opens without the "No windows yet" card.
    const target = window(
      "Speed and current",
      [],
      ["--from", "2026-10-14 07:41", "--to", "2026-10-15 08:09"],
    );
    cli("window", "height", target, "470");
    const W = 1280;
    const H = 720;
    const b = await open({ width: W, height: H, scale: 1, pointer: true });
    const frames = mkdtempSync(join(tmpdir(), "kipscope-gif-"));
    const shots = [];
    b.on("Page.screencastFrame", ({ data, sessionId, metadata }) => {
      shots.push({ data, t: metadata.timestamp });
      b.send("Page.screencastFrameAck", { sessionId });
    });
    await b.mouse("mouseMoved", W * 0.55, H * 0.55);
    await b.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
    await sleep(900);

    // 1. Search and drag VehSpeed into the empty window.
    let at = { x: W * 0.55, y: H * 0.55 };
    const go = async (x, y, opts) => {
      await b.glide(at.x, at.y, x, y, opts);
      at = { x, y };
    };
    const input = await b.center("input[aria-label='Search signals']");
    await go(input.x, input.y, { steps: 26 });
    await b.click(input.x, input.y);
    for (const c of "speed") {
      await b.send("Input.insertText", { text: c });
      await sleep(110);
    }
    await sleep(700);
    const drag = async (from, to) => {
      await go(from.x, from.y, { steps: 22 });
      await sleep(200);
      await b.mouse("mousePressed", from.x, from.y);
      await go(to.x, to.y, { steps: 36, held: true });
      await sleep(350);
      await b.mouse("mouseReleased", to.x, to.y);
      await sleep(900);
    };
    let row = await b.center(".explorer .row .name", "VehSpeed");
    const empty = await b.center(".window");
    await drag(row, { x: empty.x, y: empty.y });
    await settle(b, 600);

    // 2. A second signal onto that window.
    await b.click(input.x, input.y);
    await b.js(`document.querySelector("input[aria-label='Search signals']").select()`);
    for (const c of "pack") {
      await b.send("Input.insertText", { text: c });
      await sleep(110);
    }
    await sleep(600);
    row = await b.center(".explorer .row .name", "PackCurrent");
    let plot = await b.center(".window .plot");
    await drag(row, { x: plot.x, y: plot.y });
    await settle(b, 700);

    // 3. The TIME strip: click the evening drive to fit it.
    const drives = await b.js(`[...document.querySelectorAll(".time-strip-drive-bar")].map((e) => {
      const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })`);
    const evening = drives[3] ?? drives.at(-1);
    await go(evening.x, evening.y, { steps: 30 });
    await sleep(300);
    await b.click(evening.x, evening.y);
    await settle(b, 1200);

    // 4. Drag across the plot to zoom in on a stretch of the drive.
    plot = await b.center(".window .plot");
    const y = plot.top + plot.height * 0.55;
    const x0 = plot.left + plot.width * 0.3;
    const x1 = plot.left + plot.width * 0.52;
    await go(x0, y, { steps: 24 });
    await b.mouse("mousePressed", x0, y);
    await go(x1, y, { steps: 30, held: true });
    await b.mouse("mouseReleased", x1, y);
    await settle(b, 1000);

    // 5. Cursor A, then B with Shift, then Diff.
    plot = await b.center(".window .plot");
    const ax = plot.left + plot.width * 0.25;
    const bx = plot.left + plot.width * 0.7;
    await go(ax, y, { steps: 20 });
    await b.click(ax, y);
    await sleep(700);
    await go(bx, y, { steps: 24 });
    await b.click(bx, y, { modifiers: 8 });
    await sleep(800);
    const diff = await b.center("button.toggle", "Diff");
    await go(diff.x, diff.y, { steps: 26 });
    await b.click(diff.x, diff.y);
    await sleep(1400);
    await go(plot.left + plot.width * 0.5, plot.top + plot.height * 0.4, { steps: 30 });
    await sleep(1600);
    await b.send("Page.stopScreencast");
    b.close();

    // Frames → GIF at their real timing (ffmpeg concat with durations, one palette).
    const list = [];
    shots.forEach((s, i) => {
      const file = join(frames, `f${String(i).padStart(5, "0")}.png`);
      writeFileSync(file, Buffer.from(s.data, "base64"));
      const next = shots[i + 1]?.t ?? s.t + 1;
      list.push(`file '${file}'`, `duration ${Math.max(0.02, next - s.t).toFixed(3)}`);
    });
    list.push(`file '${join(frames, `f${String(shots.length - 1).padStart(5, "0")}.png`)}'`);
    writeFileSync(join(frames, "list.txt"), list.join("\n"));
    mkdirSync(OUT, { recursive: true });
    const gif = join(OUT, "workflow.gif");
    const filter =
      "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle";
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      join(frames, "list.txt"),
      "-vf",
      filter,
      "-loop",
      "0",
      gif,
    ]);
    rmSync(frames, { recursive: true, force: true });
    console.log(`docs/images/workflow.gif (${shots.length} frames)`);
  },
};

for (const [name, scene] of Object.entries(SCENES)) {
  if (only.length && !only.includes(name)) continue;
  await scene();
}
process.exit(0);
