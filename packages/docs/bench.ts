import type { Bench } from "../../tools/bench-types";

const bench: Bench = async ({ host, repeat }) => {
  const get = (path: string) =>
    fetch(`http://localhost:${host.port}${path}`, { headers: { origin: `http://docs.localhost:${host.port}` } }).then((r) => r.arrayBuffer());
  await get("/os/docs/welcome");
  return [
    { name: "docs.list", unit: "ms", samples: await repeat(100, () => get("/os/docs")) },
    { name: "docs.render_page", unit: "ms", samples: await repeat(100, () => get("/os/docs/sdk-reference")) },
  ];
};
export default bench;
