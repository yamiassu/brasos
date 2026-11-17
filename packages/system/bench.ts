import type { Bench } from "../../tools/bench-types";

// the refused path (no permission): what a hostile page pays per attempt; the real restart is not benchmarked
const bench: Bench = async ({ host, repeat }) => [
  {
    name: "system.restart_denied",
    unit: "ms",
    samples: await repeat(100, () =>
      fetch(`http://localhost:${host.port}/os/system/restart`, { method: "POST", headers: { origin: `http://about.localhost:${host.port}` } }).then((r) => r.arrayBuffer())),
  },
  {
    name: "system.new_app_denied",
    unit: "ms",
    samples: await repeat(100, () =>
      fetch(`http://localhost:${host.port}/os/system/app`, { method: "POST", headers: { origin: `http://about.localhost:${host.port}` }, body: "{}" }).then((r) => r.arrayBuffer())),
  },
];
export default bench;
