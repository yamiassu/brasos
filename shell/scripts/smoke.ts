// `bun run test`: boots the shell server on a spare port and checks the contracts other code relies on.
import { join } from "node:path";

const PORT = 7100 + Math.floor(Math.random() * 800);
const root = join(import.meta.dir, "..");
const server = Bun.spawn(["bun", "server.ts"], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT) },
  stdout: "pipe",
  stderr: "inherit",
});

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${detail}`}`);
  if (!ok) failed++;
};
const at = (host: string, path = "/", init?: RequestInit) => fetch(`http://${host}:${PORT}${path}`, init);

try {
  // wait for the server's ready line (the first build can take a few seconds)
  const reader = server.stdout.getReader();
  const deadline = Date.now() + 60_000;
  let log = "";
  while (!log.includes("BrasOS shell on") && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    log += new TextDecoder().decode(value);
  }
  check("server starts", log.includes("BrasOS shell on"), log);

  const apps = await (await at("localhost", "/api/apps")).json();
  check("/api/apps lists terminal", apps.some((a: any) => a.id === "terminal"));
  check("shell served", (await at("localhost")).status === 200);
  check("app served on its own origin", (await at("terminal.localhost")).status === 200);
  check("unknown app 404", (await at("nope.localhost")).status === 404);
  check("foreign Host rejected", (await at("localhost", "/", { headers: { host: "evil.com" } })).status === 403);
  check("app origins cannot read /api/apps", (await at("terminal.localhost", "/api/apps")).status === 404);

  const pty = (origin: string, host = "terminal.localhost") =>
    new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://${host}:${PORT}/pty`, { headers: { origin } } as any);
      let out = "";
      ws.onerror = () => resolve("REJECTED");
      ws.onopen = () => ws.send(JSON.stringify({ t: "i", d: "echo BRAS_OK\r" }));
      ws.onmessage = (e) => {
        out += Buffer.from(e.data as ArrayBuffer).toString();
        if (out.includes("BRAS_OK\r\n") || out.split("BRAS_OK").length > 2) {
          ws.close();
          resolve(out);
        }
      };
      setTimeout(() => resolve("TIMEOUT"), 8000);
    });
  check("PTY works from the terminal app origin", (await pty(`http://terminal.localhost:${PORT}`)).includes("BRAS_OK"));
  check("PTY rejects a foreign Origin", (await pty("http://evil.com")) === "REJECTED");
  check("PTY rejects other apps", (await pty(`http://hello.localhost:${PORT}`, "hello.localhost")) === "REJECTED");
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
