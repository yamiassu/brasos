import type { Bench } from "../../tools/bench-types";

const bench: Bench = async ({ host, repeat }) => {
  const url = (p: string) => `http://localhost:${host.port}/os/db/${p}`;
  const headers = { origin: `http://localhost:${host.port}`, "content-type": "application/json" };
  const post = (p: string, body: unknown) => fetch(url(p), { method: "POST", headers, body: JSON.stringify(body) }).then((r) => r.arrayBuffer());
  let i = 0;
  const put = await repeat(300, () => post("put", { col: "bench", id: "k" + (i++ % 100), doc: { n: i, text: "hello" } }));
  const get = await repeat(300, () => post("get", { col: "bench", id: "k5" }));
  const list = await repeat(200, () => post("list", { col: "bench", where: { text: "hello" }, order: { field: "n", dir: "desc" }, limit: 50 }));
  const denied = await repeat(200, () => fetch(url("put"), { method: "POST", headers: { ...headers, origin: `http://about.localhost:${host.port}` }, body: "{}" }).then((r) => r.arrayBuffer()));
  return [
    { name: "db.put", unit: "ms", samples: put },
    { name: "db.get", unit: "ms", samples: get },
    { name: "db.list_100", unit: "ms", samples: list },
    { name: "db.put_denied", unit: "ms", samples: denied },
  ];
};
export default bench;
