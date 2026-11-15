import { useEffect, useRef, useState } from "react";
import type { AppInfo, FsEntry } from "@brasos/sdk";
import { Button, Dialog, Icon, SearchField, Taskbar, TaskButton, Tray, TrayItem, WindowFrame } from "@brasos/ui";
import { connectAgent, type ShellApi } from "./agent";
import { Desktop } from "./desktop";
import { Launcher, search, type Hit } from "./launcher";
import { Battery, Clock, Mode, Network } from "./tray";
import { Boundary, Frame, type Win } from "./windows";

const post = (path: string, body: unknown) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const getJson = (path: string) => fetch(path).then((r) => r.json());

export function Shell({ prefs, user, onLock }: { prefs?: { timezone: string; clock24: boolean; palette: string }; user?: { display: string }; onLock?: () => void }) {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [wins, setWins] = useState<Win[]>([]);
  const [dragging, setDragging] = useState(false);
  const [packages, setPackages] = useState<string[] | null>(null);
  const [canRestart, setCanRestart] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [note, setNote] = useState("");
  const [launcher, setLauncher] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Hit | null>(null);
  const [extra, setExtra] = useState<{ files: Hit[]; guides: Hit[] }>({ files: [], guides: [] });
  const searchBox = useRef<HTMLInputElement>(null);
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
  // files in the usual folders and the guides are fetched when the launcher opens (both are optional: hardened has no files)
  const openLauncher = () => {
    setLauncher(true);
    Promise.all(["/Desktop", "/Documents", "/Downloads"].map((d) => post("/os/fs/list", { path: d }).then((r) => (r.ok ? r.json() : [])).catch(() => [])))
      .then((lists: FsEntry[][]) => {
        const dirs = ["/Desktop", "/Documents", "/Downloads"];
        const files: Hit[] = lists.flatMap((l, i) =>
          l.map((e) => ({ key: "f:" + dirs[i] + "/" + e.name, kind: "File" as const, icon: e.kind === "dir" ? "folder" : "text", label: e.name, meta: dirs[i], run: () => openPath(dirs[i] + "/" + e.name) })));
        setExtra((x) => ({ ...x, files }));
      });
    fetch("/os/docs").then((r) => (r.ok ? r.json() : [])).catch(() => [])
      .then((pages: { slug: string; title: string }[]) => {
        const docs = apps.find((a) => a.id === "docs");
        setExtra((x) => ({ ...x, guides: docs ? pages.map((p) => ({ key: "g:" + p.slug, kind: "Guide" as const, icon: "docs", label: p.title, meta: "Guide", run: () => void open(docs, p.slug) })) : [] }));
      });
  };
  const closeLauncher = () => (setLauncher(false), setQuery(""), setPicked(null));
  const patch = (key: number, f: (w: Win) => Partial<Win>) => setWins((ws) => ws.map((w) => (w.key === key ? { ...w, ...f(w) } : w)));
  const close = (key: number) => setWins((ws) => ws.filter((w) => w.key !== key));
  const focus = (key: number) => {
    const z = seq.current++;
    patch(key, () => ({ z }));
  };
  const topZ = Math.max(0, ...wins.map((w) => w.z));
  const focused = wins.find((w) => w.z === topZ);
  /** an app's button: focus its window if it has one, else open it */
  const launch = (app: AppInfo) => {
    const mine = wins.filter((w) => w.app.id === app.id);
    if (mine.length) focus(mine.reduce((a, b) => (a.z > b.z ? a : b)).key);
    else open(app);
  };
  const [nativeApps, setNativeApps] = useState<{ id: string; name: string; icon: string }[]>([]);
  useEffect(() => {
    fetch("/os/native/apps").then((r) => (r.ok ? r.json() : { apps: [] })).then((r) => setNativeApps(r.apps ?? [])).catch(() => {});
  }, []);
  const hits: Hit[] = [
    ...apps.map((a) => ({ key: "a:" + a.id, kind: "App" as const, icon: a.icon, label: a.name, meta: "App", run: () => launch(a) })),
    ...nativeApps.map((n) => ({ key: "n:" + n.id, kind: "App" as const, icon: n.icon, label: n.name, meta: "Native app", run: () => void post("/os/native/launch", { id: n.id }) })),
    ...wins.map((w) => ({ key: "w:" + w.key, kind: "Window" as const, icon: w.app.icon, label: w.app.name, meta: "Open window", run: () => focus(w.key) })),
    ...extra.files,
    ...extra.guides,
  ];
  const results = search(hits, query);
  const current = picked && results.find((h) => h.key === picked.key) ? picked : results[0] ?? null;
  const run = (h: Hit) => (closeLauncher(), h.run());
  // Native (non-PWA) windows owned by the compositor, where there is one (packages/native): listed once a second, focus on click
  const [natives, setNatives] = useState<{ id: number; title: string; app: string; focused: boolean }[]>([]);
  useEffect(() => {
    let stop = false;
    const tick = () =>
      fetch("/os/native", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { windows: [] }))
        .then((r) => !stop && setNatives((old) => (JSON.stringify(old) === JSON.stringify(r.windows) ? old : r.windows)))
        .catch(() => {});
    tick();
    const t = setInterval(tick, 1000);
    return () => (stop = true, clearInterval(t));
  }, []);
  // Ctrl+K from anywhere in the shell (a window's iframe keeps its own keys)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") (e.preventDefault(), openLauncher(), searchBox.current?.focus());
      else if (e.key === "Escape") closeLauncher();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

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
                focused={w.z === topZ}
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
                <Frame win={w} palette={prefs?.palette} shield={dragging} onRestart={() => patch(w.key, (c) => ({ reload: c.reload + 1 }))} onClose={() => close(w.key)} />
                {/* clicks inside an iframe never reach us, so unfocused windows get a click-catcher */}
                {w.z !== topZ && <div className="shield" onPointerDown={() => focus(w.key)} />}
              </WindowFrame>
            </Boundary>
          );
        })}
      </div>
      <Taskbar>
        <TaskButton icon="start" label="Start" active={launcher && !query} onClick={() => (launcher ? closeLauncher() : (setQuery(""), openLauncher()))} />
        <SearchField
          ref={searchBox}
          label="Search apps, files, guides"
          value={query}
          onFocus={() => !launcher && openLauncher()}
          onChange={(e) => (setQuery(e.target.value), setPicked(null))}
          onKeyDown={(e) => {
            const i = current ? results.findIndex((h) => h.key === current.key) : -1;
            if (e.key === "ArrowDown") (e.preventDefault(), setPicked(results[Math.min(results.length - 1, i + 1)] ?? null));
            else if (e.key === "ArrowUp") (e.preventDefault(), setPicked(results[Math.max(0, i - 1)] ?? null));
            else if (e.key === "Enter" && current) (e.preventDefault(), run(current));
          }}
        />
        {apps.map((a) => {
          const mine = wins.filter((w) => w.app.id === a.id);
          return <TaskButton key={a.id} icon={a.icon} label={a.name} running={mine.length > 0} active={focused?.app.id === a.id} onClick={() => launch(a)} />;
        })}
        {natives.map((n) => (
          <span key={n.id} onContextMenu={(e) => (e.preventDefault(), post("/os/native/close", { id: n.id }))}>
            <TaskButton icon="app" label={`${n.title || n.app || "Native app"} (right-click to close)`} running active={n.focused} onClick={() => post("/os/native/focus", { id: n.id })} />
          </span>
        ))}
        <Tray>
          {note && <TrayItem label={note}>{note}</TrayItem>}
          {canRestart && <TrayItem icon="edit" label="Edit the interface (opens its source in Files)" onClick={() => openPath("/BrasOS")} />}
          {canRestart && <TrayItem icon="restart" label="Restart the interface" onClick={() => setConfirmRestart(true)} />}
          {user && <TrayItem icon="user" label={`Signed in as ${user.display}`} />}
          {onLock && <TrayItem icon="lock" label="Lock the screen" onClick={onLock} />}
          <Mode packages={packages} />
          <Network />
          <Battery />
          <Clock timezone={prefs?.timezone} clock24={prefs?.clock24} />
        </Tray>
      </Taskbar>
      {launcher && (
        <>
          <div style={{ position: "absolute", inset: 0, zIndex: 899 }} onPointerDown={closeLauncher} />
          <Launcher hits={results} selected={current} onSelect={setPicked} onRun={run} query={query} />
        </>
      )}
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
