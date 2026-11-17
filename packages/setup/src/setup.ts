// First-boot setup: the initial account and the preferences, stored in the state directory. Until it is done the shell shows
// the installer instead of the desktop. The account here is a BrasOS profile (a screen lock for the shell), not a Linux user:
// every local process can reach this host anyway, so the password protects the screen, not the machine (see docs/guide/08-security.md).
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { json, type AuditFn, type Slice } from "@brasos/host/types";

export const LANGUAGES = ["pt-BR", "en-US"] as const;
export const PALETTES = ["green", "amber", "mint", "ice", "mono"] as const;
export const KEYBOARDS = ["br-abnt2", "us", "us-intl"] as const;

export type Prefs = { language: string; timezone: string; keyboard: string; clock24: boolean; palette: string; deviceName: string };
export type SetupInput = { display: string; username: string; password: string; prefs: Prefs };
type Account = { username: string; display: string; hash: string; pinHash?: string };
/** `account` is the owner (the administrator: the one made at first boot, never deletable); `others` are the accounts the owner added in Settings */
type Stored = { done: true; at: number; account: Account; others?: Account[]; prefs: Prefs };

export class SetupError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const bad = (m: string): never => {
  throw new SetupError(m);
};
const oneOf = <T extends readonly string[]>(list: T, v: unknown, what: string): T[number] => (list.includes(v as string) ? (v as T[number]) : bad(`invalid ${what}`));
const zones = new Set<string>([...Intl.supportedValuesOf("timeZone"), "UTC"]);

export function validatePrefs(p: any): Prefs {
  if (!p || typeof p !== "object") return bad("invalid preferences");
  if (!zones.has(p.timezone)) bad("invalid timezone");
  if (typeof p.clock24 !== "boolean") bad("invalid clock format");
  if (typeof p.deviceName !== "string" || !/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(p.deviceName)) bad("invalid device name");
  return {
    language: oneOf(LANGUAGES, p.language, "language"),
    timezone: p.timezone,
    keyboard: oneOf(KEYBOARDS, p.keyboard, "keyboard"),
    clock24: p.clock24,
    palette: oneOf(PALETTES, p.palette, "palette"),
    deviceName: p.deviceName,
  };
}

/** the account and preferences, or a SetupError saying what is wrong (never echoing the password) */
export function validateSetup(b: any): SetupInput {
  if (!b || typeof b !== "object") return bad("invalid request");
  const display = typeof b.display === "string" ? b.display.trim() : "";
  if (!display || display.length > 64 || /[\u0000-\u001f]/.test(display)) bad("invalid name");
  if (typeof b.username !== "string" || !/^[a-z][a-z0-9_-]{2,31}$/.test(b.username)) bad("invalid username (3-32 letters, digits, - or _, starting with a letter)");
  const pw = b.password;
  if (typeof pw !== "string" || pw.length < 10 || pw.length > 128) bad("password must be 10 to 128 characters");
  if (pw.toLowerCase().includes(b.username) || new Set(pw).size < 4) bad("password is too easy to guess");
  return { display, username: b.username, password: pw, prefs: validatePrefs(b.prefs) };
}

/** a new account's name, username and password (the same rules as first boot) */
export function validateAccount(b: any): { display: string; username: string; password: string } {
  const v = validateSetup({ ...(b && typeof b === "object" ? b : {}), prefs: { language: "en-US", timezone: "UTC", keyboard: "us", clock24: true, palette: "green", deviceName: "brasos" } });
  return { display: v.display, username: v.username, password: v.password };
}

/** a sign-in PIN: 4 to 8 digits, not one repeated digit and not a plain run (1234, 8765). A PIN only unlocks the screen, like the password. */
export function validatePin(pin: unknown): string {
  if (typeof pin !== "string" || !/^\d{4,8}$/.test(pin)) return bad("the PIN must be 4 to 8 digits");
  const d = [...pin].map(Number);
  const step = d[1] - d[0];
  if (d.every((x, i) => i === 0 || x - d[i - 1] === step) && Math.abs(step) <= 1) bad("that PIN is too easy to guess (no repeated digits or runs like 1234)");
  return pin;
}
const MAX_ACCOUNTS = 16;
const MAX_PIN_FAILS = 5; // consecutive wrong PINs before the PIN is switched off until the password is used

export function createSetup({ stateDir, audit, preseed, devSkip }: { stateDir?: string; audit: AuditFn; preseed?: string; devSkip?: boolean }) {
  const file = stateDir ? join(stateDir, "setup.json") : undefined;
  const write = (s: Stored) => {
    if (!file) throw new SetupError("setup is not available", 503);
    mkdirSync(stateDir!, { recursive: true });
    const tmp = file + ".tmp";
    writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file); // never a half-written file
  };
  const read = (): Stored | null => {
    try {
      return file && existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Stored) : null;
    } catch {
      return null;
    }
  };

  // unattended provisioning: a file with the account (as an argon2 hash, never a password) and the preferences
  if (file && preseed && !read() && existsSync(preseed)) {
    try {
      const p = JSON.parse(readFileSync(preseed, "utf8"));
      const prefs = validatePrefs(p.prefs);
      const a = p.account ?? {};
      if (typeof a.passwordHash !== "string" || !a.passwordHash.startsWith("$argon2")) throw new SetupError("preseed needs an argon2 passwordHash");
      if (!/^[a-z][a-z0-9_-]{2,31}$/.test(a.username) || typeof a.display !== "string" || !a.display.trim()) throw new SetupError("preseed account is invalid");
      write({ done: true, at: Date.now(), account: { username: a.username, display: a.display.trim().slice(0, 64), hash: a.passwordHash }, prefs });
      audit("setup.complete", "info", { app: "preseed" }, { username: a.username });
    } catch (e) {
      audit("setup.preseed", "deny", {}, { reason: (e as Error).message.slice(0, 120) });
    }
  }

  // development only: no installer and no lock screen. A throwaway account with a random password nobody knows (so it can't be
  // logged into), default preferences, and the state says `devSkip` so the shell neither asks nor offers to lock. The host
  // passes this only when no package (hardened included) is enabled.
  if (file && devSkip && !read()) {
    write({
      done: true,
      at: Date.now(),
      account: { username: "dev", display: "Developer", hash: Bun.password.hashSync(crypto.randomUUID() + crypto.randomUUID(), { algorithm: "argon2id" }) },
      prefs: { language: "en-US", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", keyboard: "us", clock24: true, palette: "green", deviceName: "brasos" },
    });
    audit("setup.dev_skip", "info", {}, {});
  }

  let busy = false; // one completion at a time: hashing is async, so two requests could race
  const fails: number[] = [];
  const pinFails = new Map<string, number>(); // in memory, per account: a restart gives the PIN a fresh start (the screen lock is not access control)
  const everyone = (s: Stored): Account[] => [s.account, ...(s.others ?? [])];
  const pinOn = (a: Account) => !!a.pinHash && (pinFails.get(a.username) ?? 0) < MAX_PIN_FAILS;
  const publicState = () => {
    const s = read();
    return s
      ? { available: true, done: true, user: { username: s.account.username, display: s.account.display }, accounts: everyone(s).map((a) => ({ username: a.username, display: a.display, hasPin: pinOn(a) })), prefs: s.prefs, hasPin: pinOn(s.account), ...(devSkip ? { devSkip: true } : {}) }
      : { available: !!file, done: false };
  };
  /** the owner's password, for anything that adds, removes or resets an account: true when it is right (throttled and audited like the PIN) */
  const ownerOk = async (s: Stored, password: unknown, event: string) => {
    const ok = typeof password === "string" && password.length <= 128 && (await Bun.password.verify(password, s.account.hash).catch(() => false));
    if (!ok) {
      fails.push(Date.now());
      audit(event, "deny", { app: "settings" }, { reason: "password" });
      await Bun.sleep(400);
    }
    return ok;
  };
  /** the per-minute limit shared by the password and the PIN: true when this attempt must be refused */
  const throttled = () => {
    const now = Date.now();
    while (fails.length && now - fails[0] > 60_000) fails.shift();
    return fails.length >= 5;
  };

  const slice: Slice = {
    name: "setup",
    async handle(req, ctx) {
      const path = ctx.url.pathname;
      if (ctx.target.kind !== "shell" || !/^\/os\/(setup|prefs|login|pin|accounts)/.test(path)) return;
      if (path === "/os/setup" && req.method === "GET") return json(publicState());
      // the accounts list (Settings → Accounts); the changes are POSTs below
      if (path === "/os/accounts" && req.method === "GET") {
        const g = ctx.gate("accounts.manage", { quiet: true });
        if (!g.ok) return g.res;
        const s = read();
        if (!s) return json({ error: "not set up" }, 409);
        return json({ devSkip: !!devSkip, accounts: everyone(s).map((a, i) => ({ username: a.username, display: a.display, owner: i === 0, hasPin: !!a.pinHash })) });
      }
      if (req.method !== "POST") return;

      if (path === "/os/setup/complete") {
        const g = ctx.gate("setup.write", { sameOrigin: true });
        if (!g.ok) return g.res;
        if (!file) return json({ error: "setup is not available" }, 503);
        if (read() || busy) return json({ error: "already set up" }, 409);
        busy = true;
        try {
          const v = validateSetup(await req.json().catch(() => null));
          const hash = await Bun.password.hash(v.password, { algorithm: "argon2id" });
          write({ done: true, at: Date.now(), account: { username: v.username, display: v.display, hash }, prefs: v.prefs });
          audit("setup.complete", "info", { app: "shell" }, { username: v.username }); // never the password, nor its hash
          return json({ ok: true });
        } catch (e) {
          if (e instanceof SetupError) return json({ error: e.message }, e.status);
          return json({ error: "setup failed" }, 500);
        } finally {
          busy = false;
        }
      }

      if (path === "/os/prefs") {
        const g = ctx.gate("setup.write", { sameOrigin: true });
        if (!g.ok) return g.res;
        const s = read();
        if (!s) return json({ error: "not set up" }, 409);
        try {
          s.prefs = validatePrefs({ ...s.prefs, ...((await req.json().catch(() => null)) ?? {}) });
          write(s);
          audit("setup.prefs", "info", { app: "shell" }, {});
          return json({ ok: true, prefs: s.prefs });
        } catch (e) {
          return e instanceof SetupError ? json({ error: e.message }, e.status) : json({ error: "failed" }, 500);
        }
      }

      // set or remove the sign-in PIN: the current password is required (so a person at an unlocked screen can't add a PIN they know)
      if (path === "/os/pin") {
        const g = ctx.gate("setup.write", { sameOrigin: true });
        if (!g.ok) return g.res;
        if (throttled()) return json({ error: "too many attempts, wait a minute" }, 429);
        const b: any = await req.json().catch(() => null);
        const s = read();
        if (!s) return json({ error: "not set up" }, 409);
        const who = typeof b?.username === "string" ? everyone(s).find((a) => a.username === b.username) : s.account; // the signed-in account, the owner by default
        const ok = !!who && typeof b?.password === "string" && b.password.length <= 128 && (await Bun.password.verify(b.password, who.hash).catch(() => false));
        if (!ok) {
          fails.push(Date.now());
          audit("setup.pin", "deny", { app: "shell" }, { reason: "password" });
          await Bun.sleep(400);
          return json({ error: "wrong password" }, 401);
        }
        try {
          if (b.pin === null) delete who!.pinHash;
          else who!.pinHash = await Bun.password.hash(validatePin(b.pin), { algorithm: "argon2id" });
          write(s);
          pinFails.delete(who!.username);
          audit("setup.pin", "info", { app: "shell" }, { action: b.pin === null ? "remove" : "set" }); // never the PIN, nor its hash
          return json({ ok: true, hasPin: b.pin !== null });
        } catch (e) {
          return e instanceof SetupError ? json({ error: e.message }, e.status) : json({ error: "failed" }, 500);
        }
      }

      if (path === "/os/login") {
        const g = ctx.gate("setup.login", { sameOrigin: true });
        if (!g.ok) return g.res;
        const now = Date.now();
        const b: any = await req.json().catch(() => null);
        const s = read();
        const who = s && typeof b?.username === "string" ? everyone(s).find((a) => a.username === b.username) : undefined;
        const byPin = typeof b?.pin === "string";
        if (byPin && (pinFails.get(String(b?.username)) ?? 0) >= MAX_PIN_FAILS) {
          audit("login", "deny", { app: "shell" }, { method: "pin", reason: "pin-locked" }, { key: "pin-locked", ms: 10_000 });
          return json({ error: "the PIN is switched off after too many wrong tries; use your password" }, 403);
        }
        if (throttled()) {
          audit("login", "deny", { app: "shell" }, { reason: "throttled" }, { key: "login-throttled", ms: 10_000 });
          return json({ error: "too many attempts, wait a minute" }, 429);
        }
        const ok = byPin
          ? !!who?.pinHash && b.pin.length <= 8 && (await Bun.password.verify(b.pin, who.pinHash).catch(() => false))
          : !!who && typeof b?.password === "string" && b.password.length <= 128 && (await Bun.password.verify(b.password, who.hash).catch(() => false));
        if (!ok) {
          fails.push(now);
          if (byPin && who) pinFails.set(who.username, (pinFails.get(who.username) ?? 0) + 1);
          audit("login", "deny", { app: "shell" }, { username: String(b?.username ?? "").slice(0, 32), method: byPin ? "pin" : "password" });
          await Bun.sleep(400); // slows guessing a little; the counter above stops it
          return json({ error: byPin ? "wrong PIN" : "wrong username or password" }, 401);
        }
        fails.length = 0;
        pinFails.delete(who!.username);
        audit("login", "allow", { app: "shell" }, { username: who!.username, method: byPin ? "pin" : "password" });
        return json({ ok: true, user: { username: who!.username, display: who!.display } });
      }

      // managing accounts (Settings → Accounts): `accounts.manage`, held by the Settings app alone. Every change needs the owner's password.
      // These are BrasOS profiles for the lock screen, not Linux users: they share the one home folder and are not access control.
      if (/^\/os\/accounts\/(create|update|delete)$/.test(path) && req.method === "POST") {
        const op = path.slice("/os/accounts/".length);
        const g = ctx.gate("accounts.manage");
        if (!g.ok) return g.res;
        const s = read();
        if (!s) return json({ error: "not set up" }, 409);
        if (devSkip) return json({ error: "accounts are off in the development shortcut (there is no lock screen)" }, 409);
        if (throttled()) return json({ error: "too many attempts, wait a minute" }, 429);
        const b: any = await req.json().catch(() => null);
        const event = `accounts.${op}`;
        if (!(await ownerOk(s, b?.ownerPassword, event))) return json({ error: "wrong password" }, 401);
        const list = everyone(s);
        try {
          if (op === "create") {
            if (list.length >= MAX_ACCOUNTS) throw new SetupError(`at most ${MAX_ACCOUNTS} accounts`);
            const v = validateAccount(b);
            if (list.some((a) => a.username === v.username)) throw new SetupError("that username is taken", 409);
            const hash = await Bun.password.hash(v.password, { algorithm: "argon2id" });
            s.others = [...(s.others ?? []), { username: v.username, display: v.display, hash }];
            write(s);
            audit(event, "info", { app: "settings" }, { username: v.username }); // never the password, nor its hash
            return json({ ok: true });
          }
          const target = typeof b?.username === "string" ? list.find((a) => a.username === b.username) : undefined;
          if (!target) throw new SetupError("no such account", 404);
          if (op === "delete") {
            if (target === s.account) throw new SetupError("the owner account cannot be deleted", 409);
            s.others = (s.others ?? []).filter((a) => a !== target);
            pinFails.delete(target.username);
          } else {
            // update: the display name, a new password (which also switches the PIN off), or just the PIN removed
            if (b.display !== undefined) {
              const d = typeof b.display === "string" ? b.display.trim() : "";
              if (!d || d.length > 64 || /[\u0000-\u001f]/.test(d)) throw new SetupError("invalid name");
              target.display = d;
            }
            if (b.newPassword !== undefined) {
              validateAccount({ display: target.display, username: target.username, password: b.newPassword });
              target.hash = await Bun.password.hash(b.newPassword, { algorithm: "argon2id" });
              delete target.pinHash;
            }
            if (b.removePin === true) delete target.pinHash;
          }
          write(s);
          audit(event, "info", { app: "settings" }, { username: target.username });
          return json({ ok: true });
        } catch (e) {
          return e instanceof SetupError ? json({ error: e.message }, e.status) : json({ error: "failed" }, 500);
        }
      }
    },
  };
  return { slice };
}
