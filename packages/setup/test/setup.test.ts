import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testHost, type TestHost } from "../../host/src/testing";

const prefs = { language: "pt-BR", timezone: "America/Sao_Paulo", keyboard: "br-abnt2", clock24: true, palette: "amber", deviceName: "pc-gabinete-01" };
const good = { display: "Maria Souza", username: "maria", password: "correct horse 42", prefs };

const post = (h: TestHost, path: string, body: unknown, from = "localhost") =>
  h.at("localhost", path, { method: "POST", headers: { origin: h.origin(from), "content-type": "application/json" }, body: JSON.stringify(body) });
const state = async (h: TestHost) => (await h.at("localhost", "/os/setup")).json() as Promise<any>;

test("a fresh system needs setup; completing it stores the account safely", async () => {
  const h = await testHost();
  expect(await state(h)).toEqual({ available: true, done: false });
  expect((await post(h, "/os/setup/complete", good)).status).toBe(200);
  const s = await state(h);
  expect(s).toEqual({ available: true, done: true, user: { username: "maria", display: "Maria Souza" }, accounts: [{ username: "maria", display: "Maria Souza", hasPin: false }], prefs, hasPin: false });
  const raw = readFileSync(join(h.stateDir, "setup.json"), "utf8");
  expect(raw).not.toContain("correct horse"); // only an argon2 hash is stored
  expect(raw).toContain("$argon2id$");
  expect(JSON.stringify(h.events())).not.toContain("correct horse"); // and the audit trail never sees the password
  expect(h.events().some((e) => e.event === "setup.complete" && e.actor.app === "shell")).toBe(true);
  expect((await post(h, "/os/setup/complete", good)).status).toBe(409); // once only
  h.stop();
});

test("setup refuses weak or malformed input and stores nothing", async () => {
  const h = await testHost();
  const cases: [string, any][] = [
    ["short password", { ...good, password: "short" }],
    ["password contains the username", { ...good, password: "maria-maria-2026" }],
    ["one repeated character", { ...good, password: "aaaaaaaaaaaa" }],
    ["bad username", { ...good, username: "Maria Souza" }],
    ["empty name", { ...good, display: "  " }],
    ["bad palette", { ...good, prefs: { ...prefs, palette: "neon" } }],
    ["bad timezone", { ...good, prefs: { ...prefs, timezone: "Mars/Olympus" } }],
    ["bad device name", { ...good, prefs: { ...prefs, deviceName: "Not A Hostname!" } }],
    ["bad clock", { ...good, prefs: { ...prefs, clock24: "yes" } }],
  ];
  for (const [what, body] of cases) {
    const r = await post(h, "/os/setup/complete", body);
    expect([what, r.status]).toEqual([what, 400]);
    expect(JSON.stringify(await r.json())).not.toContain("correct horse");
  }
  expect((await state(h)).done).toBe(false);
  h.stop();
});

test("only the shell may set up: an app or an unidentified caller is refused", async () => {
  const h = await testHost();
  expect((await post(h, "/os/setup/complete", good, "files.localhost")).status).toBe(403);
  expect((await h.at("localhost", "/os/setup/complete", { method: "POST", body: JSON.stringify(good) })).status).toBe(403);
  expect((await post(h, "/os/prefs", { palette: "mint" }, "about.localhost")).status).toBe(403);
  expect((await state(h)).done).toBe(false);
  h.stop();
});

test("login: right password in, wrong one audited and throttled", async () => {
  const h = await testHost();
  await post(h, "/os/setup/complete", good);
  expect((await post(h, "/os/login", { username: "maria", password: "correct horse 42" })).status).toBe(200);
  expect((await post(h, "/os/login", { username: "maria", password: "nope nope nope" }, "files.localhost")).status).toBe(403); // not the shell
  for (let i = 0; i < 5; i++) expect((await post(h, "/os/login", { username: "maria", password: "wrong password " + i })).status).toBe(401);
  expect((await post(h, "/os/login", { username: "maria", password: "correct horse 42" })).status).toBe(429); // throttled, even with the right one
  const ev = h.events().filter((e) => e.event === "login");
  expect(ev.some((e) => e.outcome === "allow")).toBe(true);
  expect(ev.filter((e) => e.outcome === "deny").length).toBeGreaterThanOrEqual(5);
  expect(JSON.stringify(ev)).not.toContain("wrong password");
  h.stop();
}, 15000);

test("preferences can change after setup, validated; before setup there is nothing to change", async () => {
  const h = await testHost();
  expect((await post(h, "/os/prefs", { palette: "mint" })).status).toBe(409);
  await post(h, "/os/setup/complete", good);
  const r = await post(h, "/os/prefs", { palette: "mint", clock24: false });
  expect((await r.json()).prefs).toMatchObject({ palette: "mint", clock24: false, language: "pt-BR" });
  expect((await post(h, "/os/prefs", { palette: "hotpink" })).status).toBe(400);
  expect((await state(h)).prefs.palette).toBe("mint");
  h.stop();
});

test("the hardened package keeps setup and login, and still denies everything else", async () => {
  const h = await testHost({ packages: ["hardened"] });
  expect((await post(h, "/os/setup/complete", good)).status).toBe(200);
  expect((await post(h, "/os/login", { username: "maria", password: "correct horse 42" })).status).toBe(200);
  expect((await post(h, "/os/fs/list", { path: "/" })).status).toBe(403);
  h.stop();
});

test("a preseed file provisions the account without the installer (hash only, never a password)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "brasos-preseed-"));
  const file = join(dir, "preseed.json");
  writeFileSync(file, JSON.stringify({ account: { username: "admin", display: "Administrador", passwordHash: await Bun.password.hash("preseeded pass 99", { algorithm: "argon2id" }) }, prefs }));
  const h = await testHost({ setupPreseed: file });
  expect((await state(h)).user.username).toBe("admin");
  expect((await post(h, "/os/login", { username: "admin", password: "preseeded pass 99" })).status).toBe(200);
  h.stop();
  // a preseed with a plaintext password is ignored, and the installer stays available
  writeFileSync(file, JSON.stringify({ account: { username: "admin", display: "A", password: "plain plain plain" }, prefs }));
  const h2 = await testHost({ setupPreseed: file });
  expect((await state(h2)).done).toBe(false);
  expect(h2.events().some((e) => e.event === "setup.preseed" && e.outcome === "deny")).toBe(true);
  h2.stop();
});

test("dev skip: no installer, no lock screen, an account nobody can log into; ignored with any package", async () => {
  const h = await testHost({ setupDevSkip: true });
  const s = await state(h);
  expect(s).toMatchObject({ available: true, done: true, devSkip: true, user: { username: "dev" } });
  expect((await post(h, "/os/login", { username: "dev", password: "dev" })).status).toBe(401);
  expect((await post(h, "/os/setup/complete", good)).status).toBe(409);
  expect(h.events().some((e) => e.event === "setup.dev_skip")).toBe(true);
  h.stop();
  const hard = await testHost({ packages: ["hardened"], setupDevSkip: true });
  expect(await state(hard)).toEqual({ available: true, done: false }); // still asks for the first account
  hard.stop();
});

test("a sign-in PIN: set with the password, unlocks like it, never stored or audited in the clear", async () => {
  const h = await testHost();
  await post(h, "/os/setup/complete", good);
  expect((await post(h, "/os/login", { username: "maria", pin: "2468" })).status).toBe(401); // none set yet
  expect((await post(h, "/os/pin", { password: "wrong wrong wrong", pin: "2468" })).status).toBe(401);
  expect((await post(h, "/os/pin", { password: good.password, pin: "2468" }, "files.localhost")).status).toBe(403); // shell only
  for (const bad of ["12", "123456789", "abcd", "1111", "1234", "4321", "0000"]) expect([bad, (await post(h, "/os/pin", { password: good.password, pin: bad })).status]).toEqual([bad, 400]);
  expect((await post(h, "/os/pin", { password: good.password, pin: "2468" })).status).toBe(200);
  expect((await state(h)).hasPin).toBe(true);
  expect((await post(h, "/os/login", { username: "maria", pin: "2468" })).status).toBe(200);
  expect((await post(h, "/os/login", { username: "maria", pin: "2469" })).status).toBe(401);
  const raw = readFileSync(join(h.stateDir, "setup.json"), "utf8");
  expect(raw).not.toContain("2468");
  expect(JSON.stringify(h.events())).not.toContain("2468");
  expect(h.events().some((e) => e.event === "setup.pin" && e.outcome === "info" && e.detail.action === "set")).toBe(true);
  expect((await post(h, "/os/pin", { password: good.password, pin: null })).status).toBe(200); // remove
  expect((await state(h)).hasPin).toBe(false);
  expect((await post(h, "/os/login", { username: "maria", pin: "2468" })).status).toBe(401);
  h.stop();
});

test("five wrong PINs switch the PIN off until the password is used", async () => {
  const h = await testHost();
  await post(h, "/os/setup/complete", good);
  await post(h, "/os/pin", { password: good.password, pin: "2468" });
  for (let i = 0; i < 5; i++) expect((await post(h, "/os/login", { username: "maria", pin: "1357" })).status).toBe(401);
  expect((await post(h, "/os/login", { username: "maria", pin: "2468" })).status).toBe(403); // right PIN, but switched off
  expect((await state(h)).hasPin).toBe(false);
  h.stop();
});

const login = (h: TestHost, username: string, secret: Record<string, string>) => post(h, "/os/login", { username, ...secret });
const acct = (h: TestHost, op: string, body: unknown, from = "settings.localhost") => post(h, `/os/accounts/${op}`, { ownerPassword: good.password, ...(body as object) }, from);

test("the owner adds, changes and removes accounts from Settings; the others sign in on the lock screen", async () => {
  const h = await testHost();
  await post(h, "/os/setup/complete", good);
  const joao = { display: "João Lima", username: "joao", password: "another long pass 7" };
  expect((await acct(h, "create", joao)).status).toBe(200);
  expect((await acct(h, "create", joao)).status).toBe(409); // the name is taken
  expect((await acct(h, "create", { ...joao, username: "ana", password: "short" })).status).toBe(400);
  const list = await (await h.at("localhost", "/os/accounts", { headers: { origin: h.origin("settings.localhost") } })).json() as any;
  expect(list.accounts).toEqual([{ username: "maria", display: "Maria Souza", owner: true, hasPin: false }, { username: "joao", display: "João Lima", owner: false, hasPin: false }]);
  expect(JSON.stringify(list)).not.toContain("argon2");
  expect((await state(h)).accounts.map((a: any) => a.username)).toEqual(["maria", "joao"]); // the lock screen offers both
  // the new account signs in with its own password, and not with the owner's
  const ok = await login(h, "joao", { password: joao.password });
  expect(ok.status).toBe(200);
  expect((await ok.json() as any).user).toEqual({ username: "joao", display: "João Lima" });
  expect((await login(h, "joao", { password: good.password })).status).toBe(401);
  // a new password replaces the old one; a new name shows up
  expect((await acct(h, "update", { username: "joao", display: "João L.", newPassword: "brand new password 9" })).status).toBe(200);
  expect((await login(h, "joao", { password: joao.password })).status).toBe(401);
  expect((await login(h, "joao", { password: "brand new password 9" })).status).toBe(200);
  expect((await state(h)).accounts[1].display).toBe("João L.");
  // the owner is never deleted; another account can be, and then cannot sign in
  expect((await acct(h, "delete", { username: "maria" })).status).toBe(409);
  expect((await acct(h, "delete", { username: "nobody" })).status).toBe(404);
  expect((await acct(h, "delete", { username: "joao" })).status).toBe(200);
  expect((await login(h, "joao", { password: "brand new password 9" })).status).toBe(401);
  const raw = readFileSync(join(h.stateDir, "setup.json"), "utf8");
  expect(raw).not.toContain("brand new password");
  const trail = JSON.stringify(h.events());
  expect(trail).not.toContain("another long pass");
  expect(trail).not.toContain("brand new password");
  expect(h.events().some((e) => e.event === "accounts.create" && e.outcome !== "deny" && e.detail.username === "joao")).toBe(true);
  h.stop();
}, 60_000);

test("account changes need the owner's password and the Settings app: nobody else gets in", async () => {
  const h = await testHost();
  await post(h, "/os/setup/complete", good);
  const body = { display: "Eve", username: "eve", password: "evil long password 1" };
  expect((await acct(h, "create", { ...body, ownerPassword: "not the password" })).status).toBe(401);
  expect((await acct(h, "create", { ...body, ownerPassword: undefined })).status).toBe(401);
  for (const from of ["about.localhost", "terminal.localhost", "localhost"]) expect((await acct(h, "create", body, from)).status).toBe(403); // apps and the shell hold no accounts.manage
  expect((await h.at("localhost", "/os/accounts", { headers: { origin: "http://evil.example" } })).status).toBe(403);
  expect((await state(h)).accounts.length).toBe(1);
  expect(h.events().some((e) => e.event === "accounts.create" && e.outcome === "deny")).toBe(true);
  h.stop();
}, 60_000);

test("the hardened package refuses account management outright", async () => {
  const h = await testHost({ packages: ["hardened"] });
  await post(h, "/os/setup/complete", good);
  expect((await acct(h, "create", { display: "Eve", username: "eve", password: "evil long password 1" })).status).toBeGreaterThanOrEqual(400);
  expect((await h.at("localhost", "/os/accounts", { headers: { origin: h.origin("settings.localhost") } })).status).toBeGreaterThanOrEqual(400);
  h.stop();
}, 60_000);
