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
