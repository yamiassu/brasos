import { afterAll, beforeAll, expect, test } from "bun:test";
import { testHost, type TestHost } from "../../../packages/host/src/testing";

let h: TestHost;
beforeAll(async () => (h = await testHost()));
afterAll(() => h.stop());

/** open /pty on `host` as a page at `origin`, type a command, resolve with what came back (or why not) */
const pty = (host: string, origin: string) =>
  new Promise<string>((resolve) => {
    const ws = new WebSocket(`ws://${host}:${h.port}/pty`, { headers: { origin } } as any);
    let out = "";
    ws.onerror = () => resolve("REJECTED");
    ws.onopen = () => ws.send(JSON.stringify({ t: "i", d: "echo BRAS_OK\r" }));
    ws.onmessage = (e) => {
      out += Buffer.from(e.data as ArrayBuffer).toString();
      if (out.split("BRAS_OK").length > 2) (ws.close(), resolve(out)); // typed echo + command output
    };
    setTimeout(() => resolve("TIMEOUT"), 8000);
  });
const own = (id: string) => `http://${id}.localhost:${h.port}`;

test("the terminal app gets a working shell on its own origin", async () => {
  expect(await pty("terminal.localhost", own("terminal"))).toContain("BRAS_OK");
});

test("a foreign web page is refused", async () => {
  expect(await pty("terminal.localhost", "http://evil.com")).toBe("REJECTED");
});

test("an app without the pty permission is refused, on its own origin or the terminal's", async () => {
  expect(await pty("about.localhost", own("about"))).toBe("REJECTED");
  expect(await pty("terminal.localhost", own("about"))).toBe("REJECTED");
});

test("the terminal can't open a PTY through another origin either", async () => {
  expect(await pty("about.localhost", own("terminal"))).toBe("REJECTED"); // sameOrigin check
});

test("grants, denials and sessions are on the audit trail", async () => {
  await Bun.sleep(300); // let the last close event land
  const e = h.events();
  expect(e.some((x) => x.event === "capability.pty" && x.outcome === "allow" && x.actor.app === "terminal")).toBe(true);
  expect(e.some((x) => x.event === "capability.pty" && x.outcome === "deny")).toBe(true);
  expect(e.some((x) => x.event === "pty.session" && x.detail.state === "open")).toBe(true);
});
