// `bun run test`: boots the shell server once per profile on a spare port and checks the contracts other code relies on.
import { join } from "node:path";

const root = join(import.meta.dir, "..");
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${detail}`}`);
  if (!ok) failed++;
};

async function run(profile: "dev" | "hardened") {
  console.log(`-- profile: ${profile}`);
  const PORT = 7100 + Math.floor(Math.random() * 800);
  const server = Bun.spawn(["bun", "server.ts"], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), BRASOS_PROFILE: profile },
    stdout: "pipe",
    stderr: "inherit",
  });
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

    const apps: { id: string }[] = await (await at("localhost", "/api/apps")).json();
    const ids = apps.map((a) => a.id);
    check("/api/profile reports the profile", (await (await at("localhost", "/api/profile")).json()).profile === profile);
    check("shell served", (await at("localhost")).status === 200);
    check("about app served on its own origin", (await at("about.localhost")).status === 200);
    check("unknown app 404", (await at("nope.localhost")).status === 404);
    check("foreign Host rejected", (await at("localhost", "/", { headers: { host: "evil.com" } })).status === 403);
    check("app origins cannot read /api/apps", (await at("about.localhost", "/api/apps")).status === 404);
    check("app list is sorted", ids.join() === [...ids].sort().join());

    const pty = (origin: string, host: string) =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(`ws://${host}:${PORT}/pty`, { headers: { origin } } as any);
        let out = "";
        ws.onerror = () => resolve("REJECTED");
        ws.onopen = () => ws.send(JSON.stringify({ t: "i", d: "echo BRAS_OK\r" }));
        ws.onmessage = (e) => {
          out += Buffer.from(e.data as ArrayBuffer).toString();
          if (out.split("BRAS_OK").length > 2) {
            ws.close();
            resolve(out);
          }
        };
        setTimeout(() => resolve("TIMEOUT"), 8000);
      });
    const term = `terminal.localhost`;
    const termOrigin = `http://${term}:${PORT}`;
    check("PTY rejects a foreign Origin", (await pty("http://evil.com", term)) === "REJECTED");
    check("PTY rejects other apps", (await pty(`http://about.localhost:${PORT}`, "about.localhost")) === "REJECTED");

    if (profile === "dev") {
      check("dev apps present", ids.includes("terminal") && ids.includes("hello"));
      check("PTY works from the terminal app origin", (await pty(termOrigin, term)).includes("BRAS_OK"));
    } else {
      // default deny: hardened ships only apps that opted in, and never a PTY
      check("only opted-in apps are listed", ids.join() === "about", ids.join());
      check("dev app origins are gone", (await at("terminal.localhost")).status === 404);
      check("PTY refused even from the terminal origin", (await pty(termOrigin, term)) === "REJECTED");
    }
  } finally {
    server.kill();
  }
}

await run("dev");
await run("hardened");
process.exit(failed ? 1 : 0);
