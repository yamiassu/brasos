import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Bench } from "../../tools/bench-types";

// What an agent pays per call: the MCP round trip for a listing and for a real tool call.
const bench: Bench = async ({ host, repeat }) => {
  const token = readFileSync(join(host.stateDir!, "agent.token"), "utf8").trim();
  let id = 0;
  const rpc = (method: string, params?: unknown) =>
    fetch(`http://localhost:${host.port}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    }).then((r) => r.arrayBuffer());
  await rpc("tools/list");
  return [
    { name: "agent.tools_list", unit: "ms", samples: await repeat(100, () => rpc("tools/list")) },
    { name: "agent.tool_call_fs_list", unit: "ms", samples: await repeat(100, () => rpc("tools/call", { name: "fs_list", arguments: { path: "/" } })) },
  ];
};
export default bench;
