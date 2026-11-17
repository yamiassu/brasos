// Web gateway: loads websites through the host so each one gets its own origin (<id>.web.localhost, a secure context, so
// service workers and PWAs work), TypeScript files are served as JavaScript, and every web request passes one audited,
// SSRF-checked chokepoint. Known limits are marked `shortcut:`.
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { json, text, type Ctx, type Slice } from "@brasos/host/types";
import { assertPublicHost, BlockedError, isPrivateIp } from "./address";

const MAX_BODY = 25 * 1024 * 1024;
const MAX_REQUEST = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
// framing/CSP/isolation headers would break the embedding and the injected SDK; the rest is transport detail we re-derive
const STRIPPED = new Set([
  "content-security-policy", "content-security-policy-report-only", "x-frame-options", "cross-origin-opener-policy",
  "cross-origin-embedder-policy", "cross-origin-resource-policy", "strict-transport-security", "alt-svc", "report-to", "nel",
  "link", "content-length", "content-encoding", "transfer-encoding", "connection",
]);
// Sites build absolute URLs to their own origin in script (an API base, an asset CDN path). From the gateway origin that is a
// cross-origin request the real site rejects, so requests to the real origin made by fetch, XHR, EventSource and sendBeacon are
// pointed back at the gateway origin. Other origins are left alone (they are cross-origin on the web too).
const SELF_ORIGIN_SHIM = `(function(){var R=window.__BRASOS_SITE__,L=location.origin;if(!R)return;
function m(u){try{var x=new URL(u,location.href);return x.origin===R?L+x.pathname+x.search+x.hash:u}catch(e){return u}}
var F=window.fetch;if(F)window.fetch=function(i,o){if(typeof i==="string"||i instanceof URL)i=m(String(i));else if(i&&i.url){var n=m(i.url);if(n!==i.url)i=new Request(n,i)}return F.call(this,i,o)};
var Q=window.XMLHttpRequest,X=Q&&Q.prototype.open;if(X)Q.prototype.open=function(){arguments[1]=m(String(arguments[1]));return X.apply(this,arguments)};
var E=window.EventSource;if(E)window.EventSource=function(u,o){return new E(m(String(u)),o)};window.EventSource&&(window.EventSource.prototype=E.prototype);
var B=navigator.sendBeacon;if(B)navigator.sendBeacon=function(u,d){return B.call(navigator,m(String(u)),d)}})();`;
const ABSOLUTE = /^\s*(https?:)?\/\//i;
const TS_PATH = /\.(m|c)?ts$/;

export type GatewayOptions = {
  /** where the stable site-id key lives; without it ids change on every restart */
  stateDir?: string;
  /** tests only: lets the gateway reach loopback upstreams */
  allowPrivate?: boolean;
  /** cap on distinct sites per process: every absolute link in a page registers one, so a hostile page could otherwise grow the table forever */
  maxSites?: number;
};

const capped = (body: ReadableStream<Uint8Array> | null, max = MAX_BODY) =>
  body &&
  body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, c) {
        if ((max -= chunk.length) < 0) c.error(new Error("response too large"));
        else c.enqueue(chunk);
      },
    }),
  );

export const readText = (res: Response, max = MAX_BODY) => new Response(capped(res.body, max)).text();

function loadSecret(stateDir?: string): string {
  if (!stateDir) return randomBytes(32).toString("hex");
  const file = join(stateDir, "gateway.key");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(stateDir, { recursive: true });
  const secret = randomBytes(32).toString("hex");
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function createGateway(opts: GatewayOptions = {}) {
  const secret = loadSecret(opts.stateDir);
  const sites = new Map<string, string>(); // site id -> real origin; the id is an HMAC, so it can't be guessed or chosen
  const idOf = (origin: string) => createHmac("sha256", secret).update(origin).digest("hex").slice(0, 32);

  /** syntactic checks only; the network-level (DNS/address) check happens at fetch time */
  function parseSite(raw: string): URL {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("only http(s) URLs");
    if (u.username || u.password) throw new Error("credentials in URLs are not allowed");
    const literal = u.hostname.replace(/^\[|\]$/g, "");
    if (!opts.allowPrivate && isIP(literal) && isPrivateIp(literal)) throw new Error("private address");
    return u;
  }
  const register = (u: URL) => {
    const id = idOf(u.origin);
    if (!sites.has(id) && sites.size >= (opts.maxSites ?? 10_000)) throw new Error("too many sites open");
    sites.set(id, u.origin);
    return id;
  };
  const toGateway = (u: URL, port: string) =>
    `http://${register(u)}.web.localhost${port ? ":" + port : ""}${u.pathname}${u.search}${u.hash}`;
  const mapUrl = (u: URL, port: string) => {
    try {
      return toGateway(parseSite(u.href), port);
    } catch {
      return null;
    }
  };

  /** the only function that talks to the network on behalf of a page; checks the address, bounds time, and re-checks every redirect it follows */
  async function fetchPublic(url: URL, init: RequestInit & { follow?: number } = {}): Promise<Response> {
    const { follow = 0, ...rest } = init;
    await assertPublicHost(url.hostname, opts.allowPrivate);
    const res = await fetch(url, { ...rest, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const loc = res.headers.get("location");
    if (follow > 0 && loc && res.status >= 300 && res.status < 400) {
      return fetchPublic(parseSite(new URL(loc, url).href), { ...rest, follow: follow - 1 });
    }
    return res;
  }

  // A site runs in an iframe under the desktop, which is a different site from its gateway origin, so the browser treats every cookie
  // as third-party: a cookie with no SameSite (or Lax/Strict) is never stored or sent there, and every cookie sign-in failed. Domain is
  // dropped (it names the real site), and the cookie is made SameSite=None; Secure; Partitioned (a browser accepts Secure cookies on
  // *.localhost, and partitioned ones even where third-party cookies are limited).
  const rewriteCookie = (c: string) =>
    [...c.split(";").map((s) => s.trim()).filter((p) => p && !/^(domain|secure|partitioned|samesite)(=|$)/i.test(p)), "SameSite=None", "Secure", "Partitioned"].join("; ");

  // shortcut: only href/src/action/poster/formaction are rewritten. srcset, CSS url(), and URLs built in script keep pointing
  // at the real site; the browser policy in the hardened package blocks those, and dev lets them through.
  function rewriteHtml(res: Response, upstream: URL, port: string): Response {
    const inject =
      `<script>window.__BRASOS_SITE__=${JSON.stringify(upstream.origin).replace(/</g, "\\u003c")}</script>` +
      `<script>${SELF_ORIGIN_SHIM}</script>` +
      `<script src="/__brasos/sdk.js"></script>`;
    return new HTMLRewriter()
      .on("html", { element: (el) => void el.prepend(inject, { html: true }) })
      .on("meta[http-equiv]", { element: (el) => /content-security-policy/i.test(el.getAttribute("http-equiv") ?? "") && el.remove() })
      .on("[href],[src],[action],[poster],[formaction]", {
        element(el) {
          for (const a of ["href", "src", "action", "poster", "formaction"]) {
            const v = el.getAttribute(a);
            const mapped = v && ABSOLUTE.test(v) ? mapUrl(new URL(v.trim().replace(/^\/\//, upstream.protocol + "//"), upstream), port) : null;
            if (mapped) el.setAttribute(a, mapped);
          }
        },
      })
      .transform(res);
  }

  async function proxy(req: Request, ctx: Ctx, id: string): Promise<Response> {
    const origin = sites.get(id);
    if (!origin) return text("unknown site: open it from the browser first", 404);
    if (!["GET", "HEAD", "POST"].includes(req.method)) return text("method not allowed", 405);
    const port = ctx.url.port;
    const upstream = new URL(ctx.url.pathname + ctx.url.search, origin);

    const headers = new Headers();
    for (const h of ["accept", "accept-language", "content-type", "cookie", "range", "if-none-match", "if-modified-since", "user-agent"]) {
      const v = req.headers.get(h);
      if (v) headers.set(h, v);
    }
    // A page on its gateway origin talking to itself is, to the real site, a same-origin request, and sites (server functions,
    // CSRF guards) refuse requests that do not say so. The browser sets Sec-Fetch-* where a page can't forge it, so it is
    // translated, not copied: same-origin stays, a request from another gateway site (or any other site) is cross-site.
    const fetchSite = req.headers.get("sec-fetch-site");
    if (fetchSite) headers.set("sec-fetch-site", fetchSite === "same-origin" || fetchSite === "none" ? fetchSite : "cross-site");
    for (const h of ["sec-fetch-mode", "sec-fetch-dest", "sec-fetch-user"]) {
      const v = req.headers.get(h);
      if (v) headers.set(h, v);
    }
    // the app's own request headers (framework markers, CSRF tokens, bearer tokens) go to the app's own site; forwarding
    // identifiers are never sent, so the real site can't see BrasOS or the local address
    for (const [k, v] of req.headers) if ((k.startsWith("x-") && !/^x-(forwarded|real-ip)|brasos/.test(k)) || k === "authorization") headers.set(k, v);
    headers.set("referer", origin + "/"); // shortcut: the real Referer path is not forwarded
    if (req.method === "POST") headers.set("origin", origin);

    let res: Response;
    try {
      const body = req.method === "POST" ? await readBounded(req) : undefined;
      res = await fetchPublic(upstream, { method: req.method, headers, body });
    } catch (e) {
      const blocked = e instanceof BlockedError;
      ctx.audit(blocked ? "web.blocked" : "web.error", "deny", { site: upstream.hostname.slice(0, 100) }, { reason: (e as Error).message.slice(0, 100) }, { key: "web.blocked", ms: 5000 });
      return text(blocked ? `blocked: ${(e as Error).message}` : `upstream error: ${(e as Error).message}`, blocked ? 403 : 502);
    }
    ctx.audit("web.site", "allow", { site: upstream.hostname.slice(0, 100) }, {}, { key: `web.site:${id}`, ms: 60_000 });

    const out = new Headers();
    for (const [k, v] of res.headers) if (!STRIPPED.has(k) && k !== "set-cookie" && k !== "location") out.set(k, v);
    for (const c of res.headers.getSetCookie()) out.append("set-cookie", rewriteCookie(c));
    const loc = res.headers.get("location");
    if (loc) out.set("location", mapUrl(new URL(loc, upstream), port) ?? "about:blank#blocked");

    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    const dest = req.headers.get("sec-fetch-dest") ?? "";
    const bodyless = req.method === "HEAD" || res.status === 204 || res.status === 304;

    // `.ts` is also the MPEG video extension: only transpile when the browser is loading a script (or, with no hint, when it isn't media)
    const isScript = dest === "script" || dest === "worker" || dest === "sharedworker" || (dest === "" && !/^(video|audio)\//.test(type));
    if (res.status === 200 && TS_PATH.test(upstream.pathname) && isScript && !bodyless) {
      try {
        // shortcut: .ts/.mts/.cts only. .tsx needs a JSX runtime the browser can't resolve without an import map.
        const js = new Bun.Transpiler({ loader: "ts" }).transformSync(await readText(res));
        out.set("content-type", "text/javascript; charset=utf-8");
        return new Response(js, { status: 200, headers: out });
      } catch (e) {
        return text(`TypeScript error in ${upstream.pathname}: ${(e as Error).message}`, 502);
      }
    }
    const stream = bodyless ? null : capped(res.body);
    const response = new Response(stream, { status: res.status, headers: out });
    return type.includes("text/html") && stream ? rewriteHtml(response, upstream, port) : response;
  }

  async function readBounded(req: Request) {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_REQUEST) throw new Error("request body too large");
    return buf;
  }

  const slice: Slice = {
    name: "web-gateway",
    async handle(req, ctx) {
      if (ctx.target.kind === "site") return proxy(req, ctx, ctx.target.id);

      if (ctx.target.kind === "shell" && ctx.url.pathname === "/os/web/open" && req.method === "POST") {
        const g = ctx.gate("web.open");
        if (!g.ok) return g.res;
        let u: URL;
        let url: string;
        try {
          u = parseSite(String((await req.json().catch(() => null))?.url));
          await assertPublicHost(u.hostname, opts.allowPrivate);
          url = toGateway(u, ctx.url.port); // registers the site (and enforces the cap)
        } catch (e) {
          ctx.audit("web.open", "deny", {}, { reason: (e as Error).message.slice(0, 100) }, { key: "web.open-deny", ms: 1000 });
          return json({ error: (e as Error).message }, e instanceof BlockedError ? 403 : 400);
        }
        ctx.audit("web.open", "allow", { site: u.hostname.slice(0, 100) }, {}, { key: "web.open", ms: 1000 });
        return json({ url, site: u.origin });
      }
    },
  };

  return { slice, fetchPublic, parseSite, register, /** the site id (the subdomain) a real origin gets */ idOf };
}

export type Gateway = ReturnType<typeof createGateway>;
