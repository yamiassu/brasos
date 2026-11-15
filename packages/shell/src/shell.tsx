import { useEffect, useRef, useState } from "react";
import type { AppInfo, FsEntry } from "@brasos/sdk";
import { Badge, Button, Dialog, Dock, WindowFrame } from "@brasos/ui";
import { connectAgent, type ShellApi } from "./agent";
import { Desktop } from "./desktop";
import { Boundary, Frame, type Win } from "./windows";

const post = (path: string, body: unknown) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const getJson = (path: string) => fetch(path).then((r) => r.json());

export function Shell() {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [wins, setWins] = useState<Win[]>([]);
  const [dragging, setDragging] = useState(false);
  const [packages, setPackages] = useState<string[] | null>(null);
  const [canRestart, setCanRestart] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [note, setNote] = useState("");
  const seq = useRef(1);

  const loadApps = () => getJson("/os/apps").then(setApps).catch(() => {});
  // the desktop folder is optional: without files (hardened) or permission it is simply empty
  const loadDesktop = () =>
    post("/os/fs/list", { path: "/Desktop" })
      .then((r) => (r.ok ? r.json() : []))
      .then(setEntries)
      .catch(() => setEntries([]));

  useEffect(() => {
    loadApps();
    loadDesktop();
    getJson("/os/info").then((i) => (setPackages(i.packages), setCanRestart(!!i.restart)));
    // files also change from outside the shell (an agent, the terminal): look again now and then. Reads are audited quietly.
    const desktopTimer = setInterval(loadDesktop, 5000);
    // Server restarted or failed over to the safe copy: reload so the UI isn't left dead.
    let down = false;
    const t = setInterval(async () => {
      try {
        await fetch("/os/info", { cache: "no-store" });
        if (down) location.reload();
      } catch {
        down = true;
      }
    }, 3000);
    return () => (clearInterval(t), clearInterval(desktopTimer));
  }, []);

  const open = async (app: AppInfo, hash?: string) => {
    let src: string | undefined;
    if (app.kind === "pwa") {
      // PWAs run on the web gateway: the host mints the (per-site) origin for the app's start URL
      const r = await post("/os/web/open", { url: app.start_url });
      if (!r.ok) return setNote(`Can't open ${app.name}: ${(await r.json().catch(() => ({}))).error ?? r.status}`), false;
      src = (await r.json()).url;
    }
    setNote("");
    const key = seq.current++;
    const z = seq.current++;
    setWins((w) => [...w, { key, app, x: 60 + 30 * (w.length % 8), y: 30 + 30 * (w.length % 8), z, reload: 0, src, hash }]);
    return true;
  };
  const openPath = (path: string) => {
    const files = apps.find((a) => a.id === "files");
    return files ? open(files, path) : (setNote("Files isn't available here"), Promise.resolve(false));
  };
  const restart = async () => {
    setConfirmRestart(false);
    const r = await post("/os/system/restart", {});
    setNote(r.ok ? "Restarting the interface…" : "Restart refused");
  };
  const patch = (key: number, f: (w: Win) => Partial<Win>) => setWins((ws) => ws.map((w) => (w.key === key ? { ...w, ...f(w) } : w)));
  const close = (key: number) => setWins((ws) => ws.filter((w) => w.key !== key));
  const focus = (key: number) => {
    const z = seq.current++;
    patch(key, () => ({ z }));
  };
  const topZ = Math.max(0, ...wins.map((w) => w.z));

  // Messages from windows (through @brasos/sdk): refresh signals, and apps asking the shell to open another app. Both are
  // UI-level, so the shell checks the permission itself against the registry; nothing privileged happens on the server.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const kind = e.data?.brasos;
      if (kind === "apps-changed") loadApps(); // a refetch is harmless, so no sender check
      else if (kind === "fs-changed") loadDesktop();
      else if (kind === "open") {
        const from = apps.find((a) => a.id === new URL(e.origin).hostname.replace(/\.localhost$/, "").split("--")[0]);
        const target = apps.find((a) => a.id === e.data.id);
        if (from?.permissions.includes("apps.open") && target) open(target);
      }
    };
    addEventListener("message", onMsg);
    return () => removeEventListener("message", onMsg);
  }, [apps]);

  // The agent interface (see agent.ts). Tools always read the latest state through this ref.
  const live = useRef<ShellApi>(null!);
  live.current = {
    snapshot: () => ({
      focused: wins.find((w) => w.z === topZ)?.key ?? null,
      windows: wins.map((w) => ({ id: w.key, app: w.app.id, title: w.app.name, focused: w.z === topZ, x: Math.round(w.x), y: Math.round(w.y) })),
      apps: apps.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
      desktop: entries.map((e) => ({ name: e.name, kind: e.kind, path: "/Desktop/" + e.name })),
      packages,
      note: note || undefined,
    }),
    focus: (id) => wins.some((w) => w.key === id) && (focus(id), true),
    close: (id) => wins.some((w) => w.key === id) && (close(id), true),
    open: async (appId, path) => {
      const app = apps.find((a) => a.id === appId);
      return app ? open(app, path) : false;
    },
  };
  useEffect(() => {
    if (!packages || packages.includes("hardened")) return; // agents are disabled in the hardened package: don't even try
    return connectAgent(() => live.current);
  }, [packages]);

  return (
    <div className="ui-root">
      <div className="layer windows">
        {wins.map((w) => {
          const pos = { left: w.x, top: w.y, zIndex: w.z + 2 };
          return (
            <Boundary key={w.key} style={pos} onClose={() => close(w.key)}>
              <WindowFrame
                title={w.app.name}
                icon={w.app.icon}
                style={pos}
                onClose={() => close(w.key)}
                headerProps={{
                  onPointerDown: (e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setDragging(true);
                    focus(w.key);
                  },
                  onPointerMove: (e) => e.buttons && patch(w.key, (c) => ({ x: c.x + e.movementX, y: Math.max(0, c.y + e.movementY) })),
                  onPointerUp: () => setDragging(false),
                }}
              >
                <Frame win={w} shield={dragging} onRestart={() => patch(w.key, (c) => ({ reload: c.reload + 1 }))} onClose={() => close(w.key)} />
                {/* clicks inside an iframe never reach us, so unfocused windows get a click-catcher */}
                {w.z !== topZ && <div className="shield" onPointerDown={() => focus(w.key)} />}
              </WindowFrame>
            </Boundary>
          );
        })}
      </div>
      <Dock>
        {apps.map((a) => (
          <Button key={a.id} onClick={() => open(a)}>
            {a.icon} {a.name}
          </Button>
        ))}
        {canRestart && <Button onClick={() => openPath("/BrasOS")}>✏️ Edit interface</Button>}
        {canRestart && <Button onClick={() => setConfirmRestart(true)}>↻ Restart interface</Button>}
        {note && <Badge>{note}</Badge>}
        {/* nobody should mistake a dev image for a hardened one */}
        {packages && !packages.includes("hardened") && <Badge>DEV · hardened package off · not secure</Badge>}
      </Dock>
      {confirmRestart && (
        <Dialog
          title="Restart the interface?"
          onClose={() => setConfirmRestart(false)}
          actions={<><Button onClick={() => setConfirmRestart(false)}>Cancel</Button><Button autoFocus onClick={restart}>Restart</Button></>}
        >
          <p>The shell and every app are rebuilt from the files in /BrasOS. Open windows are closed.</p>
        </Dialog>
      )}
      <div className="layer">
        <Desktop apps={apps} entries={entries} onOpenApp={(a) => open(a)} onOpenPath={openPath} onRefresh={loadDesktop} />
      </div>
    </div>
  );
}
