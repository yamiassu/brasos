import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testHost, type TestHost } from "../../../packages/host/src/testing";
import { groupProcs, parseCpu, parseMem, parseStat, readMachine } from "../server";

// a fake /proc: stat line fields 3.. are `state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt utime stime ... rss(24)`
const statLine = (pid: number, comm: string, ticks: number, rssPages: number) => {
  const f = Array(50).fill("0");
  f[0] = "S"; f[11] = String(ticks); f[12] = "0"; f[21] = String(rssPages);
  return `${pid} (${comm}) ${f.join(" ")}`;
};
const fakeProc = (procs: [number, string, number, number][], cpuLine = "cpu  100 0 100 700 100 0 0 0 0 0") => {
  const root = mkdtempSync(join(tmpdir(), "brasos-proc-"));
  writeFileSync(join(root, "stat"), `${cpuLine}\ncpu0 1 2 3\n`);
  writeFileSync(join(root, "meminfo"), "MemTotal:        4194304 kB\nMemFree:  100 kB\nMemAvailable:    1048576 kB\n");
  for (const [pid, comm, ticks, rss] of procs) (mkdirSync(join(root, String(pid))), writeFileSync(join(root, String(pid), "stat"), statLine(pid, comm, ticks, rss)));
  return root;
};

test("the /proc parsers: names with spaces and parentheses, jiffies, memory", () => {
  expect(parseStat(statLine(7, "Web Content (x)", 40, 250))).toEqual({ comm: "Web Content (x)", ticks: 40, rssPages: 250 });
  expect(parseStat("garbage")).toBeNull();
  expect(parseCpu("cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1")).toEqual({ total: 1000, idle: 800 });
  expect(parseMem("MemTotal:  4096 kB\nMemAvailable:  1024 kB\n")).toEqual({ totalKB: 4096, availKB: 1024 });
});

test("processes are grouped by program, with CPU as a share of the whole machine", () => {
  const root = fakeProc([[10, "bun", 150, 25600], [11, "chromium", 50, 51200], [12, "chromium", 50, 51200], [13, "kworker", 5, 0]]);
  const m = readMachine(root);
  expect(m.procs.length).toBe(4);
  const g = groupProcs(m, new Map([[10, 100], [11, 40], [12, 40]]), 1000, -1);
  const by = Object.fromEntries(g.map((x) => [x.id, x]));
  expect(by.bun).toMatchObject({ name: "BrasOS host", kind: "system", cpu: 5, mem: 100, count: 1 });
  expect(by.chromium).toMatchObject({ kind: "app", cpu: 2, mem: 400, count: 2 }); // two renderers, (10+10)/1000 = 2 %
  expect(by.kworker.kind).toBe("system");
  expect(by.kworker.cpu).toBe(0); // no earlier sample for it yet
});

let h: TestHost;
let hardened: TestHost;
let root: string;
let child: ReturnType<typeof Bun.spawn> | undefined;
beforeAll(async () => {
  child = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 60000)"], { stdout: "ignore", stderr: "ignore" });
  root = fakeProc([[process.pid, "bun", 1, 100], [child.pid, "victim", 1, 100]]);
  process.env.BRASOS_PROC_ROOT = root;
  h = await testHost();
  hardened = await testHost({ packages: ["hardened"] });
});
afterAll(() => (h.stop(), hardened.stop(), child?.kill()));
const own = (host: TestHost, id: string) => `http://${id}.localhost:${host.port}`;
const call = (host: TestHost, as: string, path: string, init: RequestInit = {}) =>
  fetch(`${own(host, "task-manager")}${path}`, { ...init, headers: { origin: own(host, as), "content-type": "application/json" } });

test("the Task Manager reads the list; other apps and foreign pages are refused", async () => {
  const ok = await call(h, "task-manager", "/processes");
  expect(ok.status).toBe(200);
  const d = await ok.json();
  expect(d.sample).toBe(false);
  expect(d.memTotal).toBe(4096);
  expect(d.memUsed).toBe(3072);
  expect(d.procs.map((p: any) => p.id)).toContain("bun");
  expect((await call(h, "about", "/processes")).status).toBe(403);
  expect((await call(h, "about", "/end", { method: "POST", body: JSON.stringify({ id: "victim" }) })).status).toBe(403);
  expect((await fetch(`${own(h, "task-manager")}/processes`, { headers: { origin: "http://evil.com" } })).status).toBe(403);
  // a page's own GET (no Origin, Sec-Fetch-Site) is identified; a cross-site one is not
  expect((await fetch(`${own(h, "task-manager")}/processes`, { headers: { "sec-fetch-site": "same-origin" } })).status).toBe(200);
  expect((await fetch(`${own(h, "task-manager")}/processes`, { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
});

test("the hardened package has no task manager at all", async () => {
  const apps = await hardened.at("localhost", "/os/apps", { headers: { origin: hardened.origin("localhost") } });
  expect((await apps.json()).map((a: any) => a.id)).not.toContain("task-manager");
  expect((await call(hardened, "task-manager", "/processes")).status).not.toBe(200);
});

test("ending a task: never the host, never what is not running, and it is audited", async () => {
  const end = (id: unknown) => call(h, "task-manager", "/end", { method: "POST", body: JSON.stringify({ id }) });
  expect((await end("bun")).status).toBe(403); // the host itself
  expect((await end("nothing-called-this")).status).toBe(404);
  expect((await end(7)).status).toBe(404);
  if (!process.getuid) return; // ending is Linux/macOS: elsewhere the host has no user id to compare
  expect((await end("victim")).status).toBe(200);
  await child!.exited;
  const e = h.events();
  expect(e.some((x) => x.event === "processes.end" && x.detail.name === "victim" && x.detail.count === 1)).toBe(true);
  expect(e.some((x) => x.event === "capability.processes.end" && x.outcome === "deny")).toBe(true);
});
