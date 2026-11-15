import type { Bench } from "../../tools/bench-types";

// the status read every shell start makes, and a refused (no permission) completion; not login: argon2 is slow on purpose
const bench: Bench = async ({ host, repeat }) => [
  { name: "setup.status", unit: "ms", samples: await repeat(100, () => fetch(`http://localhost:${host.port}/os/setup`).then((r) => r.arrayBuffer())) },
  {
    name: "setup.complete_denied",
    unit: "ms",
    samples: await repeat(100, () =>
      fetch(`http://localhost:${host.port}/os/setup/complete`, { method: "POST", headers: { origin: `http://about.localhost:${host.port}` }, body: "{}" }).then((r) => r.arrayBuffer())),
  },
];
export default bench;
