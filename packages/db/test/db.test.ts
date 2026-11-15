import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { testHost, type TestHost } from "../../host/src/testing";

/** an installed PWA on `origin` holding `permissions`, as the registry stores it; returns the origin a request from it carries */
async function pwa(h: TestHost, id: string, origin: string, permissions: string[]) {
  mkdirSync(join(h.stateDir, "apps"), { recursive: true });
  writeFileSync(join(h.stateDir, "apps", id + ".json"), JSON.stringify({ id, kind: "pwa", name: id, icon: "globe", start_url: origin + "/", permissions }));
  // the gateway derives the site id (subdomain) from the real origin
  const r = await h.at("localhost", "/os/web/open", { method: "POST", headers: { origin: h.origin("localhost"), "content-type": "application/json" }, body: JSON.stringify({ url: origin + "/" }) });
  return new URL((await r.json()).url).origin;
}
const call = (h: TestHost, from: string, path: string, body?: unknown) =>
  h.at("localhost", path, { method: body === undefined ? "GET" : "POST", headers: { origin: from, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const shell = (h: TestHost) => h.origin("localhost");

test("put, get, list, delete in the caller's own space", async () => {
  const h = await testHost();
  const s = shell(h);
  const put = await (await call(h, s, "/os/db/put", { col: "notes", id: "a", doc: { title: "one", n: 1, done: false } })).json();
  expect(put).toEqual({ id: "a", rev: 1 });
  expect((await (await call(h, s, "/os/db/put", { col: "notes", id: "a", doc: { title: "uno", n: 1, done: false } })).json()).rev).toBe(2);
  await call(h, s, "/os/db/put", { col: "notes", id: "b", doc: { title: "two", n: 2, done: true } });
  expect((await (await call(h, s, "/os/db/get", { col: "notes", id: "a" })).json()).doc.title).toBe("uno");
  const all = await (await call(h, s, "/os/db/list", { col: "notes", order: { field: "n", dir: "desc" } })).json();
  expect(all.items.map((i: any) => i.id)).toEqual(["b", "a"]);
  expect((await (await call(h, s, "/os/db/list", { col: "notes", where: { done: true } })).json()).items.map((i: any) => i.id)).toEqual(["b"]);
  expect(await (await call(h, s, "/os/db/delete", { col: "notes", id: "a" })).json()).toEqual({ ok: true, existed: true });
  expect((await call(h, s, "/os/db/get", { col: "notes", id: "a" })).status).toBe(404);
  h.stop();
});

test("an app's own space is private; shared is shared; both need their grant", async () => {
  const h = await testHost({ gateway: { allowPrivate: true } });
  const a = await pwa(h, "pwa-aaaaaaaaaaaa", "http://127.0.0.1:5001", ["db.own", "db.shared"]);
  const b = await pwa(h, "pwa-bbbbbbbbbbbb", "http://127.0.0.1:5002", ["db.own"]);
  const c = await pwa(h, "pwa-cccccccccccc", "http://127.0.0.1:5003", []);
  await call(h, a, "/os/db/put", { col: "x", id: "k", doc: { v: "a's" } });
  expect((await call(h, b, "/os/db/get", { col: "x", id: "k" })).status).toBe(404); // b's own space is empty
  expect((await call(h, shell(h), "/os/db/get", { col: "x", id: "k" })).status).toBe(404);
  await call(h, a, "/os/db/put", { space: "shared", col: "x", id: "k", doc: { v: "shared" } });
  expect((await call(h, b, "/os/db/get", { space: "shared", col: "x", id: "k" })).status).toBe(403); // b has no db.shared
  expect((await (await call(h, shell(h), "/os/db/get", { space: "shared", col: "x", id: "k" })).json()).doc.v).toBe("shared");
  expect((await call(h, c, "/os/db/put", { col: "x", doc: {} })).status).toBe(403); // no grant, no access
  expect((await call(h, "http://about.localhost:" + new URL(shell(h)).port, "/os/db/put", { col: "x", doc: {} })).status).toBe(403); // a built-in without the permission
  expect((await h.at("localhost", "/os/db/put", { method: "POST", body: "{}" })).status).toBe(403); // no identifiable caller
  expect(h.events().some((e) => e.event === "capability.db.own" && e.outcome === "deny")).toBe(true);
  h.stop();
});

test("a website that is not an installed PWA gets nothing, whatever it claims", async () => {
  const h = await testHost({ gateway: { allowPrivate: true } });
  const r = await h.at("localhost", "/os/web/open", { method: "POST", headers: { origin: shell(h), "content-type": "application/json" }, body: JSON.stringify({ url: "http://127.0.0.1:5009/" }) });
  const site = new URL((await r.json()).url).origin;
  expect((await call(h, site, "/os/db/put", { col: "x", doc: {} })).status).toBe(403);
  h.stop();
});

test("input is validated: names, where, sizes; collections can't reach other tables", async () => {
  const h = await testHost();
  const s = shell(h);
  for (const col of ["", "a b", "x;drop table docs", "../x", "a".repeat(200)]) expect((await call(h, s, "/os/db/put", { col, doc: {} })).status).toBe(400);
  expect((await call(h, s, "/os/db/list", { col: "c", where: { "a') OR 1=1 --": 1 } })).status).toBe(400);
  expect((await call(h, s, "/os/db/list", { col: "c", order: { field: "x; y" } })).status).toBe(400);
  expect((await call(h, s, "/os/db/put", { col: "c", id: "bad id!", doc: {} })).status).toBe(400);
  expect((await call(h, s, "/os/db/put", { col: "c", doc: { big: "x".repeat(300 * 1024) } })).status).toBe(413);
  expect((await call(h, s, "/os/db/put", { col: "c", space: "global", doc: {} })).status).toBe(400);
  expect((await (await call(h, s, "/os/db/list", { col: "sqlite_master" })).json()).items).toEqual([]); // just an empty collection of ours
  h.stop();
});

test("changes stream to watchers that may read them, and only those", async () => {
  const h = await testHost({ gateway: { allowPrivate: true } });
  const a = await pwa(h, "pwa-aaaaaaaaaaaa", "http://127.0.0.1:5001", ["db.own", "db.shared"]);
  const b = await pwa(h, "pwa-bbbbbbbbbbbb", "http://127.0.0.1:5002", ["db.own", "db.shared"]);
  const open = async (from: string, q: string) => {
    const res = await call(h, from, "/os/db/events?" + q);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("access-control-allow-origin")).toBe(from); // an app on another origin may listen
    const reader = res.body!.getReader();
    const got: any[] = [];
    (async () => {
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) return;
        buf += new TextDecoder().decode(value);
        for (let i; (i = buf.indexOf("\n\n")) >= 0; ) {
          const m = buf.slice(0, i).match(/^data: (.*)$/m);
          buf = buf.slice(i + 2);
          if (m) got.push(JSON.parse(m[1]));
        }
      }
    })();
    return { got, close: () => reader.cancel() };
  };
  const wa = await open(a, "col=todos");
  const wb = await open(b, "space=shared");
  await Bun.sleep(50);
  await call(h, a, "/os/db/put", { col: "todos", id: "1", doc: { t: "x" } }); // a's own: only a hears it
  await call(h, a, "/os/db/put", { col: "other", id: "1", doc: {} }); // another collection: filtered out
  await call(h, a, "/os/db/put", { space: "shared", col: "chat", id: "m", doc: { t: "hi" } }); // shared: b hears it
  await call(h, a, "/os/db/delete", { col: "todos", id: "1" });
  await Bun.sleep(100);
  expect(wa.got).toEqual([
    { op: "put", space: "own", col: "todos", id: "1", rev: 1, doc: { t: "x" } },
    { op: "delete", space: "own", col: "todos", id: "1", rev: 2 },
  ]);
  expect(wb.got).toEqual([{ op: "put", space: "shared", col: "chat", id: "m", rev: 1, doc: { t: "hi" } }]);
  const c = await pwa(h, "pwa-cccccccccccc", "http://127.0.0.1:5003", ["db.own"]);
  expect((await call(h, c, "/os/db/events?space=shared")).status).toBe(403); // no grant, no stream
  wa.close();
  wb.close();
  h.stop();
});

test("the hardened package denies the database entirely", async () => {
  const h = await testHost({ packages: ["hardened"] });
  expect((await call(h, shell(h), "/os/db/put", { col: "c", doc: {} })).status).toBe(403);
  expect((await call(h, shell(h), "/os/db/events")).status).toBe(403);
  h.stop();
});
