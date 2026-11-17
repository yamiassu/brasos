import { expect, test } from "bun:test";
import { extensionOrigin } from "@brasos/extension";
import { testHost, type TestHost } from "../../host/src/testing";

// Apps the BrasOS browser extension asks to add: queued for the shell, which shows its own install prompt. Asking installs nothing.
const ask = (h: TestHost, manifestUrl: unknown, origin: string | null = extensionOrigin) =>
  h.at("localhost", "/os/apps/requests", { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify({ manifestUrl }) });
const shell = (h: TestHost) => ({ origin: h.origin("localhost") });
const queue = async (h: TestHost) => ((await (await h.at("localhost", "/os/apps/requests", { headers: shell(h) })).json()) as { requests: { id: string; manifestUrl: string }[] }).requests;

test("the extension's request is queued for the shell, once, and the shell can dismiss it", async () => {
  const h = await testHost();
  expect((await ask(h, "https://notes.example.com/app.webmanifest")).status).toBe(202);
  expect((await ask(h, "https://notes.example.com/app.webmanifest")).status).toBe(202); // the same site again: still one
  expect((await ask(h, "https://other.example.com/m")).status).toBe(202);
  const q = await queue(h);
  expect(q.map((r) => r.manifestUrl)).toEqual(["https://notes.example.com/app.webmanifest", "https://other.example.com/m"]);
  const gone = await h.at("localhost", "/os/apps/requests/dismiss", { method: "POST", headers: { ...shell(h), "content-type": "application/json" }, body: JSON.stringify({ id: q[0].id }) });
  expect(gone.status).toBe(200);
  expect((await queue(h)).map((r) => r.manifestUrl)).toEqual(["https://other.example.com/m"]);
  // the trail records that it happened and which site, never the path
  const e = h.events().filter((x) => x.event === "apps.request");
  expect(e.map((x) => x.detail.host)).toEqual(["notes.example.com", "other.example.com"]);
  expect(JSON.stringify(e)).not.toContain("app.webmanifest");
  h.stop();
});

test("only a plain web address is accepted, and the queue is bounded", async () => {
  const h = await testHost();
  for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "https://a b", "ftp://x", "", 7, null, "https://" + "x".repeat(2100)]) expect((await ask(h, bad)).status).toBe(400);
  for (let i = 0; i < 20; i++) expect((await ask(h, `https://s${i}.example.com/m`)).status).toBe(202);
  expect((await ask(h, "https://one-too-many.example.com/m")).status).toBe(429);
  expect((await ask(h, "https://s3.example.com/m")).status).toBe(202); // one already waiting is not a new one
  expect((await queue(h)).length).toBe(20);
  h.stop();
});

test("nobody but the extension can ask, and the extension can do nothing else", async () => {
  const h = await testHost();
  const url = "https://notes.example.com/m";
  expect((await ask(h, url, `http://about.localhost:${h.port}`)).status).toBe(403); // an app
  expect((await ask(h, url, h.origin("localhost"))).status).toBe(403); // even the shell: it reads the queue, it doesn't fill it
  expect((await ask(h, url, "chrome-extension://abcdefghijklmnopabcdefghijklmnop")).status).toBe(403); // some other extension
  expect((await ask(h, url, "http://evil.example")).status).toBe(403);
  expect((await ask(h, url, null)).status).toBe(403); // no identifiable caller
  expect((await queue(h)).length).toBe(0);
  // the extension holds that one capability and nothing more: it can't read the queue, inspect, install, or touch files
  const asExt = (path: string, init: RequestInit = {}) => h.at("localhost", path, { ...init, headers: { origin: extensionOrigin, "content-type": "application/json" } });
  expect((await asExt("/os/apps/requests")).status).toBe(403);
  expect((await asExt("/os/apps/inspect", { method: "POST", body: JSON.stringify({ manifestUrl: url }) })).status).toBe(403);
  expect((await asExt("/os/apps/install", { method: "POST", body: JSON.stringify({ manifestUrl: url }) })).status).toBe(403);
  expect((await asExt("/os/apps/requests/dismiss", { method: "POST", body: "{}" })).status).toBe(403);
  expect((await asExt("/os/fs/list", { method: "POST", body: JSON.stringify({ path: "/" }) })).status).toBe(403);
  expect((await asExt("/os/native", {})).status).toBe(403);
  expect(h.events().some((e) => e.event === "capability.apps.request" && e.outcome === "deny")).toBe(true);
  // and the browser may call the host from the extension's origin (the preflight answers for exactly that origin)
  const pre = await h.at("localhost", "/os/apps/requests", { method: "OPTIONS", headers: { origin: extensionOrigin, "access-control-request-method": "POST" } });
  expect(pre.headers.get("access-control-allow-origin")).toBe(extensionOrigin);
  h.stop();
});

test("the hardened package refuses it outright", async () => {
  const h = await testHost({ packages: ["hardened"] });
  expect((await ask(h, "https://notes.example.com/m")).status).toBe(403);
  expect((await h.at("localhost", "/os/apps/requests", { headers: shell(h) })).status).toBe(403);
  h.stop();
});
