import type { Bench } from "../../tools/bench-types";

const bench: Bench = async ({ host, repeat }) => {
  const as = (app: string) => ({ origin: `http://${app}.localhost:${host.port}`, "content-type": "application/json" });
  const fs = (op: string, body: unknown, app = "files") =>
    fetch(`http://localhost:${host.port}/os/fs/${op}`, { method: "POST", headers: as(app), body: JSON.stringify(body) }).then((r) => r.arrayBuffer());
  await fs("mkdir", { path: "/Documents/bench" }).catch(() => {});
  for (let i = 0; i < 200; i++) await fs("write", { path: `/Documents/bench/f${i}.txt`, content: "x".repeat(100) });
  const big = "y".repeat(100 * 1024);
  return [
    { name: "files.list_200", unit: "ms", samples: await repeat(100, () => fs("list", { path: "/Documents/bench" })) },
    { name: "files.read_100kb", unit: "ms", samples: await repeat(100, () => fs("write", { path: "/Documents/bench/big.txt", content: big }).then(() => fs("read", { path: "/Documents/bench/big.txt" }))) },
    { name: "files.write_small", unit: "ms", samples: await repeat(100, () => fs("write", { path: "/Documents/bench/w.txt", content: "hello" })) },
    // the Trash app opening on a trash of 200 items, and one delete + restore round trip
    { name: "files.trash_list_200", unit: "ms", samples: await (async () => {
      await fs("purge", { all: true });
      for (let i = 0; i < 200; i++) await fs("delete", { path: `/Documents/bench/f${i}.txt` });
      const s = await repeat(100, () => fs("trash", {}));
      await fs("purge", { all: true });
      return s;
    })() },
    { name: "files.trash_restore", unit: "ms", samples: await repeat(50, async () => {
      const r = await fetch(`http://localhost:${host.port}/os/fs/delete`, { method: "POST", headers: as("files"), body: JSON.stringify({ path: "/Documents/bench/w.txt" }) }).then((x) => x.json());
      await fs("restore", { name: r.path.slice("/.trash/".length) });
    }) },
  ];
};
export default bench;
