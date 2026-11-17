import { expect, test } from "bun:test";
import { createRecovery } from "../src/recovery";

const setup = (commands = { restart: ["r"], logs: ["l"], reboot: ["b"] }) => {
  const events: any[] = [], started: string[][] = [];
  const handle = createRecovery({
    port: 7001,
    commands,
    uiUrl: "http://x/",
    audit: (e, o, a, d) => events.push([e, o, a, d]),
    start: (a) => started.push(a),
    read: async () => "log text",
    probe: async () => false,
  });
  const post = (p: string, origin: string | null, host = "localhost:7001") =>
    handle(new Request(`http://${host}${p}`, { method: "POST", headers: origin ? { origin } : {} }));
  return { handle, events, started, post };
};

test("the page lists only the actions the image provides", async () => {
  const { handle } = setup();
  const html = await (await handle(new Request("http://localhost:7001/"))).text();
  expect(html).toContain('data-a="restart"');
  expect(html).not.toContain('data-a="reset"');
});

test("status reports whether the desktop answers", async () => {
  const { handle } = setup();
  expect(await (await handle(new Request("http://localhost:7001/status"))).json()).toEqual({ up: false });
});

test("an action from the page itself runs and is audited", async () => {
  const { post, started, events } = setup();
  expect((await post("/do/restart", "http://localhost:7001")).status).toBe(202);
  expect(started).toEqual([["r"]]);
  expect(events[0].slice(0, 2)).toEqual(["recovery.action", "allow"]);
  expect(await (await post("/do/logs", "http://localhost:7001")).text()).toBe("log text");
});

test("refused: another origin, no origin, an unknown or missing action, a foreign Host", async () => {
  const { post, started, events } = setup();
  expect((await post("/do/restart", "http://evil.example")).status).toBe(403);
  expect((await post("/do/restart", "http://about.localhost:7000")).status).toBe(403);
  expect((await post("/do/restart", null)).status).toBe(403);
  expect((await post("/do/reset", "http://localhost:7001")).status).toBe(404); // not provided by this image
  expect((await post("/do/rm", "http://localhost:7001")).status).toBe(404);
  expect((await post("/do/restart", "http://localhost:7001", "evil.example")).status).toBe(403);
  expect(started).toEqual([]);
  expect(events.every((e) => e[1] === "deny")).toBe(true);
});
