import type { Bench } from "../../tools/bench-types";

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
export default bench;
