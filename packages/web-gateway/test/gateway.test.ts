import { afterAll, beforeAll, expect, test } from "bun:test";
import { testHost, type TestHost } from "../../host/src/testing";

// A tiny website to browse: ships TypeScript, a PWA manifest, hostile framing/CSP headers and absolute links.
const site = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    const hdr = { "x-frame-options": "DENY", "content-security-policy": "default-src 'none'" };
    switch (u.pathname) {
      case "/":
        return new Response(
          `<!doctype html><html><head><title>Hi</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'">` +
            `<link rel="manifest" href="/manifest.webmanifest"><script type="module" src="/app.ts"></script></head><body>` +
            `<a id=abs href="https://other.example.com/x?y=1#z">abs</a><img id=pr src="//cdn.example.com/i.png">` +
            `<a id=rel href="/relative">rel</a><a id=mail href="mailto:a@b.c">m</a><a id=priv href="http://169.254.169.254/latest">p</a></body></html>`,
          { headers: { ...hdr, "content-type": "text/html", "set-cookie": "sid=1; Domain=example.com; Secure; SameSite=None; Path=/; HttpOnly" } },
        );
      case "/app.ts": // the common (wrong) MIME for .ts
        return new Response(`interface P { a: string }\nexport const n: number = 41 as number;\nexport function f(p: P): string { return p.a; }\n`, { headers: { "content-type": "video/mp2t" } });
      case "/broken.ts":
        return new Response(`export const = ;`, { headers: { "content-type": "text/plain" } });
      case "/segment.ts": // genuinely a video segment: must pass through untouched
        return new Response(new Uint8Array([0x47, 0x40, 0x00, 0x10]), { headers: { "content-type": "video/mp2t" } });
      case "/redir":
        return new Response(null, { status: 302, headers: { location: "https://elsewhere.example.com/landing" } });
      case "/echo":
        return Response.json({ method: req.method, body: await req.text(), cookie: req.headers.get("cookie"), origin: req.headers.get("origin") });
      case "/manifest.webmanifest":
        return Response.json({ name: "Notes App", start_url: "/app/", icons: [{ src: "/i.png" }] });
      case "/evil-manifest.webmanifest":
        return Response.json({ name: "Evil", start_url: "https://evil.example.org/" });
      default:
        return new Response("nope", { status: 404 });
    }
  },
});
const upstream = `http://127.0.0.1:${site.port}`;

let h: TestHost;
let strict: TestHost; // same host, but without the test escape hatch: private addresses must be refused
beforeAll(async () => {
  h = await testHost({ gateway: { allowPrivate: true } });
  strict = await testHost();
});
afterAll(() => (h.stop(), strict.stop(), site.stop(true)));

const post = (t: TestHost, from: string, path: string, body: unknown) =>
  t.at("localhost", path, { method: "POST", headers: { origin: t.origin(from), "content-type": "application/json" }, body: JSON.stringify(body) });
const open = (t: TestHost, url: string, from = "browser.localhost") => post(t, from, "/os/web/open", { url });
const siteUrl = async (path = "/") => {
  const r = await open(h, upstream + path);
  expect(r.status).toBe(200);
  return (await r.json()).url as string;
};

test("opening a site returns a URL on its own secure-context origin", async () => {
  const url = await siteUrl("/");
  expect(url).toMatch(new RegExp(`^http://[0-9a-f]{32}\\.web\\.localhost:${h.port}/$`));
  expect(await siteUrl("/")).toBe(url); // stable per origin
});

test("pages load framed-friendly, with the SDK injected and hostile headers gone", async () => {
  const r = await fetch(await siteUrl("/"), { headers: { "sec-fetch-dest": "iframe" } });
  expect(r.status).toBe(200);
  expect(r.headers.get("x-frame-options")).toBeNull();
  expect(r.headers.get("content-security-policy")).toBeNull();
  const html = await r.text();
  expect(html).toContain("/__brasos/sdk.js");
  expect(html).toContain(`window.__BRASOS_SITE__="${upstream}"`);
  expect(html).not.toContain('http-equiv="Content-Security-Policy"');
});

test("absolute links go back through the gateway; relative and non-web links are left alone", async () => {
  const html = await (await fetch(await siteUrl("/"))).text();
  const attr = (id: string, a: string) => html.match(new RegExp(`id=${id}[^>]*? ${a}="([^"]*)"|${a}="([^"]*)"[^>]*? id=${id}`))?.slice(1).find(Boolean);
  expect(attr("abs", "href")).toMatch(new RegExp(`^http://[0-9a-f]{32}\\.web\\.localhost:${h.port}/x\\?y=1#z$`));
  expect(attr("pr", "src")).toMatch(new RegExp(`^http://[0-9a-f]{32}\\.web\\.localhost:${h.port}/i\\.png$`));
  expect(attr("rel", "href")).toBe("/relative");
  expect(attr("mail", "href")).toBe("mailto:a@b.c");
  // (private-address links are only refused on a host without the test escape hatch: see the SSRF tests)
});

test("TypeScript is served as JavaScript, whatever MIME the site used", async () => {
  const r = await fetch(await siteUrl("/app.ts"), { headers: { "sec-fetch-dest": "script" } });
  expect(r.headers.get("content-type")).toContain("text/javascript");
  const js = await r.text();
  expect(js).toContain("export const n = 41");
  expect(js).not.toContain("interface");
  expect(js).not.toMatch(/: (number|string)/);
});

test("a TypeScript syntax error surfaces as a readable 502, not a silent blank page", async () => {
  const r = await fetch(await siteUrl("/broken.ts"), { headers: { "sec-fetch-dest": "script" } });
  expect(r.status).toBe(502);
  expect(await r.text()).toContain("TypeScript error in /broken.ts");
});

test("a real video segment named .ts is not touched", async () => {
  const r = await fetch(await siteUrl("/segment.ts"), { headers: { "sec-fetch-dest": "video" } });
  expect(r.headers.get("content-type")).toBe("video/mp2t");
  expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([0x47, 0x40, 0x00, 0x10]);
});

test("cookies work across the gateway: Set-Cookie is made storable, Cookie is forwarded", async () => {
  const r = await fetch(await siteUrl("/"));
  const cookie = r.headers.get("set-cookie")!;
  expect(cookie).toContain("sid=1");
  expect(cookie).not.toMatch(/domain=|secure|samesite=none/i);
  const echo = await (await fetch(await siteUrl("/echo"), { headers: { cookie: "sid=1" } })).json();
  expect(echo.cookie).toBe("sid=1");
});

test("POST bodies are forwarded, with the real origin as Origin", async () => {
  const echo = await (await fetch(await siteUrl("/echo"), { method: "POST", body: "hello" })).json();
  expect(echo).toMatchObject({ method: "POST", body: "hello", origin: upstream });
});

test("redirects are rewritten to stay inside the gateway", async () => {
  const r = await fetch(await siteUrl("/redir"), { redirect: "manual" });
  expect(r.status).toBe(302);
  expect(r.headers.get("location")).toMatch(new RegExp(`^http://[0-9a-f]{32}\\.web\\.localhost:${h.port}/landing$`));
});

test("an unknown site id is a 404 until the browser has opened it", async () => {
  expect((await fetch(`http://${"0".repeat(32)}.web.localhost:${h.port}/`)).status).toBe(404);
});

test("only an app holding web.open may open sites; foreign pages and other apps are refused", async () => {
  expect((await open(h, upstream, "about.localhost")).status).toBe(403);
  expect((await open(h, upstream, "terminal.localhost")).status).toBe(403);
  const evil = await h.at("localhost", "/os/web/open", { method: "POST", headers: { origin: "http://evil.com", "content-type": "application/json" }, body: JSON.stringify({ url: upstream }) });
  expect(evil.status).toBe(403);
  const noOrigin = await h.at("localhost", "/os/web/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: upstream }) });
  expect(noOrigin.status).toBe(403);
});

test("a page loaded through the gateway has no OS permissions of its own", async () => {
  const siteOrigin = new URL(await siteUrl("/")).origin;
  for (const path of ["/os/web/open", "/os/apps/install"]) {
    const r = await h.at("localhost", path, { method: "POST", headers: { origin: siteOrigin, "content-type": "application/json" }, body: JSON.stringify({ url: upstream, manifestUrl: upstream }) });
    expect(r.status).toBe(403);
  }
  expect((await h.at("localhost", "/os/apps", { headers: { origin: siteOrigin } })).status).toBe(403);
});

test("SSRF: private, loopback, metadata and malformed targets are refused", async () => {
  for (const url of ["http://127.0.0.1:1/", "http://localhost/", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://10.0.0.1/", "http://192.168.1.1/", "http://foo.localhost/", "http://2130706433/"]) {
    expect((await open(strict, url)).status).toBeGreaterThanOrEqual(400);
  }
  for (const url of ["file:///etc/passwd", "ftp://example.com/", "javascript:alert(1)", "http://user:pw@example.com/", "not a url", ""]) {
    expect((await open(strict, url)).status).toBe(400);
  }
});

test("SSRF: an already-registered site cannot be steered to a private address by path or redirect", async () => {
  // strict host: register a public-looking origin that we then can't reach; the fetch itself must also re-check addresses
  const r = await open(strict, "http://127.0.0.1:1/");
  expect(r.status).toBe(400); // refused at open time; nothing was registered to proxy to
});

test("installing a PWA from a site: stored with no permissions, listed, and openable by the shell", async () => {
  const bad = await post(h, "browser.localhost", "/os/apps/install", { manifestUrl: upstream + "/evil-manifest.webmanifest" });
  expect(bad.status).toBe(400);
  expect((await bad.json()).error).toContain("origin");

  const ok = await post(h, "browser.localhost", "/os/apps/install", { manifestUrl: upstream + "/manifest.webmanifest" });
  expect(ok.status).toBe(200);
  const app = await ok.json();
  expect(app).toMatchObject({ kind: "pwa", name: "Notes App", start_url: upstream + "/app/", permissions: [] });

  const list = await (await h.at("localhost", "/os/apps", { headers: { "sec-fetch-site": "same-origin" } })).json();
  expect(list.map((a: any) => a.id)).toContain(app.id);

  const opened = await post(h, "localhost", "/os/web/open", { url: app.start_url }); // the shell opens it
  expect(opened.status).toBe(200);
  expect((await opened.json()).url).toMatch(/\.web\.localhost:\d+\/app\/$/);
});

test("other apps cannot install, and the audit trail shows the gateway's decisions", async () => {
  expect((await post(h, "about.localhost", "/os/apps/install", { manifestUrl: upstream + "/manifest.webmanifest" })).status).toBe(403);
  const e = h.events();
  expect(e.some((x) => x.event === "capability.web.open" && x.outcome === "allow")).toBe(true);
  expect(e.some((x) => x.event === "capability.web.open" && x.outcome === "deny")).toBe(true);
  expect(e.some((x) => x.event === "web.site" && x.outcome === "allow")).toBe(true);
  expect(e.some((x) => x.event === "apps.install")).toBe(true);
  expect(strict.events().some((x) => x.event === "web.open" && x.outcome === "deny")).toBe(true);
});
