import type { Bench } from "../../tools/bench-types";

const bench: Bench = async ({ host, repeat }) => {
  const get = (h: string, path = "/", init?: RequestInit) => fetch(`http://${h}:${host.port}${path}`, init).then((r) => r.arrayBuffer());
  const shell = { headers: { "sec-fetch-site": "same-origin" } };
  await get("localhost"); // warm up
  return [
    { name: "host.shell_index", unit: "ms", samples: await repeat(200, () => get("localhost")) },
    { name: "host.app_index", unit: "ms", samples: await repeat(200, () => get("terminal.localhost")) },
    { name: "host.sdk_bundle", unit: "ms", samples: await repeat(200, () => get("localhost", "/__brasos/sdk.js")) },
    { name: "registry.list", unit: "ms", samples: await repeat(200, () => get("localhost", "/os/apps", shell)) },
  ];
};
export default bench;
