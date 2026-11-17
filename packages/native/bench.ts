import { createServer } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Bench } from "../../tools/bench-types";
import { readThumb } from "./src/native";

// the refused path (no permission), and the shell's poll with no compositor: what the shell pays every second
const bench: Bench = async ({ host, repeat }) => [
  {
    name: "native.list_denied",
    unit: "ms",
    samples: await repeat(100, () => fetch(`http://localhost:${host.port}/os/native`, { headers: { origin: `http://about.localhost:${host.port}` } }).then((r) => r.arrayBuffer())),
  },
  {
    name: "native.list_unavailable",
    unit: "ms",
    samples: await repeat(100, () => fetch(`http://localhost:${host.port}/os/native`, { headers: { origin: `http://localhost:${host.port}` } }).then((r) => r.arrayBuffer())),
  },
];

// the picture of a window for the switcher: connect, ask, wait for the line, check it (a 224 x 140 picture is about 125 KB of base64)
const thumb: Bench = async ({ repeat }) => {
  const path = join(mkdtempSync(join(tmpdir(), "brasos-bench-")), "t.sock");
  const rgb = Buffer.alloc(224 * 140 * 3, 9).toString("base64");
  const srv = createServer((s) => {
    s.write('{"windows":[]}\n');
    s.on("data", () => s.write(JSON.stringify({ thumb: 5, w: 224, h: 140, rgb }) + "\n"));
  }).listen(path);
  const samples = await repeat(60, () => readThumb(path, 5));
  srv.close();
  return [{ name: "native.thumb_read", unit: "ms", samples }];
};
export const benches = [bench, thumb];
export default async (ctx: Parameters<Bench>[0]) => (await Promise.all(benches.map((b) => b(ctx)))).flat();
