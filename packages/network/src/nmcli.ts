// Reading and writing what NetworkManager's `nmcli -t` prints. Pure parsers (tested without a machine) and the input checks.
export type Wifi = { ssid: string; signal: number; secure: boolean; active: boolean };
export type Active = { device: string; type: string; connection: string; ip: string; gateway: string; dns: string[]; ssid?: string; signal?: number };

/** one line of `nmcli -t`: fields split on colons, `\:` and `\\` being literal */
export const splitTerse = (line: string): string[] => {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && i + 1 < line.length) cur += line[++i];
    else if (line[i] === ":") (out.push(cur), (cur = ""));
    else cur += line[i];
  }
  return [...out, cur];
};

/** `nmcli -t -f ACTIVE,SSID,SIGNAL,SECURITY dev wifi list`: strongest entry per network name, the connected one first */
export function parseWifi(out: string): Wifi[] {
  const best = new Map<string, Wifi>();
  for (const l of out.split(/\r?\n/)) {
    const [active, ssid, signal, security] = splitTerse(l);
    if (!ssid) continue;
    const w = { ssid, signal: Number(signal) || 0, secure: !!security && security !== "--", active: active === "yes" };
    const o = best.get(ssid);
    if (!o || w.active || (!o.active && w.signal > o.signal)) best.set(ssid, w);
  }
  return [...best.values()].sort((a, b) => +b.active - +a.active || b.signal - a.signal);
}

export type Dev = { device: string; type: string; state: string; connection: string };
/** `nmcli -t -f DEVICE,TYPE,STATE,CONNECTION dev`, without loopback */
export const parseDevices = (out: string): Dev[] =>
  out.split(/\r?\n/).map(splitTerse).filter((f) => f[0] && f[1] && f[1] !== "loopback").map(([device, type, state, connection]) => ({ device, type, state, connection: connection ?? "" }));

/** `nmcli -t -f TYPE,STATE dev` (or the longer form): is any real network device connected? */
export const parseConnected = (out: string) =>
  out.split(/\r?\n/).some((l) => {
    const f = splitTerse(l);
    const [t, s] = f.length >= 4 ? [f[1], f[2]] : [f[0], f[1]]; // DEVICE,TYPE,STATE,... or TYPE,STATE
    return !!t && t !== "loopback" && s === "connected";
  });

/** `nmcli -t -f IP4.ADDRESS,IP4.GATEWAY,IP4.DNS dev show X`: keys come as `IP4.ADDRESS[1]`; the numbering is dropped */
export function parseShow(out: string): Record<string, string[]> {
  const r: Record<string, string[]> = {};
  for (const l of out.split(/\r?\n/)) {
    const i = l.indexOf(":");
    if (i < 0) continue;
    const key = l.slice(0, i).replace(/\[\d+\]$/, "");
    const v = splitTerse(l.slice(i + 1))[0]?.trim();
    if (v) (r[key] ??= []).push(v);
  }
  return r;
}

/** a device name from the list nmcli gave (never from a request): letters, digits and . _ - : only */
export const safeDevice = (d: string) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,14}$/.test(d);

/** a network name (1–32 bytes, no control characters, never an option) and a Wi-Fi password (empty, 8–63 characters or 64 hex digits) */
export const validWifi = (ssid: unknown, pass: unknown) =>
  typeof ssid === "string" && typeof pass === "string" && ssid.length > 0 && new TextEncoder().encode(ssid).length <= 32 && !ssid.startsWith("-") && !/[\x00-\x1f\x7f]/.test(ssid) &&
  !/[\x00-\x1f\x7f]/.test(pass) && (pass === "" || (pass.length >= 8 && pass.length <= 63) || /^[0-9a-fA-F]{64}$/.test(pass));
