// The network from the taskbar: what is connected (and its address), the Wi-Fi networks in range, and joining one. It talks to
// NetworkManager's nmcli, which the image names in BRASOS_NMCLI (a page never supplies a program). Reading is `network.read`, joining and
// disconnecting is `network.control`: the shell's set only (never an app, an agent or a PWA), denied by the hardened package (default deny).
// Where there is no nmcli (a plain host, the hardened image) every route says so, and the tray falls back to the browser's online flag.
import { json, type AuditFn, type Slice } from "@brasos/host/types";
import { parseDevices, parseShow, parseWifi, safeDevice, validWifi, type Active } from "./nmcli";

export function createNetwork({ audit }: { audit: AuditFn }): Slice {
  const nmcli = () => (process.env.BRASOS_NMCLI ?? "").split(" ").filter(Boolean);
  const run = async (args: string[]) => {
    const p = Bun.spawn([...nmcli(), ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { ok: p.exitCode === 0, out, err };
  };
  const text = async (args: string[]) => (await run(args)).out;
  const devices = async () => parseDevices(await text(["-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "dev"]));
  return {
    name: "network",
    async handle(req, ctx) {
      if (ctx.target.kind !== "shell" || !ctx.url.pathname.startsWith("/os/network")) return;
      const p = ctx.url.pathname;
      if (p === "/os/network" && req.method === "GET") {
        const g = ctx.gate("network.read", { quiet: true });
        if (!g.ok) return g.res;
        if (!nmcli().length) return json({ available: false }, 501);
        const rescan = ctx.url.searchParams.get("rescan") === "1" ? "yes" : "auto";
        const devs = await devices();
        const wifi = parseWifi(await text(["-t", "-f", "ACTIVE,SSID,SIGNAL,SECURITY", "dev", "wifi", "list", "--rescan", rescan]));
        const up = devs.find((d) => d.state === "connected");
        let active: Active | null = null;
        if (up && safeDevice(up.device)) {
          const s = parseShow(await text(["-t", "-f", "IP4.ADDRESS,IP4.GATEWAY,IP4.DNS", "dev", "show", up.device]));
          const w = up.type === "wifi" ? wifi.find((x) => x.active) : undefined;
          active = { device: up.device, type: up.type, connection: up.connection, ip: s["IP4.ADDRESS"]?.[0] ?? "", gateway: s["IP4.GATEWAY"]?.[0] ?? "", dns: s["IP4.DNS"] ?? [], ...(w ? { ssid: w.ssid, signal: w.signal } : {}) };
        }
        const radio = (await text(["radio", "wifi"])).trim();
        return json({ available: true, connected: !!up, active, hasWifi: devs.some((d) => d.type === "wifi"), wifiEnabled: radio !== "disabled", wifi });
      }
      if ((p === "/os/network/connect" || p === "/os/network/disconnect") && req.method === "POST") {
        const g = ctx.gate("network.control", { sameOrigin: true });
        if (!g.ok) return g.res;
        if (!nmcli().length) return json({ error: "this system cannot manage networks" }, 501);
        if (p === "/os/network/disconnect") {
          // the device comes from nmcli's own list, never from the request
          const up = (await devices()).find((d) => d.state === "connected" && d.type === "wifi");
          if (!up || !safeDevice(up.device)) return json({ error: "no Wi-Fi network is connected" }, 409);
          const r = await run(["dev", "disconnect", up.device]);
          audit("network.disconnect", r.ok ? "info" : "warn", { app: "shell" }, { ok: r.ok });
          return r.ok ? json({ ok: true }) : json({ error: "could not disconnect" }, 400);
        }
        const b = (await req.json().catch(() => null)) as { ssid?: unknown; password?: unknown } | null;
        const password = b?.password === undefined ? "" : b.password;
        if (!validWifi(b?.ssid, password)) return json({ error: "that network name or password is not valid (a password is 8 to 63 characters)" }, 400);
        // the password rides nmcli's command line for the few seconds it takes (visible to this user's processes, like everything else
        // on this dev image); it is never audited, logged or sent back
        const r = await run(["--wait", "30", "dev", "wifi", "connect", b!.ssid as string, ...(password ? ["password", password as string] : [])]);
        audit("network.connect", r.ok ? "info" : "warn", { app: "shell" }, { ok: r.ok }); // never the network name or the password
        if (r.ok) return json({ ok: true });
        return json({ error: (r.err || r.out).split((password as string) || "\u0000").join("…").trim().split("\n")[0].slice(0, 200) || "could not connect" }, 400);
      }
    },
  };
}
