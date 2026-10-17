/**
 * Creates the demo database `demo` for the README pictures: two days of a simulated smart fortwo
 * electric drive (451) with five sessions (four drives and one AC charge), plus a fault memory read.
 * Every signal is one the Open Vehicle Monitoring System decodes publicly (module vehicle_smarted);
 * names, units and states come from `demo/smart-ed.dbc`, the fault codes are generic SAE J2012 codes.
 * No row comes from a real recording. Deterministic: the same run gives the same rows.
 *
 * Run: pnpm --filter @kipscope/server seed:demo   (needs `docker compose up -d`; see README "Demo")
 */
import { createClient } from "@clickhouse/client";

const url = process.env.DEMO_CLICKHOUSE_URL ?? process.env.TEST_CLICKHOUSE_URL;
if (!url)
  throw new Error("DEMO_CLICKHOUSE_URL or TEST_CLICKHOUSE_URL is not set (see .env.example)");

/** Same server: equal port and equal host, where localhost, 127.0.0.1 and [::1] are one host. */
function sameServer(a: string, b: string): boolean {
  const key = (text: string) => {
    const u = new URL(text);
    const host = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname.toLowerCase())
      ? "loopback"
      : u.hostname.toLowerCase();
    return `${host}:${u.port || (u.protocol === "https:" ? "443" : "80")}`;
  };
  return key(a) === key(b);
}
if (process.env.CLICKHOUSE_URL && sameServer(url, process.env.CLICKHOUSE_URL)) {
  throw new Error("the demo URL points at the same server as CLICKHOUSE_URL; refusing to seed it");
}

const client = createClient({
  url,
  username: process.env.DEMO_CLICKHOUSE_USER ?? process.env.TEST_CLICKHOUSE_USER ?? "kipscope",
  password: process.env.DEMO_CLICKHOUSE_PASSWORD ?? process.env.TEST_CLICKHOUSE_PASSWORD ?? "",
});

const VEHICLE = "smart-ed";
/** Local wall time in Berlin (CEST, UTC+2 in October 2026) → epoch ms. */
const local = (day: number, h: number, m: number, s = 0) => Date.UTC(2026, 9, day, h - 2, m, s);

// --- Deterministic noise ---------------------------------------------------------------------------
let seed = 451;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const noise = (amplitude: number) => (random() * 2 - 1) * amplitude;

// --- Rows --------------------------------------------------------------------------------------------
interface Row {
  vehicle: string;
  device: string;
  chunk: string;
  signal: string;
  utc: string;
  value: number;
  text: string;
}
let rows: Row[] = [];
let chunk = "";
let inserted = 0;
const iso = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");
function emit(signal: string, ms: number, value: number) {
  rows.push({
    vehicle: VEHICLE,
    device: "demo-logger",
    chunk,
    signal,
    utc: iso(Math.round(ms)),
    value,
    text: "",
  });
}
async function flush() {
  if (rows.length === 0) return;
  await client.insert({ table: "demo.signals", values: rows, format: "JSONEachRow" });
  inserted += rows.length;
  rows = [];
}
const round = (value: number, step: number) => Number((Math.round(value / step) * step).toFixed(6));

// --- Vehicle state -------------------------------------------------------------------------------------
const CELLS = 93;
const CELL_OFFSET = Array.from({ length: CELLS }, (_, i) =>
  i === 58 ? -0.019 : i === 8 ? 0.007 : noise(0.006),
);
const SENSOR_OFFSET = Array.from({ length: 9 }, (_, i) => (i % 3) * 0.6 + noise(0.4));
const car = {
  soc: 0.64, // real state of charge, 0..1
  odometer: 38_412.3,
  batteryTemp: 11.5,
  isolation: 10_239_000, // Ohm
};
const ocv = (soc: number) => CELLS * (3.43 + 0.62 * soc + 0.08 * soc * soc);
const R_PACK = 0.12;

/** Gear byte values of `PT_418h.Gear` (VAL_ in the demo DBC). */
const GEAR = { N: 0, D: 17, R: 187, P: 221 };

/** Signals by message, with the message's cycle in ms (GenMsgCycleTime of the demo DBC). */
type Sample = Record<string, number>;
const MESSAGES: { cycle: number; signals: string[]; charge?: boolean }[] = [
  { cycle: 50, signals: ["VEH_200h.VehSpeed", "VEH_200h.Handbrake"] },
  { cycle: 50, signals: ["BMS_448h.PackVoltage"], charge: true },
  { cycle: 50, signals: ["BMS_508h.PackCurrent", "BMS_508h.ChargePort"], charge: true },
  { cycle: 100, signals: ["BMS_2D5h.SocReal"], charge: true },
  { cycle: 100, signals: ["DASH_318h.Throttle", "DASH_318h.RangeEst"] },
  {
    cycle: 100,
    signals: ["DASH_518h.SocDisplay", "DASH_518h.PilotLimit", "DASH_518h.DriveMode"],
    charge: true,
  },
  { cycle: 100, signals: ["PT_418h.Gear"] },
  { cycle: 200, signals: ["CHG_168h.ChargeActive"], charge: true },
  { cycle: 200, signals: ["HV_3D7h.HvActive"], charge: true },
  {
    cycle: 200,
    signals: [
      "BODY_423h.Ignition",
      "BODY_423h.DoorFL",
      "BODY_423h.DoorFR",
      "BODY_423h.Tailgate",
      "BODY_423h.Headlights",
    ],
  },
  { cycle: 1000, signals: ["ENERGY_3CEh.EnergyStart", "TRIP_504h.TripStart"] },
  { cycle: 1000, signals: ["PWR_3D5h.Bat12V"], charge: true },
  { cycle: 1000, signals: ["ENV_408h.OutsideTemp", "DASH_412h.Odometer"] },
];
const OBL = ["AcVoltage", "AcCurrent", "DcVoltage", "DcCurrent", "ChargerTemp"];

/** Emits every message due in [t, t + step) and the polled BMS and charger values. */
function sampleAll(t: number, step: number, s: Sample, charging: boolean, start: number) {
  for (const m of MESSAGES) {
    if (charging && !m.charge) continue;
    const phase = (t - start) % m.cycle;
    if (phase >= step) continue;
    const at = t + noise(0.4) + 0.4;
    for (const name of m.signals) {
      const value = s[name];
      if (value !== undefined) emit(name, at, value);
    }
  }
  // Polled: cells every 60 s, temperatures every 120 s, health every 300 s, charger every 1 s.
  const since = t - start;
  if (since % 60_000 < step) {
    const cell = (s["BMS_448h.PackVoltage"] ?? 0) / CELLS;
    for (let i = 0; i < CELLS; i++) {
      const spread = charging ? 1 + 2 * Math.max(0, car.soc - 0.85) * 10 : 1;
      emit(
        `BMS_7EFh.CellV_${String(i + 1).padStart(2, "0")}`,
        t + 20 + i * 2,
        round(cell + (CELL_OFFSET[i] ?? 0) * spread + noise(0.0012), 0.001),
      );
    }
  }
  if (since % 120_000 < step) {
    let max = -100;
    for (let i = 0; i < 9; i++) {
      const v = round(car.batteryTemp + (SENSOR_OFFSET[i] ?? 0) + noise(0.1), 1 / 64);
      max = Math.max(max, v);
      emit(`BMS_7EFh.CellT_${i + 1}`, t + 300 + i * 3, v);
    }
    emit("BMS_7EFh.BatTemp", t + 330, max);
  }
  if (since % 300_000 < step) {
    emit("BMS_7EFh.Soh", t + 400, 88);
    emit("BMS_7EFh.CapAvg", t + 404, 45.86);
    emit("BMS_7EFh.Isolation", t + 408, round(car.isolation, 1000));
  }
  if (charging && since % 1000 < step) {
    for (const name of OBL) emit(`OBL_483h.${name}`, t + 500, s[`OBL_483h.${name}`] ?? 0);
  }
}

// --- Drives ------------------------------------------------------------------------------------------
/** A drive as legs of [target km/h, seconds]; 0 is a stop. The last leg's R reverses into a space. */
type Leg = [number, number] | ["R", number];

interface Session {
  chunk: string;
  day: number;
  wake: [number, number, number];
  outside: number;
  /** Minutes after the wake-up the headlights stay on (dark morning). */
  headlights?: number;
  passenger?: boolean;
  tailgate?: boolean;
  bat12Before?: number;
}

const STEP = 10; // ms

async function drive(session: Session, legs: Leg[]) {
  chunk = session.chunk;
  const start = local(session.day, ...session.wake);
  const ignOn = start + 18_000;
  const go = ignOn + 25_000;
  let t = start;
  let v = 0; // m/s
  let trip = 0;
  let energy = 0;
  let leg = 0;
  let legEnd = go + ((legs[0]?.[1] ?? 0) as number) * 1000;
  let parkedAt = 0;
  let ignOff = Number.POSITIVE_INFINITY;
  let end = Number.POSITIVE_INFINITY;
  let throttle = 0;
  let wobble = 0;
  while (t < end) {
    let gear = t >= go - 3000 && parkedAt === 0 ? GEAR.D : GEAR.P;
    let target = 0;
    if (t >= go && parkedAt === 0) {
      if (t >= legEnd) {
        leg++;
        if (leg >= legs.length) {
          parkedAt = t;
          ignOff = t + 22_000;
          end = ignOff + 40_000;
        } else legEnd = t + ((legs[leg]?.[1] ?? 0) as number) * 1000;
      }
      const speed = legs[leg]?.[0];
      if (speed !== undefined && parkedAt === 0) {
        gear = speed === "R" ? GEAR.R : GEAR.D;
        target = speed === "R" ? 6 : speed;
      } else gear = GEAR.P;
    }

    // Speed: chase the target within the car's acceleration, with a slow wobble while cruising.
    wobble += noise(0.02) - wobble * 0.001;
    const vt = Math.max(0, target / 3.6 + (target > 20 ? wobble : 0));
    const dt = STEP / 1000;
    const a = Math.max(-2.6, Math.min(target > 60 ? 1.3 : 2.1, (vt - v) * 0.6));
    v = Math.max(0, v + a * dt);
    if (target === 0 && v < 0.15) v = 0;

    // Power at the pack: road load plus heating and auxiliaries, regeneration down to -20 kW.
    const force = 1000 * a + 0.5 * 1.2 * 0.73 * v * v + (v > 0 ? 0.012 * 1000 * 9.81 : 0);
    let wheel = force * v;
    if (wheel < 0) wheel = v * 3.6 > 8 ? Math.max(wheel * 0.7, -20_000) : 0;
    const aux = t >= ignOn && t < ignOff ? 450 + (session.outside < 10 ? 1400 : 0) : 120;
    const pack = Math.min(55_000, wheel > 0 ? wheel / 0.88 : wheel) + aux;
    const vOcv = ocv(car.soc);
    const amps = pack / vOcv;
    car.soc -= (amps * dt) / 3600 / 52;
    trip += (v * dt) / 1000;
    car.odometer += (v * dt) / 1000;
    energy += (pack * dt) / 3.6e6;
    car.batteryTemp += 0.000_02 * (0.3 + Math.abs(amps) / 40);
    car.isolation += (10_239_000 - car.isolation) * 0.000_01;
    throttle += ((wheel > 0 ? (wheel / 55_000) * 140 : 0) - throttle) * 0.08;

    const display = Math.max(0, Math.min(100, (car.soc * 100 - 3) / 0.95));
    const awake = t >= ignOn && t < ignOff;
    const doorOpen = (t >= start + 4000 && t < start + 10_000) || (ignOff < t && t < ignOff + 7000);
    const s: Sample = {
      "VEH_200h.VehSpeed": round(v * 3.6, 1 / 18),
      "VEH_200h.Handbrake": t < go - 3000 || parkedAt > 0 ? 1 : 0,
      "BMS_448h.PackVoltage": round(vOcv - amps * R_PACK + noise(0.15), 0.1),
      "BMS_508h.PackCurrent": round(-amps + noise(0.3), 0.1),
      "BMS_508h.ChargePort": 0,
      "BMS_2D5h.SocReal": round(car.soc * 100, 0.1),
      "DASH_318h.Throttle": Math.round(Math.max(0, Math.min(100, throttle))),
      "DASH_318h.RangeEst": Math.round(display * 1.22),
      "DASH_518h.SocDisplay": t < ignOn + 300 ? 127.5 : round(display, 0.5),
      "DASH_518h.PilotLimit": 0,
      "DASH_518h.DriveMode": 64,
      "PT_418h.Gear": t < ignOn ? GEAR.P : gear,
      "CHG_168h.ChargeActive": 0,
      "HV_3D7h.HvActive": awake ? 1 : 0,
      "BODY_423h.Ignition": awake ? 1 : 0,
      "BODY_423h.DoorFL": doorOpen ? 1 : 0,
      "BODY_423h.DoorFR": session.passenger && ignOff < t && t < ignOff + 9000 ? 1 : 0,
      "BODY_423h.Tailgate": session.tailgate && ignOff + 8000 < t && t < ignOff + 30_000 ? 1 : 0,
      "BODY_423h.Headlights":
        awake && session.headlights && t < start + session.headlights * 60_000 ? 1 : 0,
      "ENERGY_3CEh.EnergyStart": round(Math.max(0, energy), 0.01),
      "TRIP_504h.TripStart": round(trip, 0.1),
      "PWR_3D5h.Bat12V": round(
        awake ? 14.3 + noise(0.05) : (session.bat12Before ?? 12.6) + noise(0.03),
        0.1,
      ),
      "ENV_408h.OutsideTemp": round(session.outside + 45.5555556, 0.5555556) - 45.5555556,
      "DASH_412h.Odometer": Math.floor(car.odometer),
    };
    sampleAll(t, STEP, s, false, start);
    if (rows.length > 200_000) await flush();
    t += STEP;
  }
  await flush();
}

async function charge(day: number, from: [number, number, number]) {
  chunk = "charge";
  const start = local(day, ...from);
  const on = start + 30_000;
  let t = start;
  let chargerTemp = 16;
  let off = Number.POSITIVE_INFINITY;
  let end = Number.POSITIVE_INFINITY;
  while (t < end) {
    const active = t >= on && t < off;
    const taper = car.soc > 0.93 ? Math.max(0.15, 1 - (car.soc - 0.93) / 0.07) : 1;
    const ac = active ? 15.8 * taper + noise(0.08) : 0;
    const mains = 230.5 + noise(1.2);
    const vOcv = ocv(car.soc);
    const dcPower = ac * mains * 0.92;
    const dcAmps = dcPower / vOcv;
    const packAmps = dcAmps - 0.4;
    const dt = STEP / 1000;
    car.soc = Math.min(1, car.soc + (packAmps * dt) / 3600 / 52);
    car.batteryTemp += active ? 0.000_004_4 : 0;
    chargerTemp += ((active ? 52 : 16) - chargerTemp) * 0.000004;
    if (active && car.soc >= 0.99) {
      off = t;
      end = t + 120_000;
    }
    const display = Math.max(0, Math.min(100, (car.soc * 100 - 3) / 0.95));
    const s: Sample = {
      "BMS_448h.PackVoltage": round(vOcv + packAmps * R_PACK + noise(0.1), 0.1),
      "BMS_508h.PackCurrent": round(packAmps + noise(0.15), 0.1),
      "BMS_508h.ChargePort": 1,
      "BMS_2D5h.SocReal": round(car.soc * 100, 0.1),
      "DASH_518h.SocDisplay": t < start + 300 ? 127.5 : round(display, 0.5),
      "DASH_518h.PilotLimit": 16,
      "DASH_518h.DriveMode": 64,
      "CHG_168h.ChargeActive": active ? 1 : 0,
      "HV_3D7h.HvActive": active ? 1 : 0,
      "PWR_3D5h.Bat12V": round(active ? 14.2 + noise(0.05) : 12.7 + noise(0.03), 0.1),
      "OBL_483h.AcVoltage": round(active ? mains : 0, 0.1),
      "OBL_483h.AcCurrent": round(Math.max(0, ac), 0.1),
      "OBL_483h.DcVoltage": round(active ? vOcv + packAmps * R_PACK : 0, 0.1),
      "OBL_483h.DcCurrent": round(Math.max(0, dcAmps), 0.1),
      "OBL_483h.ChargerTemp": Math.round(chargerTemp),
    };
    sampleAll(t, STEP, s, true, start);
    if (rows.length > 200_000) await flush();
    t += STEP;
  }
  await flush();
}

// --- Schema ---------------------------------------------------------------------------------------------
for (const query of [
  "CREATE DATABASE IF NOT EXISTS demo",
  "DROP TABLE IF EXISTS demo.signals",
  "DROP TABLE IF EXISTS demo.events",
  `CREATE TABLE demo.signals (
    vehicle LowCardinality(String),
    device LowCardinality(String),
    chunk String CODEC(ZSTD(3)),
    signal LowCardinality(String),
    utc Nullable(DateTime64(3, 'UTC')) CODEC(DoubleDelta, ZSTD(3)),
    value Float64 CODEC(Gorilla, ZSTD(3)),
    text LowCardinality(String) DEFAULT ''
  ) ENGINE = MergeTree PARTITION BY vehicle ORDER BY (vehicle, signal, utc)
  SETTINGS allow_nullable_key = 1`,
  `CREATE TABLE demo.events (
    vehicle LowCardinality(String),
    device LowCardinality(String),
    chunk String CODEC(ZSTD(3)),
    utc Nullable(DateTime64(3, 'UTC')) CODEC(DoubleDelta, ZSTD(3)),
    source LowCardinality(String),
    kind LowCardinality(String),
    name String,
    value Float64,
    text String,
    detail String
  ) ENGINE = MergeTree PARTITION BY vehicle ORDER BY (vehicle, kind, source, name, utc)
  SETTINGS allow_nullable_key = 1`,
]) {
  await client.command({ query, clickhouse_settings: { wait_end_of_query: 1 } });
}

// --- Two days ----------------------------------------------------------------------------------------------
const CITY: Leg[] = [
  [30, 25],
  [50, 70],
  [0, 28],
  [50, 95],
  [30, 20],
  [0, 18],
];
const COMMUTE: Leg[] = [
  [30, 20],
  [50, 80],
  [0, 30],
  [50, 60],
  [70, 140],
  [100, 260],
  [120, 90],
  [100, 150],
  [70, 70],
  [50, 90],
  [0, 35],
  [50, 100],
  [30, 40],
  [0, 20],
  [30, 30],
  [0, 4],
  ["R", 7],
  [0, 3],
];
const ERRAND: Leg[] = [...CITY, [50, 120], [0, 40], [50, 80], [30, 30], [0, 3], ["R", 5], [0, 2]];
const HOME: Leg[] = [
  ...CITY,
  [70, 160],
  [100, 300],
  [70, 90],
  [0, 45],
  [50, 140],
  [30, 30],
  [0, 3],
];

await drive({ chunk: "d1", day: 14, wake: [7, 41, 30], outside: 6.2, headlights: 9 }, COMMUTE);
await charge(14, [8, 12, 0]);
car.batteryTemp -= 2.5; // parked after the charge
await drive({ chunk: "d2", day: 14, wake: [12, 38, 10], outside: 13.8, tailgate: true }, ERRAND);
car.batteryTemp -= 1.5;
await drive({ chunk: "d3", day: 14, wake: [17, 30, 40], outside: 11.5, passenger: true }, HOME);
car.batteryTemp = 7.5;
car.isolation = 1_450_000;
const morning = local(15, 7, 48, 0);
await drive(
  { chunk: "d4", day: 15, wake: [7, 48, 0], outside: 3.9, headlights: 14, bat12Before: 11.8 },
  COMMUTE.slice(0, 12).concat([
    [0, 4],
    ["R", 6],
    [0, 3],
  ]),
);

// Events: logger boots, a fault memory read the morning after (generic SAE J2012 codes; the
// value is the DTC status byte), and the isolation warning that matches the low reading.
const events = [
  [local(14, 7, 41, 30), "LOG", "note", "boot", 0, "logger started", ""],
  [local(14, 8, 12, 0), "LOG", "note", "boot", 0, "logger started", ""],
  [local(14, 12, 38, 10), "LOG", "note", "boot", 0, "logger started", ""],
  [local(14, 17, 30, 40), "LOG", "note", "boot", 0, "logger started", ""],
  [morning, "LOG", "note", "boot", 0, "logger started", ""],
  [
    morning + 52_000,
    "BMS",
    "dtc",
    "P0AA6",
    0x09,
    "Hybrid/EV battery voltage system isolation fault",
    "initial",
  ],
  [morning + 52_000, "VCU", "dtc", "P0562", 0x08, "System voltage low", "initial"],
  [morning + 52_000, "VCU", "dtc", "U0100", 0x28, "Lost communication with ECM/PCM A", "initial"],
] as const;
await client.insert({
  table: "demo.events",
  format: "JSONEachRow",
  values: events.map(([ms, source, kind, name, value, text, detail]) => ({
    vehicle: VEHICLE,
    device: "demo-logger",
    chunk: "e1",
    utc: iso(ms),
    source,
    kind,
    name,
    value,
    text,
    detail,
  })),
});

const signals = await (
  await client.query({ query: "SELECT uniq(signal) AS n FROM demo.signals", format: "JSONEachRow" })
).json<{ n: string }>();
console.log(
  `demo seeded: ${inserted.toLocaleString("en")} rows, ${signals[0]?.n} signals, ${events.length} events`,
);
await client.close();
