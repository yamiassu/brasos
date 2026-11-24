import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testHost, type TestHost } from "../../host/src/testing";

let h: TestHost;
let outside: string;
beforeAll(async () => {
  h = await testHost();
  outside = mkdtempSync(join(tmpdir(), "brasos-outside-"));
  writeFileSync(join(outside, "secret.txt"), "TOP SECRET");
});
afterAll(() => (h.stop(), rmSync(outside, { recursive: true, force: true })));

/** call /os/fs/<op> as the page at `from` (the Files app holds fs.read + fs.write; the shell only fs.read) */
const fs = (op: string, body: unknown, from = "files.localhost") =>
  h.at("localhost", `/os/fs/${op}`, {
    method: "POST",
    headers: { origin: h.origin(from), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ok = async (op: string, body: unknown, from?: string) => {
  const r = await fs(op, body, from);
  expect(r.status).toBe(200);
  return r.json() as Promise<any>;
};

test("a fresh home has the standard folders", async () => {
  expect((await ok("list", { path: "/" })).map((e: any) => e.name)).toEqual(["Desktop", "Documents", "Downloads"]);
});

test("create, read, overwrite, list, move", async () => {
  await ok("write", { path: "/Documents/a.txt", content: "hello" });
  expect(await ok("read", { path: "/Documents/a.txt" })).toMatchObject({ content: "hello", encoding: "utf8", size: 5, truncated: false });
  await ok("write", { path: "/Documents/a.txt", content: "hello world" });
  await ok("mkdir", { path: "/Documents/sub" });
  await ok("move", { from: "/Documents/a.txt", to: "/Documents/sub/b.txt" });
  const list = await ok("list", { path: "/Documents" });
  expect(list.map((e: any) => [e.name, e.kind])).toEqual([["sub", "dir"]]); // a.txt is gone
  expect((await ok("list", { path: "/Documents/sub" }))[0]).toMatchObject({ name: "b.txt", kind: "file", size: 11 });
});

test("binary files come back as base64 and big reads are truncated", async () => {
  await ok("write", { path: "/Downloads/bin", content: Buffer.from([0xff, 0xfe, 0x00, 0x80]).toString("base64"), encoding: "base64" });
  expect(await ok("read", { path: "/Downloads/bin" })).toMatchObject({ encoding: "base64", content: "//4AgA==" });
  await ok("write", { path: "/Downloads/long", content: "x".repeat(2000) });
  expect(await ok("read", { path: "/Downloads/long", maxBytes: 100 })).toMatchObject({ truncated: true, size: 2000 });
});

test("delete goes to the trash, which is hidden from the root listing", async () => {
  await ok("write", { path: "/Desktop/old.txt", content: "bye" });
  const { path } = await ok("delete", { path: "/Desktop/old.txt" });
  expect(path).toMatch(/^\/\.trash\/\d+-old\.txt$/);
  expect((await ok("list", { path: "/Desktop" })).length).toBe(0);
  expect((await ok("read", { path })).content).toBe("bye");
  expect((await ok("list", { path: "/" })).map((e: any) => e.name)).not.toContain(".trash");
  expect((await fs("delete", { path: "/" })).status).toBe(400);
  expect((await fs("delete", { path })).status).toBe(400); // can't delete from the trash
});

test("the trash lists what was deleted and where from, restores it, and deletes it for good", async () => {
  await ok("purge", { all: true });
  await ok("mkdir", { path: "/Documents/proj" });
  await ok("write", { path: "/Documents/proj/plan.md", content: "plan" });
  await ok("write", { path: "/Desktop/a.txt", content: "one" });
  const a = (await ok("delete", { path: "/Desktop/a.txt" })).path.slice("/.trash/".length);
  const p = (await ok("delete", { path: "/Documents/proj" })).path.slice("/.trash/".length);
  let t = await ok("trash", {});
  expect(t.map((e: any) => e.from).sort()).toEqual(["/Desktop/a.txt", "/Documents/proj"]);
  expect(t.find((e: any) => e.name === p)).toMatchObject({ kind: "dir", deleted: expect.any(Number) });
  expect((await ok("list", { path: "/.trash" })).map((e: any) => e.name)).not.toContain(".from"); // the bookkeeping stays hidden
  // a file of the same name was made meanwhile: the restored one becomes "a (2).txt"
  await ok("write", { path: "/Desktop/a.txt", content: "new" });
  expect(await ok("restore", { name: a })).toMatchObject({ path: "/Desktop/a (2).txt" });
  expect((await ok("read", { path: "/Desktop/a (2).txt" })).content).toBe("one");
  // its folder is gone: it's made again
  expect(await ok("restore", { name: p })).toMatchObject({ path: "/Documents/proj" });
  expect((await ok("read", { path: "/Documents/proj/plan.md" })).content).toBe("plan");
  // deleting forever: one, then all
  const x = (await ok("delete", { path: "/Desktop/a.txt" })).path.slice("/.trash/".length);
  await ok("write", { path: "/Desktop/b.txt", content: "b" });
  await ok("delete", { path: "/Desktop/b.txt" });
  expect(await ok("purge", { name: x })).toEqual({ removed: 1 });
  expect((await ok("trash", {})).length).toBe(1);
  expect(await ok("purge", { all: true })).toEqual({ removed: 1 });
  expect(await ok("trash", {})).toEqual([]);
  // names outside the trash are refused
  for (const name of ["", "..", "../Desktop", ".from", "a/b", 5, null]) {
    expect((await fs("restore", { name })).status).toBe(400);
    expect((await fs("purge", { name })).status).toBe(400);
  }
  expect((await fs("purge", { name: "123-nothing" })).status).toBe(404);
  expect((await ok("list", { path: "/Documents" })).map((e: any) => e.name)).toContain("proj"); // still there
});

test("an item deleted before origins were recorded goes back to the home", async () => {
  await ok("write", { path: "/Desktop/legacy.txt", content: "old" });
  const name = (await ok("delete", { path: "/Desktop/legacy.txt" })).path.slice("/.trash/".length);
  rmSync(join(h.stateDir, "home", ".trash", ".from", name));
  expect((await ok("trash", {})).find((e: any) => e.name === name).from).toBeNull();
  expect(await ok("restore", { name })).toMatchObject({ path: "/legacy.txt" });
  await ok("delete", { path: "/legacy.txt" });
});

test("the hardened package refuses the trash too", async () => {
  const hh = await testHost({ packages: ["hardened"] });
  for (const [op, body] of [["trash", {}], ["restore", { name: "1-x" }], ["purge", { all: true }]] as const)
    expect((await hh.at("localhost", `/os/fs/${op}`, { method: "POST", headers: { origin: hh.origin("files.localhost"), "content-type": "application/json" }, body: JSON.stringify(body) })).status).toBe(403);
  hh.stop();
});

test("restoring never follows a link out of the home", async () => {
  await ok("mkdir", { path: "/Documents/gone" });
  await ok("write", { path: "/Documents/gone/f.txt", content: "f" });
  const name = (await ok("delete", { path: "/Documents/gone/f.txt" })).path.slice("/.trash/".length);
  await ok("delete", { path: "/Documents/gone" });
  try {
    symlinkSync(outside, join(h.stateDir, "home", "Documents", "gone"), "junction");
  } catch {
    return;
  }
  expect((await fs("restore", { name })).status).toBe(403);
  rmSync(join(h.stateDir, "home", "Documents", "gone"));
});

test("paths that try to climb out are contained or refused", async () => {
  // ".." collapses at the root, so these name files *inside* the home (that don't exist)
  for (const p of ["/../../etc/passwd", "../../../etc/passwd", "/Documents/../../../x"]) expect((await fs("read", { path: p })).status).toBe(404);
  for (const p of ["a\\b", "x\0y", "", "/" + "a".repeat(300), 5, null]) expect((await fs("read", { path: p })).status).toBe(400);
});

test("overwriting folders, existing destinations and moving a folder into itself are refused", async () => {
  expect((await fs("write", { path: "/Documents", content: "x" })).status).toBe(409);
  await ok("mkdir", { path: "/Documents/d1" });
  expect((await fs("mkdir", { path: "/Documents/d1" })).status).toBe(409);
  await ok("write", { path: "/Documents/f", content: "1" });
  expect((await fs("move", { from: "/Documents/f", to: "/Documents/d1" })).status).toBe(409);
  expect((await fs("move", { from: "/Documents/d1", to: "/Documents/d1/inside" })).status).toBe(400);
  expect((await fs("write", { path: "/Documents/huge", content: "x".repeat(5 * 1024 * 1024 + 1) })).status).toBe(413);
});

test("a symlink inside the home can't lead outside it", async () => {
  try {
    symlinkSync(outside, join(h.stateDir, "home", "Documents", "link"), "junction");
  } catch {
    return; // this machine can't create links; the lexical checks above still ran
  }
  expect((await fs("list", { path: "/Documents/link" })).status).toBe(403);
  expect((await fs("read", { path: "/Documents/link/secret.txt" })).status).toBe(403);
  expect((await fs("write", { path: "/Documents/link/new.txt", content: "x" })).status).toBe(403);
  expect((await fs("move", { from: "/Documents/f", to: "/Documents/link/f" })).status).toBe(403);
});

test("only apps holding the permission may touch files; the shell can read but not write", async () => {
  expect((await fs("list", { path: "/" }, "about.localhost")).status).toBe(403);
  expect((await fs("list", { path: "/" }, "terminal.localhost")).status).toBe(403);
  const anonymous = await h.at("localhost", "/os/fs/list", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "/" }) });
  expect(anonymous.status).toBe(403); // no caller identity
  expect((await fs("list", { path: "/" }, "localhost")).status).toBe(200);
  expect((await fs("write", { path: "/Desktop/x", content: "y" }, "localhost")).status).toBe(403);
  for (const op of ["restore", "purge"]) expect((await fs(op, { all: true, name: "x" }, "localhost")).status).toBe(403); // emptying the trash is a write
  expect((await fs("purge", { all: true }, "about.localhost")).status).toBe(403);
  const evil = await h.at("localhost", "/os/fs/list", { method: "POST", headers: { origin: "http://evil.com", "content-type": "application/json" }, body: JSON.stringify({ path: "/" }) });
  expect(evil.status).toBe(403);
});

test("changes are audited; reads are throttled instead of flooding the trail", async () => {
  for (let i = 0; i < 20; i++) await ok("list", { path: "/" });
  const e = h.events();
  expect(e.filter((x) => x.event === "fs.change").map((x) => x.detail.op)).toEqual(expect.arrayContaining(["write", "mkdir", "move", "delete"]));
  expect(e.filter((x) => x.event === "capability.fs.read" && x.outcome === "allow").length).toBeLessThan(10);
  expect(e.some((x) => x.event === "capability.fs.read" && x.outcome === "deny")).toBe(true);
});

test("without a home, files are unavailable (503)", async () => {
  const none = await testHost({ stateDir: undefined });
  try {
    const r = await none.at("localhost", "/os/fs/list", { method: "POST", headers: { origin: none.origin("files.localhost"), "content-type": "application/json" }, body: JSON.stringify({ path: "/" }) });
    expect(r.status).toBe(503);
  } finally {
    none.stop();
  }
});
