// `bun run bench [--out results.json] [--compare baseline.json]`
// Boots the server on a spare port and measures it. Every component should add a bench here
// (see AGENTS.md "Benchmarking"). Numbers are only comparable on the same machine/platform.
import { join } from "node:path";
import { createAudit } from "../audit";

type Result = { name: string; unit: string; samples: number[] };
const arg = (f: string) => {
  const i = process.argv.indexOf(f);
  return i < 0 ? undefined : process.argv[i + 1];
};
const PORT = 7900 + Math.floor(Math.random() * 100);
const server = Bun.spawn(["bun", "server.ts"], {
  cwd: join(import.meta.dir, ".."),
  env: { ...process.env, PORT: String(PORT) },
  stdout: "pipe",
  stderr: "inherit",
});

const results: Result[] = [];
const record = (name: string, unit: string, samples: number[]) => results.push({ name, unit, samples });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const repeat = async (n: number, fn: () => Promise<unknown>) => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await fn();
    out.push(performance.now() - t);
  }
  return out;
};

try {
  const t0 = performance.now();
  const reader = server.stdout.getReader();
  let log = "";
  while (!log.includes("BrasOS shell on")) {
    const { value, done } = await reader.read();
    if (done) throw new Error("server exited: " + log);
    log += new TextDecoder().decode(value);
  }
  record("server.start_to_ready", "ms", [performance.now() - t0]); // includes bun startup + full app build
  (async () => { while (!(await reader.read()).done); })(); // drain so the server never blocks on a full pipe

  // cost of recording one audit event (hash + serialize), sink excluded
  const audit = createAudit([() => {}]);
  record("audit.emit", "ms", await repeat(2000, async () => audit("bench", "info", { app: "x" }, { n: 1 })));

  const get = (host: string, path = "/") => fetch(`http://${host}:${PORT}${path}`).then((r) => r.arrayBuffer());
  await get("localhost"); // warm up
  record("http.shell_index", "ms", await repeat(200, () => get("localhost")));
  record("http.app_index", "ms", await repeat(200, () => get("terminal.localhost")));
  record("http.api_apps", "ms", await repeat(200, () => get("localhost", "/api/apps")));

  // PTY round trip: send one character, wait for it to be echoed back.
  const ws = new WebSocket(`ws://terminal.localhost:${PORT}/pty`, { headers: { origin: `http://terminal.localhost:${PORT}` } } as any);
  let waiting: ((s: string) => void) | undefined;
  ws.onmessage = (e) => waiting?.(Buffer.from(e.data as ArrayBuffer).toString());
  await new Promise((r) => (ws.onopen = r));
  await sleep(1500); // let the shell print its prompt
  const echo: number[] = [];
  for (let i = 0; i < 50; i++) {
    const t = performance.now();
    const got = new Promise<void>((res) => (waiting = (s) => s.includes("x") && res()));
    ws.send(JSON.stringify({ t: "i", d: "x" }));
    await got;
    echo.push(performance.now() - t);
    await sleep(30);
  }
  waiting = undefined;
  ws.close();
  record("pty.keystroke_echo", "ms", echo);
} finally {
  server.kill();
}

const pct = (s: number[], p: number) => [...s].sort((a, b) => a - b)[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
const stats = (r: Result) => ({ n: r.samples.length, p50: pct(r.samples, 50), p95: pct(r.samples, 95), max: Math.max(...r.samples) });
console.log("name".padEnd(24), "unit", "     n      p50      p95      max");
for (const r of results) {
  const s = stats(r);
  console.log(r.name.padEnd(24), r.unit.padEnd(4), String(s.n).padStart(6), ...[s.p50, s.p95, s.max].map((v) => v.toFixed(2).padStart(8)));
}
const out = arg("--out");
if (out) await Bun.write(out, JSON.stringify({ platform: process.platform, results }, null, 2));

// Regression gate: p50 more than 25% (and 1 unit) worse than the baseline fails the run.
const compare = arg("--compare");
if (compare) {
  const base = await Bun.file(compare).json();
  let bad = 0;
  for (const r of results) {
    const b = base.results.find((x: Result) => x.name === r.name);
    if (!b) continue;
    const now = stats(r).p50, was = stats(b).p50;
    if (now > was * 1.25 && now - was > 1) {
      console.log(`REGRESSION ${r.name}: p50 ${was.toFixed(2)} -> ${now.toFixed(2)} ${r.unit}`);
      bad++;
    }
  }
  process.exit(bad ? 1 : 0);
}
process.exit(0);
