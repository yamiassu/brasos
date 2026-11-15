// First-boot setup: the initial account and the preferences, stored in the state directory. Until it is done the shell shows
// the installer instead of the desktop. The account here is a BrasOS profile (a screen lock for the shell), not a Linux user:
// every local process can reach this host anyway, so the password protects the screen, not the machine (see docs/guide/08-security.md).
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { json, type AuditFn, type Slice } from "@brasos/host/types";

export const LANGUAGES = ["pt-BR", "en-US"] as const;
export const PALETTES = ["amber", "mint", "ice", "mono"] as const;
export const KEYBOARDS = ["br-abnt2", "us", "us-intl"] as const;

export type Prefs = { language: string; timezone: string; keyboard: string; clock24: boolean; palette: string; deviceName: string };
export type SetupInput = { display: string; username: string; password: string; prefs: Prefs };
type Stored = { done: true; at: number; account: { username: string; display: string; hash: string }; prefs: Prefs };

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

export function createSetup({ stateDir, audit, preseed }: { stateDir?: string; audit: AuditFn; preseed?: string }) {
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

  let busy = false; // one completion at a time: hashing is async, so two requests could race
  const fails: number[] = [];
  const publicState = () => {
    const s = read();
    return s ? { available: true, done: true, user: { username: s.account.username, display: s.account.display }, prefs: s.prefs } : { available: !!file, done: false };
  };

  const slice: Slice = {
    name: "setup",
    async handle(req, ctx) {
      const path = ctx.url.pathname;
      if (ctx.target.kind !== "shell" || !/^\/os\/(setup|prefs|login)/.test(path)) return;
      if (path === "/os/setup" && req.method === "GET") return json(publicState());
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

      if (path === "/os/login") {
        const g = ctx.gate("setup.login", { sameOrigin: true });
        if (!g.ok) return g.res;
        const now = Date.now();
        while (fails.length && now - fails[0] > 60_000) fails.shift();
        if (fails.length >= 5) {
          audit("login", "deny", { app: "shell" }, { reason: "throttled" }, { key: "login-throttled", ms: 10_000 });
          return json({ error: "too many attempts, wait a minute" }, 429);
        }
        const b: any = await req.json().catch(() => null);
        const s = read();
        const ok = !!s && typeof b?.username === "string" && typeof b?.password === "string" && b.password.length <= 128 &&
          b.username === s.account.username && (await Bun.password.verify(b.password, s.account.hash).catch(() => false));
        if (!ok) {
          fails.push(now);
          audit("login", "deny", { app: "shell" }, { username: String(b?.username ?? "").slice(0, 32) });
          await Bun.sleep(400); // slows guessing a little; the counter above stops it
          return json({ error: "wrong username or password" }, 401);
        }
        fails.length = 0;
        audit("login", "allow", { app: "shell" }, { username: s!.account.username });
        return json({ ok: true });
      }
    },
  };
  return { slice };
}
