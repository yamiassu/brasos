import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { testHost, type TestHost } from "../../host/src/testing";
import { hardened } from "../src";

let h: TestHost;
beforeAll(async () => (h = await testHost({ packages: ["hardened"], gateway: { allowPrivate: true } })));
afterAll(() => h.stop());

const asApp = (id: string) => ({ headers: { origin: `http://${id}.localhost:${h.port}` } });
const shell = { headers: { "sec-fetch-site": "same-origin" } };
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("the package is on, and says so", async () => {
  expect(await (await h.at("localhost", "/os/info", shell)).json()).toEqual({ os: "brasos", packages: ["hardened"] });
});

test("apps are default-deny: only those that opt in are listed or served", async () => {
  expect((await (await h.at("localhost", "/os/apps", shell)).json()).map((a: any) => a.id)).toEqual(["about", "docs"]);
  expect((await h.at("about.localhost")).status).toBe(200);
  for (const id of ["terminal", "crash-test", "browser", "files"]) expect((await h.at(`${id}.localhost`)).status).toBe(404);
});

test("the terminal is gone: no origin, and the PTY is refused for everyone", async () => {
  const ws = (host: string, origin: string) =>
    new Promise<string>((resolve) => {
      const s = new WebSocket(`ws://${host}:${h.port}/pty`, { headers: { origin } } as any);
      s.onopen = () => resolve("OPENED");
      s.onerror = () => resolve("REJECTED");
      setTimeout(() => resolve("TIMEOUT"), 3000);
    });
  expect(await ws("terminal.localhost", `http://terminal.localhost:${h.port}`)).toBe("REJECTED");
  expect(await ws("about.localhost", `http://about.localhost:${h.port}`)).toBe("REJECTED");
});

test("the web gateway and app installing are off, even for the shell and for the app that would hold the permission", async () => {
  // allowPrivate is on here on purpose: only the package's policy can be what refuses these
  expect((await h.at("localhost", "/os/web/open", { ...json({ url: "https://example.com" }), headers: { origin: `http://localhost:${h.port}`, "content-type": "application/json" } })).status).toBe(403);
  expect((await h.at("localhost", "/os/web/open", { ...json({ url: "https://example.com" }), headers: { origin: `http://browser.localhost:${h.port}`, "content-type": "application/json" } })).status).toBe(403);
  expect((await h.at("localhost", "/os/apps/install", { ...json({ manifestUrl: "https://example.com/m" }), headers: { origin: `http://browser.localhost:${h.port}`, "content-type": "application/json" } })).status).toBe(403);
});

test("the shell can still list apps (apps.read is one of two capabilities left on)", async () => {
  expect((await h.at("localhost", "/os/apps", { headers: { origin: `http://localhost:${h.port}` } })).status).toBe(200);
});

test("the guides stay readable: docs.read is the other capability left on", async () => {
  const get = (path: string) => h.at("localhost", path, { headers: { origin: `http://docs.localhost:${h.port}` } });
  expect((await get("/os/docs")).status).toBe(200);
  expect((await h.at("localhost", "/os/docs", asApp("about"))).status).toBe(403); // still needs the permission
});

test("agents are off: even a valid token is refused, and nothing is exposed to relay to", async () => {
  const token = readFileSync(join(h.stateDir, "agent.token"), "utf8").trim();
  const r = await h.at("localhost", "/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  expect(r.status).toBe(403);
  const ui = await new Promise<string>((resolve) => {
    const ws = new WebSocket(`ws://localhost:${h.port}/os/agent/ui`, { headers: { origin: `http://localhost:${h.port}` } } as any);
    ws.onopen = () => resolve("OPEN");
    ws.onerror = () => resolve("REFUSED");
    setTimeout(() => resolve("TIMEOUT"), 3000);
  });
  expect(ui).toBe("REFUSED");
});

test("files are off for everyone, the shell included", async () => {
  const fs = (from: string) => h.at("localhost", "/os/fs/list", { method: "POST", headers: { origin: from, "content-type": "application/json" }, body: JSON.stringify({ path: "/" }) });
  expect((await fs(`http://localhost:${h.port}`)).status).toBe(403);
  expect((await fs(`http://files.localhost:${h.port}`)).status).toBe(403);
});

test("the PTY route does not exist at all (the terminal's server code is never loaded)", async () => {
  expect((await h.at("about.localhost", "/pty", { headers: { origin: `http://about.localhost:${h.port}` } })).status).toBe(404);
});

test("denials are audited", () => {
  const denied = h.events().filter((e) => e.outcome === "deny").map((e) => e.event);
  expect(denied).toContain("app.unknown"); // the terminal origin
  expect(denied).toContain("capability.web.open");
  expect(denied).toContain("capability.apps.install");
  expect(denied).toContain("capability.agent.call");
  expect(denied).toContain("capability.fs.read");
});

test("the policy is only ever restrictive", () => {
  expect(hardened.allowCapability?.("apps.read")).toBe(true);
  expect(hardened.allowCapability?.("docs.read")).toBe(true);
  for (const cap of ["pty", "web.open", "apps.install", "apps.uninstall", "fs.read", "fs.write", "agent.call", "ui.control", "ui.host", "anything.new"]) expect(hardened.allowCapability?.(cap)).toBe(false);
  expect(hardened.allowApp?.({ name: "x" })).toBe(false);
  expect(hardened.allowApp?.({ name: "x", brasos: { hardened: true } })).toBe(true);
});

test("the NixOS module exists and enables itself only through its option", () => {
  const nix = readFileSync(join(import.meta.dir, "../module.nix"), "utf8");
  expect(nix).toContain("options.brasos.hardened.enable");
  expect(nix).toContain("lib.mkIf cfg.enable");
});
