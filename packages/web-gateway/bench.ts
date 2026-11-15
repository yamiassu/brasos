import type { Bench } from "../../tools/bench-types";

// Latency added by the gateway in front of a local upstream: pass-through, HTML rewriting, and TypeScript transpiling.
const bench: Bench = async ({ host, repeat }) => {
  const html = `<!doctype html><html><head><title>b</title></head><body>${'<a href="https://example.com/x">x</a>'.repeat(200)}</body></html>`;
  const ts = `export const n: number = 1;\n`.repeat(200);
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) => {
      const p = new URL(req.url).pathname;
      return p === "/page" ? new Response(html, { headers: { "content-type": "text/html" } })
        : p === "/m.ts" ? new Response(ts, { headers: { "content-type": "video/mp2t" } })
        : new Response("x".repeat(10_000), { headers: { "content-type": "text/plain" } });
    },
  });
  try {
    const open = async (path: string) =>
      (await (await fetch(`http://localhost:${host.port}/os/web/open`, {
        method: "POST",
        headers: { origin: `http://browser.localhost:${host.port}`, "content-type": "application/json" },
        body: JSON.stringify({ url: `http://127.0.0.1:${upstream.port}${path}` }),
      })).json()).url as string;
    const [plain, page, mod] = [await open("/plain"), await open("/page"), await open("/m.ts")];
    const get = (url: string, dest = "") => fetch(url, { headers: dest ? { "sec-fetch-dest": dest } : {} }).then((r) => r.arrayBuffer());
    await get(page);
    return [
      { name: "gateway.passthrough", unit: "ms", samples: await repeat(100, () => get(plain)) },
      { name: "gateway.html_rewrite", unit: "ms", samples: await repeat(100, () => get(page, "iframe")) },
      { name: "gateway.ts_transpile", unit: "ms", samples: await repeat(100, () => get(mod, "script")) },
    ];
  } finally {
    upstream.stop(true);
  }
};
export default bench;
