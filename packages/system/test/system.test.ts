import { expect, test } from "bun:test";
import { testHost } from "../../host/src/testing";

const post = (h: Awaited<ReturnType<typeof testHost>>, from: string) =>
  h.at("localhost", "/os/system/restart", { method: "POST", headers: { origin: h.origin(from) } });

test("restart: allowed for the shell, audited, runs the supervisor command after answering", async () => {
  let calls = 0;
  const h = await testHost({ restart: () => void calls++ });
  expect((await (await h.at("localhost", "/os/info")).json()).restart).toBe(true);
  const r = await post(h, "localhost");
  expect(r.status).toBe(202);
  expect(calls).toBe(0);
  await Bun.sleep(400);
  expect(calls).toBe(1);
  expect(h.events().some((e) => e.event === "system.restart" && e.actor.app === "shell")).toBe(true);
  h.stop();
});

test("restart: an app without the permission is refused and nothing restarts", async () => {
  let calls = 0;
  const h = await testHost({ restart: () => void calls++ });
  expect((await post(h, "about.localhost")).status).toBe(403);
  expect((await h.at("localhost", "/os/system/restart", { method: "POST" })).status).toBe(403); // no identifiable caller
  await Bun.sleep(400);
  expect(calls).toBe(0);
  h.stop();
});

test("restart: without a supervisor it says so; the hardened package denies it", async () => {
  const h = await testHost();
  expect((await post(h, "localhost")).status).toBe(501);
  expect((await (await h.at("localhost", "/os/info")).json()).restart).toBe(false);
  h.stop();
  const hard = await testHost({ packages: ["hardened"], restart: () => {} });
  expect((await post(hard, "localhost")).status).toBe(403);
  hard.stop();
});
