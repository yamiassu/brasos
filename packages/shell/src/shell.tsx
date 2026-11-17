import { useEffect, useRef, useState } from "react";
import type { AppInfo, FsEntry } from "@brasos/sdk";
import { isReloadKey, nativeMenu } from "@brasos/sdk";
import { Button, Dialog, Icon, Menu, SearchField, Taskbar, TaskButton, TextField, Tray, TrayItem, WindowFrame, type MenuItem } from "@brasos/ui";
import { connectAgent, type ShellApi } from "./agent";
import { Desktop } from "./desktop";
import { Launcher, search, type Hit } from "./launcher";
import { isPinned, loadUnpinned, saveUnpinned, setPinned, type Unpinned, type Where } from "./pins";
import { Battery, Clock, Mode, Network } from "./tray";
import { atTopEdge, Boundary, DEFAULT_W, Frame, frameSrc, restoreLeft, type Win } from "./windows";
import { InstallPrompt, type Inspection } from "./install";
import { NativeWindows, type NativeWin } from "./native";

const post = (path: string, body: unknown) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const getJson = (path: string) => fetch(path).then((r) => r.json());

export function Shell({ prefs, user, username, onLock, hasPin, onPinChanged, windowVars }: { prefs?: { timezone: string; clock24: boolean; palette: string }; windowVars?: Record<string, string>; user?: { display: string }; username?: string; onLock?: () => void; hasPin?: boolean; onPinChanged?: () => void }) {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [wins, setWins] = useState<Win[]>([]);
  const [dragging, setDragging] = useState(false);
  const [packages, setPackages] = useState<string[] | null>(null);
  const [canRestart, setCanRestart] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [canPower, setCanPower] = useState(false);
  const [confirmPower, setConfirmPower] = useState<"poweroff" | "reboot" | null>(null);
  const [pinDlg, setPinDlg] = useState<{ password: string; pin: string; again: string; error: string; busy: boolean } | null>(null);
  const savePin = async (remove: boolean) => {
    if (!pinDlg) return;
    if (!remove && pinDlg.pin !== pinDlg.again) return setPinDlg({ ...pinDlg, error: "The two PINs are not the same" });
    setPinDlg({ ...pinDlg, busy: true, error: "" });
    const r = await post("/os/pin", { username, password: pinDlg.password, pin: remove ? null : pinDlg.pin });
    if (!r.ok) {
      const error = r.status === 401 ? "Wrong password" : (await r.json().catch(() => ({}))).error ?? "Could not save the PIN";
      return setPinDlg((d) => d && { ...d, busy: false, password: "", error });
    }
    setPinDlg(null);
    setNote(remove ? "PIN removed" : "PIN saved. Use it on the lock screen.");
    onPinChanged?.();
  };
  // dev: make an app from inside the OS (id + name), shown as a dialog
  const [newApp, setNewApp] = useState<{ id: string; name: string; error?: string; busy?: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [launcher, setLauncher] = useState(false);
  const [query, setQuery] = useState("");
  const [unpinned, setUnpinned] = useState<Unpinned>(loadUnpinned);
  const [showAll, setShowAll] = useState(false);
  const [appMenu, setAppMenu] = useState<{ x: number; y: number; app: AppInfo } | null>(null);
  const pin = (where: Where, id: string, pinned: boolean) => setUnpinned((u) => { const n = setPinned(u, where, id, pinned); saveUnpinned(n); return n; });
  const [picked, setPicked] = useState<Hit | null>(null);
  const [extra, setExtra] = useState<{ files: Hit[]; guides: Hit[] }>({ files: [], guides: [] });
  const searchBox = useRef<HTMLInputElement>(null);
  const frames = useRef(new Map<number, HTMLIFrameElement>()); // window key -> its iframe, to tell which window a message came from
  // an app asked to install a PWA: the shell shows what it wants and the user decides; the answer goes back to the asking window
  const [install, setInstall] = useState<{ info: Inspection; manifestUrl: string; reply(r: unknown): void; busy?: boolean; error?: string } | null>(null);
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
    getJson("/os/info").then((i) => (setPackages(i.packages), setCanRestart(!!i.restart), setCanPower(!!i.power)));
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

  const [nativeApps, setNativeApps] = useState<{ id: string; name: string; icon: string; takesUrl?: boolean }[]>([]);
  useEffect(() => {
    fetch("/os/native/apps").then((r) => (r.ok ? r.json() : { apps: [] })).then((r) => setNativeApps(r.apps ?? [])).catch(() => {});
  }, []);
  // The real browser (a Chromium window beside the desktop, from its own profile) is the default Browser where the image has one; the
  // Browser app (sites through the gateway, inside BrasOS) stays as "Sandboxed browser". A window that asks the shell to open the Browser
  // app, or an address, gets the real one.
  const realBrowser = nativeApps.some((n) => n.id === "web" && n.takesUrl);
  const openReal = async (url?: string) => {
    const r = await post("/os/native/launch", { id: "web", ...(url && /^https?:\/\//.test(url) ? { url } : {}) });
    if (!r.ok) setNote("Could not open the browser");
    return r.ok;
  };
  const open = async (app: AppInfo, hash?: string, opts: { sandbox?: boolean } = {}) => {
    if (app.id === "browser" && realBrowser && !opts.sandbox) return openReal(hash?.startsWith("url=") ? decodeURI(hash.slice(4)) : undefined);
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
    setFront("pwa");
    setWins((w) => [...w, { key, app, x: 60 + 30 * (w.length % 8), y: 30 + 30 * (w.length % 8), z, reload: 0, src, hash }]);
    return true;
  };
  const openPath = (path: string) => {
    const files = apps.find((a) => a.id === "files");
    return files ? open(files, path) : (setNote("Files isn't available here"), Promise.resolve(false));
  };
  const powerNow = async (action: "poweroff" | "reboot") => {
    setConfirmPower(null);
    const r = await post("/os/system/power", { action });
    setNote(r.ok ? (action === "poweroff" ? "Shutting down…" : "Restarting the computer…") : "Refused");
  };
  const restart = async () => {
    setConfirmRestart(false);
    const r = await post("/os/system/restart", {});
    setNote(r.ok ? "Restarting the interface…" : "Restart refused");
  };
  // rebuild the shell and the apps from the source on disk, then reload this page: edits show up without a restart
  const reload = async () => {
    setNote("Rebuilding…");
    const r = await post("/os/system/rebuild", {});
    if (!r.ok) return setNote(`Rebuild failed: ${(await r.json().catch(() => ({}))).error ?? r.status}`);
    location.reload();
  };
  const createApp = async () => {
    if (!newApp) return;
    setNewApp({ ...newApp, busy: true, error: undefined });
    const r = await post("/os/system/app", { id: newApp.id, name: newApp.name });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return setNewApp({ ...newApp, busy: false, error: body.error ?? `failed (${r.status})` });
    setNewApp(null);
    await loadApps();
    setNote(`Created ${body.name}: edit it in /BrasOS/apps/${body.id}, then Reload`);
    openPath(`/BrasOS/apps/${body.id}`);
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
  const closeLauncher = () => (setLauncher(false), setQuery(""), setPicked(null), setShowAll(false));
  const patch = (key: number, f: (w: Win) => Partial<Win>) => setWins((ws) => ws.map((w) => (w.key === key ? { ...w, ...f(w) } : w)));
  const close = (key: number) => setWins((ws) => ws.filter((w) => w.key !== key));
  // which kind of window is in front: native windows are drawn by the compositor above the whole shell, so while a BrasOS window is
  // in front, the native windows it overlaps are hidden (NativeWindows `cover`); focusing a native window shows them again
  const [front, setFront] = useState<"pwa" | "native">("native");
  const focus = (key: number) => {
    setFront("pwa");
    const z = seq.current++;
    patch(key, () => ({ z, min: false })); // focusing a minimized window brings it back
  };
  const minimize = (key: number) => patch(key, () => ({ min: true }));
  const toggleMax = (key: number) => patch(key, (c) => ({ max: !c.max }));
  /** a drag that starts on a maximized window returns it to its normal size, with the pointer where it was on the title bar */
  const unmaxAt = (w: Win, pointerX: number) => patch(w.key, () => ({ max: false, x: restoreLeft(pointerX, innerWidth, w.w ?? DEFAULT_W), y: 0 }));
  const dragFrom = useRef({ x: 0, y: 0 });
  // dragging a window to the top edge shows a preview of the maximized window, and releasing there maximizes it
  const [snap, setSnapState] = useState<number | null>(null);
  const snapRef = useRef<number | null>(null);
  const setSnap = (key: number | null) => ((snapRef.current = key), setSnapState(key));
  const dropSnap = (key: number) => {
    if (snapRef.current === key) patch(key, () => ({ max: true }));
    setSnap(null);
  };
  // a minimized window is still running but is not the one with the focus
  const shown = wins.filter((w) => !w.min);
  const topZ = Math.max(0, ...shown.map((w) => w.z));
  const focused = shown.find((w) => w.z === topZ);
  /** an app's button: focus its window if it has one, else open it */
  const launch = (app: AppInfo) => {
    const mine = wins.filter((w) => w.app.id === app.id);
    if (mine.length) focus(mine.reduce((a, b) => (a.z > b.z ? a : b)).key);
    else open(app);
  };
  /** the taskbar button: open the app, bring its window back, or minimize it when it already has the focus (the way a taskbar behaves) */
  const toggleTask = (app: AppInfo) => {
    const mine = wins.filter((w) => w.app.id === app.id);
    if (!mine.length) return void open(app);
    const top = mine.reduce((a, b) => (a.z > b.z ? a : b));
    if (!top.min && top === focused) minimize(top.key);
    else focus(top.key);
  };
  /** the right-click menu of an app, on the taskbar or in the start menu */
  const appMenuItems = (a: AppInfo): MenuItem[] => {
    const mine = wins.filter((w) => w.app.id === a.id);
    const tb = isPinned(unpinned, "taskbar", a.id), st = isPinned(unpinned, "start", a.id);
    return [
      { label: mine.length ? "New window" : "Open", onSelect: () => (closeLauncher(), void open(a)) },
      ...(mine.length ? [{ label: mine.length > 1 ? "Close all windows" : "Close window", danger: true, onSelect: () => mine.forEach((w) => close(w.key)) }] : []),
      { label: tb ? "Unpin from taskbar" : "Pin to taskbar", onSelect: () => pin("taskbar", a.id, !tb) },
      { label: st ? "Unpin from Start" : "Pin to Start", onSelect: () => pin("start", a.id, !st) },
    ];
  };
  const hits: Hit[] = [
    ...apps.map((a) => ({ key: "a:" + a.id, kind: "App" as const, icon: a.icon, label: a.name, meta: "App", run: () => launch(a) })),
    ...nativeApps.map((n) => ({ key: "n:" + n.id, kind: "App" as const, icon: n.icon, label: n.name, meta: "Native app", run: () => void post("/os/native/launch", { id: n.id }) })),
    ...wins.map((w) => ({ key: "w:" + w.key, kind: "Window" as const, icon: w.app.icon, label: w.app.name, meta: "Open window", run: () => focus(w.key) })),
    ...extra.files,
    ...extra.guides,
  ];
  // with nothing typed the start menu lists the pinned apps (or every app, after "All apps"); natives are always listed
  const startPinned = (h: Hit) => !h.key.startsWith("a:") || isPinned(unpinned, "start", h.key.slice(2));
  const results = query ? search(hits, query) : search(hits, "").filter((h) => showAll || startPinned(h));
  const current = picked && results.find((h) => h.key === picked.key) ? picked : results[0] ?? null;
  const run = (h: Hit) => (closeLauncher(), h.run());
  // Native (non-PWA) windows owned by the compositor, where there is one (packages/native): listed once a second, focus on click
  const [natives, setNatives] = useState<NativeWin[]>([]);
  useEffect(() => {
    let stop = false;
    const tick = () =>
      fetch("/os/native", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { windows: [] }))
        .then((r) => !stop && setNatives((old) => (JSON.stringify(old) === JSON.stringify(r.windows) ? old : r.windows)))
        .catch(() => {});
    tick();
    const t = setInterval(tick, 500);
    return () => (stop = true, clearInterval(t));
  }, []);
  const lastNative = useRef<number | undefined>(undefined);
  useEffect(() => {
    const f = natives.find((n) => n.focused)?.id;
    if (f !== undefined && f !== lastNative.current) setFront("native");
    lastNative.current = f;
  }, [natives]);
  const frameEl = focused && frames.current.get(focused.key);
  const cover = front === "pwa" && focused && frameEl
    ? focused.max ? { x: 0, y: 0, w: innerWidth, h: innerHeight } : (({ left, top, width, height }) => ({ x: left, y: top - 40, w: width, h: height + 40 }))(frameEl.getBoundingClientRect())
    : null;
  // the browser's own right-click menu (with Reload and Inspect) never shows over the desktop
  useEffect(() => {
    const onMenu = (e: MouseEvent) => nativeMenu(e) && e.preventDefault();
    addEventListener("contextmenu", onMenu);
    return () => removeEventListener("contextmenu", onMenu);
  }, []);
  // a theme change reaches the windows that are already open (a window that opens later is told when it loads)
  useEffect(() => {
    if (!windowVars) return;
    for (const w of wins) if (!w.src) frames.current.get(w.key)?.contentWindow?.postMessage({ brasos: "prefs", vars: windowVars }, new URL(frameSrc(w)).origin);
  }, [windowVars]);
  // Ctrl+K from anywhere in the shell (a window's iframe keeps its own keys)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isReloadKey(e)) e.preventDefault(); // a reload would close every window and lose unsaved work
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") (e.preventDefault(), openLauncher(), searchBox.current?.focus());
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
      // an app that applies system updates (Settings) offers a restart; the sender is decided by its origin, and the shell's own dialog confirms
      else if (kind === "restart-computer") {
        const from = apps.find((a) => a.id === new URL(e.origin).hostname.replace(/\.localhost$/, "").split("--")[0]);
        if (canPower && from?.permissions.includes("system.update")) setConfirmPower("reboot");
      }
      else if (kind === "install" && typeof e.data.manifestUrl === "string" && typeof e.data.nonce === "string") {
        const from = apps.find((a) => a.id === new URL(e.origin).hostname.replace(/\.localhost$/, "").split("--")[0]);
        const reply = (r: unknown) => (e.source as Window | null)?.postMessage({ brasos: "install-result", nonce: e.data.nonce, ...(r as object) }, { targetOrigin: e.origin });
        if (!from?.permissions.includes("apps.install")) return reply({ error: "this app may not ask to install apps" });
        post("/os/apps/inspect", { manifestUrl: e.data.manifestUrl })
          .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error ?? `inspect failed (${r.status})`))))
          .then((info) => setInstall({ info, manifestUrl: e.data.manifestUrl, reply }))
          .catch((err) => reply({ error: String(err.message ?? err) }));
      }
      // a window controlling itself (SDK os.window): which window is decided by the iframe that sent it, never by a claimed id
      else if (kind === "window") {
        const w = wins.find((x) => frames.current.get(x.key)?.contentWindow === e.source);
        if (!w || !w.app.permissions.includes("window.control")) return;
        const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
        const { op } = e.data;
        if (op === "close") close(w.key);
        else if (op === "focus") focus(w.key);
        else if (op === "minimize") minimize(w.key);
        else if (op === "maximize") toggleMax(w.key);
        else if (op === "title" && typeof e.data.title === "string") patch(w.key, () => ({ title: e.data.title.slice(0, 80) }));
        else if (op === "moveBy") {
          const dx = num(e.data.dx, -4000, 4000), dy = num(e.data.dy, -4000, 4000);
          if (dx === null || dy === null) return;
          const ax = num(e.data.x, -20000, 20000), ay = num(e.data.y, -20000, 20000); // the app says where its pointer is, in its own window
          if (!w.max) {
            patch(w.key, (c) => ({ x: c.x + dx, y: Math.max(0, c.y + dy) }));
            if (ay !== null) setSnap(atTopEdge(Math.max(0, w.y + dy) + ay) ? w.key : null);
          } else if (ax !== null) unmaxAt(w, ax);
        } else if (op === "moveEnd") {
          dropSnap(w.key);
        } else if (op === "resize") {
          const ww = num(e.data.w, 200, 8000), hh = num(e.data.h, 120, 8000);
          if (ww !== null && hh !== null) patch(w.key, () => ({ w: ww, h: hh }));
        }
      }
      else if (kind === "open") {
        const from = apps.find((a) => a.id === new URL(e.origin).hostname.replace(/\.localhost$/, "").split("--")[0]);
        const target = apps.find((a) => a.id === e.data.id);
        // a web address is only passed to the browser app, and only http(s)
        const url = typeof e.data.url === "string" && e.data.url.length <= 2048 && /^https?:\/\//i.test(e.data.url) ? e.data.url : undefined;
        if (from?.permissions.includes("apps.open") && target) open(target, url && target.id === "browser" ? "url=" + url : undefined);
      }
    };
    addEventListener("message", onMsg);
    return () => removeEventListener("message", onMsg);
  }, [apps, wins, canPower]);

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
        {snap !== null && <div className="snap-preview" aria-hidden="true" style={{ zIndex: (wins.find((x) => x.key === snap)?.z ?? 0) + 1 }} />}
        {wins.map((w) => {
          const pos = w.max
            ? { left: 0, top: 0, width: "100%", height: "100%", zIndex: w.z + 2 }
            : { left: w.x, top: w.y, zIndex: w.z + 2, ...(w.w ? { width: w.w } : {}), ...(w.h ? { height: w.h } : {}) };
          return (
            <Boundary key={w.key} style={pos} onClose={() => close(w.key)}>
              <WindowFrame
                title={w.title ?? w.app.name}
                icon={w.app.icon}
                bare={w.app.window?.frame === false}
                focused={w === focused}
                maximized={!!w.max}
                minimized={!!w.min}
                style={pos}
                onClose={() => close(w.key)}
                onMinimize={() => minimize(w.key)}
                onMaximize={() => toggleMax(w.key)}
                onResize={(ww, hh) => patch(w.key, () => ({ w: ww, h: hh }))}
                onResizeStart={() => (setDragging(true), focus(w.key))}
                onResizeEnd={() => setDragging(false)}
                headerProps={{
                  onPointerDown: (e) => {
                    dragFrom.current = { x: e.clientX, y: e.clientY };
                    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {} // a pointer that is already gone can't be captured
                    setDragging(true);
                    focus(w.key);
                  },
                  onPointerMove: (e) => {
                    if (!e.buttons) return;
                    if (!w.max) {
                      setSnap(atTopEdge(e.clientY) ? w.key : null);
                      return patch(w.key, (c) => ({ x: c.x + e.movementX, y: Math.max(0, c.y + e.movementY) }));
                    }
                    // a click or a double click must not un-maximize: only a real drag (more than a few pixels) does
                    if (Math.hypot(e.clientX - dragFrom.current.x, e.clientY - dragFrom.current.y) > 4) unmaxAt(w, e.clientX);
                  },
                  onPointerUp: () => (setDragging(false), dropSnap(w.key)),
                  onPointerCancel: () => (setDragging(false), setSnap(null)),
                }}
              >
                <Frame win={w} onRef={(el) => (el ? frames.current.set(w.key, el) : frames.current.delete(w.key))} vars={windowVars} shield={dragging} onRestart={() => patch(w.key, (c) => ({ reload: c.reload + 1 }))} onClose={() => close(w.key)} />
                {/* clicks inside an iframe never reach us, so unfocused windows get a click-catcher */}
                {w !== focused && <div className="shield" onPointerDown={() => focus(w.key)} />}
              </WindowFrame>
            </Boundary>
          );
        })}
      </div>
      <NativeWindows natives={natives} cover={cover} />
      <Taskbar>
        <div className="ui-task-left">
        <TaskButton icon="brasos" label="Start" active={launcher && !query} onClick={() => (launcher ? closeLauncher() : (setQuery(""), openLauncher()))} />
        <SearchField
          ref={searchBox}
          label="Search apps, files, guides"
          value={query}
          onFocus={() => !launcher && openLauncher()}
          onChange={(e) => (setQuery(e.target.value), setPicked(null))}
          onKeyDown={(e) => {
            const i = current ? results.findIndex((h) => h.key === current.key) : -1;
            const grid = !query; // the start menu's pinned apps are a grid: Left and Right step through it too
            if (e.key === "ArrowDown" || (grid && e.key === "ArrowRight")) (e.preventDefault(), setPicked(results[Math.min(results.length - 1, i + 1)] ?? null));
            else if (e.key === "ArrowUp" || (grid && e.key === "ArrowLeft")) (e.preventDefault(), setPicked(results[Math.max(0, i - 1)] ?? null));
            else if (e.key === "Enter" && current) (e.preventDefault(), run(current));
          }}
        />
        </div>
        <div className="ui-task-apps">
        {apps.filter((a) => isPinned(unpinned, "taskbar", a.id) || wins.some((w) => w.app.id === a.id)).map((a) => {
          const mine = wins.filter((w) => w.app.id === a.id);
          // right-click opens the app's menu, which has Close: the way out of a window that draws its own frame (and has no close button of ours)
          return <span key={a.id} onContextMenu={(e) => (e.preventDefault(), setAppMenu({ x: e.clientX, y: e.clientY, app: a }))}><TaskButton icon={a.icon} label={a.name} running={mine.length > 0} active={focused?.app.id === a.id} onClick={() => toggleTask(a)} /></span>;
        })}
        {natives.map((n) => (
          <span key={n.id} onContextMenu={(e) => (e.preventDefault(), post("/os/native/close", { id: n.id }))}>
            <TaskButton icon="app" label={`${n.title || n.app || "Native app"} (right-click to close)`} running active={n.focused} onClick={() => post("/os/native/focus", { id: n.id })} />
          </span>
        ))}
        </div>
        <Tray>
          {note && <TrayItem label={note}>{note}</TrayItem>}
          <Mode packages={packages} />
          <Network />
          <Battery />
          <Clock timezone={prefs?.timezone} clock24={prefs?.clock24} />
        </Tray>
      </Taskbar>
      {launcher && (
        <>
          <div style={{ position: "absolute", inset: 0, zIndex: 899 }} onPointerDown={closeLauncher} />
          <Launcher
            hits={results} selected={current} onSelect={setPicked} onRun={run} query={query}
            showAll={showAll} onToggleAll={() => setShowAll((v) => !v)}
            onContext={(h, e) => { const app = apps.find((a) => "a:" + a.id === h.key); if (app) setAppMenu({ x: e.clientX, y: e.clientY, app }); }}
            files={extra.files.slice(0, 5)} user={user?.display}
            actions={[...(realBrowser ? [{ label: "Sandboxed browser (inside BrasOS)", icon: "browser", onClick: () => { closeLauncher(); const b = apps.find((x) => x.id === "browser"); if (b) void open(b, undefined, { sandbox: true }); } }] : []), ...(onLock ? [{ label: "Lock the screen", icon: "lock", onClick: () => (closeLauncher(), onLock()) }, { label: hasPin ? "Change or remove the PIN" : "Set a sign-in PIN", icon: "lock", onClick: () => (closeLauncher(), setPinDlg({ password: "", pin: "", again: "", error: "", busy: false })) }] : []), ...(canRestart ? [{ label: "Edit the interface (opens its source in Files)", icon: "edit", onClick: () => (closeLauncher(), openPath("/BrasOS")) }, { label: "New app", icon: "plus", onClick: () => (closeLauncher(), setNewApp({ id: "", name: "" })) }, { label: "Reload the interface (no restart)", icon: "reload", onClick: () => (closeLauncher(), reload()) }, { label: "Restart the interface", icon: "restart", onClick: () => (closeLauncher(), setConfirmRestart(true)) }] : []), ...(canPower ? [{ label: "Restart the computer", icon: "restart", onClick: () => (closeLauncher(), setConfirmPower("reboot")) }, { label: "Shut down", icon: "power", onClick: () => (closeLauncher(), setConfirmPower("poweroff")) }] : [])]}
          />
        </>
      )}
      {appMenu && <Menu items={appMenuItems(appMenu.app)} x={appMenu.x} y={appMenu.y} onClose={() => setAppMenu(null)} />}
      {newApp && (
        <Dialog
          title="New app"
          onClose={() => setNewApp(null)}
          actions={<><Button onClick={() => setNewApp(null)}>Cancel</Button><Button variant="primary" disabled={newApp.busy || !newApp.id || !newApp.name} onClick={createApp}>{newApp.busy ? "Creating…" : "Create"}</Button></>}
        >
          <TextField label="Name" autoFocus value={newApp.name} onChange={(e) => setNewApp({ ...newApp, name: e.target.value, id: newApp.id || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) })} />
          <TextField label="Id (lowercase, dashes)" value={newApp.id} onChange={(e) => setNewApp({ ...newApp, id: e.target.value.toLowerCase() })} />
          <p className="muted">Creates apps/{newApp.id || "<id>"} in the OS source, builds it and adds it to the launcher.</p>
          {newApp.error && <p role="alert" className="setup-error">{newApp.error}</p>}
        </Dialog>
      )}
      {pinDlg && (
        <Dialog
          title="Sign-in PIN"
          onClose={() => setPinDlg(null)}
          actions={<>
            <Button onClick={() => setPinDlg(null)}>Cancel</Button>
            {hasPin && <Button variant="danger" disabled={pinDlg.busy || !pinDlg.password} onClick={() => savePin(true)}>Remove PIN</Button>}
            <Button variant="primary" disabled={pinDlg.busy || !pinDlg.password || pinDlg.pin.length < 4} onClick={() => savePin(false)}>Save PIN</Button>
          </>}
        >
          <p>Unlock the screen with 4 to 8 digits instead of the password. The password still works. After 5 wrong PINs in a row the PIN is switched off until you use the password.</p>
          <TextField label="Your password" type="password" autoFocus value={pinDlg.password} onChange={(e) => setPinDlg({ ...pinDlg, password: e.target.value })} autoComplete="current-password" />
          <TextField label="New PIN" type="password" inputMode="numeric" maxLength={8} value={pinDlg.pin} onChange={(e) => setPinDlg({ ...pinDlg, pin: e.target.value.replace(/\D/g, "") })} autoComplete="off" />
          <TextField label="New PIN again" type="password" inputMode="numeric" maxLength={8} value={pinDlg.again} onChange={(e) => setPinDlg({ ...pinDlg, again: e.target.value.replace(/\D/g, "") })} autoComplete="off" />
          {pinDlg.error && <p role="alert" className="setup-error">{pinDlg.error}</p>}
        </Dialog>
      )}
      {confirmPower && (
        <Dialog
          title={confirmPower === "poweroff" ? "Shut down?" : "Restart the computer?"}
          onClose={() => setConfirmPower(null)}
          actions={<><Button onClick={() => setConfirmPower(null)}>Cancel</Button><Button autoFocus variant="danger" onClick={() => powerNow(confirmPower)}>{confirmPower === "poweroff" ? "Shut down" : "Restart"}</Button></>}
        >
          <p>Open windows are closed. Anything not saved is lost.</p>
        </Dialog>
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
      {install && (
        <InstallPrompt
          info={install.info}
          busy={install.busy}
          error={install.error}
          onCancel={() => (install.reply({ error: "cancelled" }), setInstall(null))}
          onInstall={async (grant) => {
            setInstall({ ...install, busy: true });
            const r = await post("/os/apps/install", { manifestUrl: install.manifestUrl, grant });
            const body = await r.json().catch(() => ({}));
            if (!r.ok) return setInstall({ ...install, error: body.error ?? `failed (${r.status})` });
            install.reply({ app: body });
            setInstall(null);
            loadApps();
          }}
        />
      )}
      <div className="layer">
        <Desktop apps={apps} entries={entries} onOpenApp={(a) => open(a)} onOpenPath={openPath} onRefresh={loadDesktop} />
      </div>
    </div>
  );
}
