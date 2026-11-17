// Religare: a browser. Tabs (each its own frame), an address bar that searches, favorites with a bar, history, private tabs,
// zoom, settings, and install-as-app. It never loads a site directly: every address goes through the OS web gateway
// (os.web.open), which gives the site its own origin, serves TypeScript as JavaScript and makes PWAs work. Sites report where
// they really are (the frame URL is a gateway URL) through the SDK the gateway injects. See README.md.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { isDevtoolsKey, os } from "@brasos/sdk";
import { BrandMark, Button, Dialog, Icon, IconButton, Menu, SelectField, TextField, useWindowDrag, WindowButtons, type MenuItem } from "@brasos/ui";
import "@brasos/ui/ui.css";
import "./browser.css";
import { useStore } from "./store";
import { ENGINES, groupByDay, hostOf, isSecure, siteBadge, suggest, toTarget, type EngineId, type Mark } from "./urls";

type Tab = { id: number; priv: boolean; stack: string[]; at: number; title: string; manifest: string | null; loading: boolean; error: string; zoom: number; pinned: boolean };
type Find = { open: boolean; q: string; found: boolean | null; count: number; idx: number };
type Panel = null | "favorites" | "history" | "settings";
const ZOOMS = [50, 67, 80, 90, 100, 110, 125, 150, 175, 200];

const Badge = ({ url, size = 18 }: { url: string; size?: number }) => {
  const b = siteBadge(url);
  return <span className="badge" style={{ width: size, height: size, background: `hsl(${b.hue} 45% 32%)`, fontSize: size * 0.55 }} aria-hidden="true">{b.letter}</span>;
};

function Religare() {
  const store = useStore();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState(0);
  const [omni, setOmni] = useState("");
  const [focused, setFocused] = useState(false);
  const [sel, setSel] = useState(-1);
  const [panel, setPanel] = useState<Panel>(null);
  const [filter, setFilter] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [status, setStatus] = useState("");
  const [find, setFind] = useState<Find>({ open: false, q: "", found: null, count: 0, idx: 0 });
  const findBox = useRef<HTMLInputElement>(null);
  const findWait = useRef(0);
  const dragId = useRef(0);
  const frames = useRef(new Map<number, HTMLIFrameElement>());
  const closed = useRef<{ url: string; priv: boolean }[]>([]);
  const seq = useRef(1);
  const omniBox = useRef<HTMLInputElement>(null);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(activeId);
  activeRef.current = activeId; // the message handler below reads the tabs as they are now, not as they were when it was made
  const tab = tabs.find((t) => t.id === activeId) ?? null;
  const url = tab && tab.at >= 0 ? tab.stack[tab.at] : "";
  const patch = (id: number, p: Partial<Tab> | ((t: Tab) => Partial<Tab>)) => setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...(typeof p === "function" ? p(t) : p) } : t)));

  // ---- the window: BrasOS draws no title bar for this app (manifest window.frame: false), so the tab strip is the title bar.
  // The shared behavior from @brasos/ui does the rest: drag, double click to maximize, restore under the pointer, snap to the top. ----
  const drag = useWindowDrag(os.window);
  useEffect(() => { os.window.setTitle(tab?.title ? `${tab.title} - Religare` : "Religare"); }, [tab?.title, activeId]);

  // ---- loading ----
  async function load(id: number, target: string) {
    patch(id, { loading: true, error: "" });
    try {
      const { url: gateway } = await os.web.open(target);
      const f = frames.current.get(id);
      if (f) f.src = gateway;
    } catch (e) {
      patch(id, { loading: false, error: (e as Error).message });
    }
  }
  function navigate(id: number, raw: string) {
    const t = toTarget(raw, store.prefs.engine);
    if (!t) return;
    if (t.kind === "blocked") return setStatus("Religare opens web addresses (http or https) only.");
    patch(id, (x) => ({ stack: [...x.stack.slice(0, x.at + 1), t.url], at: x.at + 1, manifest: null, title: "" }));
    load(id, t.url);
  }
  function newTab(opts: { url?: string; priv?: boolean } = {}) {
    const id = seq.current++;
    setTabs((ts) => [...ts, { id, priv: !!opts.priv, stack: [], at: -1, title: "", manifest: null, loading: false, error: "", zoom: 100, pinned: false }]);
    setActiveId(id);
    setPanel(null);
    const target = opts.url ?? (store.prefs.homepage || "");
    if (target) setTimeout(() => navigate(id, target), 0);
    else setTimeout(() => omniBox.current?.focus(), 0);
    return id;
  }
  function closeTab(id: number) {
    const i = tabs.findIndex((t) => t.id === id);
    const t = tabs[i];
    if (!t) return;
    const u = t.at >= 0 ? t.stack[t.at] : "";
    if (u && !t.priv) closed.current.push({ url: u, priv: false });
    frames.current.delete(id);
    const rest = tabs.filter((x) => x.id !== id);
    setTabs(rest);
    if (!rest.length) newTab();
    else if (id === activeId) setActiveId(rest[Math.min(i, rest.length - 1)].id);
  }
  const step = (d: number) => tabs.length && setActiveId(tabs[(tabs.findIndex((t) => t.id === activeId) + d + tabs.length) % tabs.length].id);
  const go = (d: -1 | 1) => {
    if (!tab) return;
    const at = tab.at + d;
    if (at < 0 || at >= tab.stack.length) return;
    patch(tab.id, { at, manifest: null });
    load(tab.id, tab.stack[at]);
  };
  const reload = () => tab && url && load(tab.id, url);
  const stop = () => {
    if (!tab) return;
    try { frames.current.get(tab.id)?.contentWindow?.stop(); } catch {}
    patch(tab.id, { loading: false });
  };

  // ---- find in page: the page (through the SDK the gateway injects) does the searching; we only ask and show the answer ----
  const askFind = (q: string, dir: "next" | "prev" = "next", restart = false) => {
    const f = tab && frames.current.get(tab.id);
    const reset = { q, found: null, count: 0, idx: 0 };
    if (!f || !f.getAttribute("src")) return setFind((x) => ({ ...x, ...reset, found: q ? false : null }));
    clearTimeout(findWait.current);
    const origin = new URL(f.src).origin;
    if (!q) return void (f.contentWindow?.postMessage({ brasos: "find", q: "" }, origin), setFind((x) => ({ ...x, ...reset })));
    f.contentWindow?.postMessage({ brasos: "find", q, dir, restart }, origin);
    // no answer means the page has no search support (it was not loaded through the gateway, or is still loading)
    findWait.current = window.setTimeout(() => setFind((x) => (x.q === q && x.found === null ? { ...x, found: false } : x)), 900);
    setFind((x) => ({ ...x, q, found: null }));
  };
  const openFind = () => { setFind((x) => ({ ...x, open: true })); setTimeout(() => (findBox.current?.focus(), findBox.current?.select()), 0); };
  const closeFind = () => { askFind(""); setFind({ open: false, q: "", found: null, count: 0, idx: 0 }); };
  useEffect(() => { if (find.open && find.q) askFind(find.q, "next", true); }, [activeId]); // another tab: search it too

  // ---- the frames report where they are ----
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.brasos === "found") {
        if (e.source === frames.current.get(activeRef.current)?.contentWindow)
          setFind((x) => (x.q === e.data.q ? { ...x, found: !!e.data.found, count: e.data.count ?? 0, idx: e.data.idx ?? 0 } : x));
        return;
      }
      if (e.data?.brasos !== "navigated") return;
      const id = [...frames.current].find(([, f]) => f.contentWindow === e.source)?.[0];
      if (id === undefined) return;
      const { url: u, title, manifest } = e.data as { url: string; title: string; manifest: string | null };
      const priv = tabsRef.current.find((t) => t.id === id)?.priv ?? true; // when unsure, remember nothing
      setTabs((ts) => ts.map((t) => {
        if (t.id !== id) return t;
        const moved = u !== t.stack[t.at];
        return { ...t, stack: moved ? [...t.stack.slice(0, t.at + 1), u] : t.stack, at: moved ? t.at + 1 : t.at, title, manifest, loading: false, error: "" };
      }));
      if (!priv) store.visit(u, title);
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  });

  // ---- the address bar ----
  useEffect(() => { if (!focused) setOmni(url); }, [url, activeId, focused]);
  const typed = focused && omni !== url;
  const sugg = typed ? suggest(omni, store.favs, store.hist) : [];
  const submit = (raw: string) => { if (tab) (navigate(tab.id, raw), omniBox.current?.blur()); };
  const starred = !!url && store.isFav(url);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const run = (f: () => void) => (e.preventDefault(), f());
      if (isDevtoolsKey(e)) return run(() => { const f = tab && frames.current.get(tab.id); f?.getAttribute("src") && f.contentWindow?.postMessage({ brasos: "devtools" }, new URL(f.src).origin); });
      if (e.altKey && e.key === "ArrowLeft") run(() => go(-1));
      else if (e.altKey && e.key === "ArrowRight") run(() => go(1));
      else if (!(e.ctrlKey || e.metaKey)) return;
      else if (k === "t" && e.shiftKey) run(() => { const c = closed.current.pop(); c && newTab({ url: c.url }); });
      else if (k === "t") run(() => newTab());
      else if (k === "n" && e.shiftKey) run(() => newTab({ priv: true }));
      else if (k === "w") run(() => tab && closeTab(tab.id));
      else if (k === "l") run(() => (omniBox.current?.focus(), omniBox.current?.select()));
      else if (k === "r") run(reload);
      else if (k === "f") run(openFind);
      else if (k === "d") run(() => tab && url && store.toggleFav(url, tab.title));
      else if (k === "h") run(() => setPanel((p) => (p === "history" ? null : "history")));
      else if (e.key === "Tab") run(() => step(e.shiftKey ? -1 : 1));
      else if (e.key === "=" || e.key === "+") run(() => zoomBy(1));
      else if (e.key === "-") run(() => zoomBy(-1));
      else if (e.key === "0") run(() => tab && patch(tab.id, { zoom: 100 }));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
  const zoomBy = (d: number) => tab && patch(tab.id, (t) => ({ zoom: ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(t.zoom) + d))] }));

  // opened with an address (from the Terminal, say): the shell puts it in the window hash
  useEffect(() => {
    let h = "";
    try { h = decodeURI(location.hash.slice(1)); } catch {}
    const u = h.startsWith("url=") ? h.slice(4) : "";
    newTab(/^https?:\/\//i.test(u) ? { url: u } : {});
  }, []);

  // ---- menus ----
  const openMenu = (e: { clientX: number; clientY: number }, items: MenuItem[]) => setMenu({ x: e.clientX, y: e.clientY, items });
  const mainMenu = (e: { clientX: number; clientY: number }) =>
    openMenu(e, [
      { label: "New tab", onSelect: () => newTab() },
      { label: "New private tab", onSelect: () => newTab({ priv: true }) },
      { label: "Find in page", onSelect: openFind },
      { label: "Copy address", onSelect: () => url && navigator.clipboard?.writeText(url).then(() => setStatus("Address copied"), () => setStatus("Couldn't copy the address")) },
      { label: "Favorites", onSelect: () => setPanel("favorites") },
      { label: "History", onSelect: () => setPanel("history") },
      { label: store.prefs.bookmarksBar ? "Hide favorites bar" : "Show favorites bar", onSelect: () => store.setPrefs({ bookmarksBar: !store.prefs.bookmarksBar }) },
      { label: `Zoom in (${tab?.zoom ?? 100}%)`, onSelect: () => zoomBy(1) },
      { label: "Zoom out", onSelect: () => zoomBy(-1) },
      { label: "Reset zoom", onSelect: () => tab && patch(tab.id, { zoom: 100 }) },
      { label: "Settings", onSelect: () => setPanel("settings") },
    ]);
  const tabMenu = (e: React.MouseEvent, t: Tab) => {
    e.preventDefault();
    const u = t.at >= 0 ? t.stack[t.at] : "";
    openMenu(e, [
      { label: "Reload", onSelect: () => u && load(t.id, u) },
      { label: "Duplicate", onSelect: () => u && newTab({ url: u, priv: t.priv }) },
      // pinned tabs sit first, so pinning moves the tab to the end of the pinned ones (and unpinning to just after them)
      { label: t.pinned ? "Unpin tab" : "Pin tab", onSelect: () => setTabs((ts) => { const rest = ts.filter((x) => x.id !== t.id); rest.splice(rest.filter((x) => x.pinned).length, 0, { ...t, pinned: !t.pinned }); return rest; }) },
      { label: "Close", onSelect: () => closeTab(t.id) },
      { label: "Close other tabs", onSelect: () => (setTabs((ts) => ts.filter((x) => x.id === t.id)), setActiveId(t.id)) },
    ]);
  };
  const favMenu = (e: React.MouseEvent, f: Mark) => {
    e.preventDefault();
    openMenu(e, [{ label: "Open in new tab", onSelect: () => newTab({ url: f.url }) }, { label: "Remove favorite", danger: true, onSelect: () => store.removeFav(f.id) }]);
  };
  const openFav = (e: React.MouseEvent, f: Mark) => (e.ctrlKey || e.button === 1 ? newTab({ url: f.url }) : tab && navigate(tab.id, f.url));

  const install = async () => {
    if (!tab?.manifest) return;
    try { setStatus(`Installed ${(await os.apps.install(tab.manifest)).name}`); } catch (e) { setStatus((e as Error).message); }
  };

  // ---- panels ----
  const q = filter.trim().toLowerCase();
  const match = (m: Mark) => !q || m.url.toLowerCase().includes(q) || m.title.toLowerCase().includes(q);
  const favList = store.favs.filter(match);
  const histGroups = groupByDay(store.hist.filter(match));

  return (
    <div className="rl">
      <div className="tabs" role="tablist" aria-label="Tabs" {...drag}>
        {tabs.map((t) => {
          const u = t.at >= 0 ? t.stack[t.at] : "";
          const name = t.title || hostOf(u) || (t.priv ? "Private tab" : "New tab");
          return (
            <div key={t.id} role="tab" aria-selected={t.id === activeId} tabIndex={t.id === activeId ? 0 : -1} className={`tab${t.priv ? " priv" : ""}${t.pinned ? " pinned" : ""}`} title={name}
              draggable onDragStart={() => (dragId.current = t.id)} onDragOver={(e) => e.preventDefault()}
              onDrop={() => dragId.current && dragId.current !== t.id && setTabs((ts) => { const m = ts.find((x) => x.id === dragId.current); if (!m || m.pinned !== t.pinned) return ts; const rest = ts.filter((x) => x.id !== m.id); rest.splice(rest.findIndex((x) => x.id === t.id), 0, m); return rest; })}
              onClick={() => setActiveId(t.id)} onAuxClick={(e) => e.button === 1 && closeTab(t.id)} onContextMenu={(e) => tabMenu(e, t)}
              onKeyDown={(e) => (e.key === "Enter" ? setActiveId(t.id) : e.key === "Delete" && closeTab(t.id))}>
              {t.loading ? <span className="spin" aria-label="Loading" /> : u ? <Badge url={u} /> : <Icon name={t.priv ? "lock" : "religare"} size={16} />}
              {!t.pinned && <span className="label">{name}</span>}
              {!t.pinned && <button type="button" className="x" aria-label={`Close ${name}`} onClick={(e) => (e.stopPropagation(), closeTab(t.id))}>×</button>}
            </div>
          );
        })}
        <button type="button" className="add" aria-label="New tab (Ctrl+T)" title="New tab (Ctrl+T)" onClick={() => newTab()}>+</button>
        <span className="ui-drag" />
        <WindowButtons window={os.window} />
      </div>

      <div className={`toolbar${tab?.priv ? " priv" : ""}`}>
        <IconButton label="Back (Alt+Left)" disabled={!tab || tab.at <= 0} onClick={() => go(-1)}>←</IconButton>
        <IconButton label="Forward (Alt+Right)" disabled={!tab || tab.at >= tab.stack.length - 1} onClick={() => go(1)}>→</IconButton>
        <IconButton label={tab?.loading ? "Stop" : "Reload (Ctrl+R)"} disabled={!url} onClick={tab?.loading ? stop : reload}>{tab?.loading ? "✕" : "↻"}</IconButton>
        <div className="omni">
          <span className={`sec ${url ? (isSecure(url) ? "ok" : "bad") : ""}`} title={url ? (isSecure(url) ? "Secure connection" : "Not secure") : ""}>{url ? (isSecure(url) ? <Icon name="lock" size={14} /> : "!") : <Icon name="search" size={14} />}</span>
          <input
            ref={omniBox} value={omni} placeholder="Search or enter an address" aria-label="Address" autoComplete="off" spellCheck={false} role="combobox" aria-expanded={sugg.length > 0}
            onChange={(e) => (setOmni(e.target.value), setSel(-1))}
            onFocus={(e) => (setFocused(true), e.currentTarget.select())}
            onBlur={() => setTimeout(() => setFocused(false), 120)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(sugg.length - 1, s + 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(-1, s - 1)));
              else if (e.key === "Enter") (e.preventDefault(), submit(sel >= 0 && sugg[sel] ? sugg[sel].url : omni));
              else if (e.key === "Escape") (setOmni(url), setSel(-1), e.currentTarget.blur());
            }}
          />
          <button type="button" className={`star${starred ? " on" : ""}`} disabled={!url} aria-pressed={starred} aria-label={starred ? "Remove favorite (Ctrl+D)" : "Add favorite (Ctrl+D)"} title="Favorite (Ctrl+D)" onClick={() => url && tab && store.toggleFav(url, tab.title)}>{starred ? "★" : "☆"}</button>
          {sugg.length > 0 && (
            <ul className="sugg" role="listbox" aria-label="Suggestions">
              {sugg.map((s, i) => (
                <li key={s.url} role="option" aria-selected={i === sel} onMouseDown={(e) => (e.preventDefault(), submit(s.url))}>
                  <Badge url={s.url} /><span className="t">{s.title}</span><span className="u">{hostOf(s.url) || s.url}</span><span className="k">{s.kind === "favorite" ? "★" : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {tab?.manifest && <Button onClick={install} title="Install this site as an app">Install</Button>}
        <IconButton label="Favorites" aria-pressed={panel === "favorites"} onClick={() => setPanel(panel === "favorites" ? null : "favorites")}>☰</IconButton>
        <IconButton label="Menu" onClick={mainMenu}>⋮</IconButton>
      </div>

      {store.prefs.bookmarksBar && (
        <div className="favbar" aria-label="Favorites bar">
          {store.favs.map((f) => (
            <button key={f.id} type="button" className="fav" title={f.url} onClick={(e) => openFav(e, f)} onAuxClick={(e) => e.button === 1 && openFav(e, f)} onContextMenu={(e) => favMenu(e, f)}>
              <Badge url={f.url} size={16} />{f.title || hostOf(f.url)}
            </button>
          ))}
          {!store.favs.length && <span className="hint">Press ☆ to add a page to your favorites.</span>}
        </div>
      )}
      <div className={`loadbar${tab?.loading ? " on" : ""}`} aria-hidden="true" />

      <div className="content">
        <div className="views">
        {find.open && (
          <div className="findbar" role="search" aria-label="Find in page">
            <input
              ref={findBox} value={find.q} placeholder="Find in page" aria-label="Find in page" spellCheck={false} autoComplete="off"
              onChange={(e) => askFind(e.target.value)}
              onKeyDown={(e) => (e.key === "Enter" ? (e.preventDefault(), askFind(find.q, e.shiftKey ? "prev" : "next")) : e.key === "Escape" && closeFind())}
            />
            <span className={`count${find.found === false && find.q ? " none" : ""}`} aria-live="polite">
              {!find.q ? "" : find.found === null ? "…" : find.found ? `${find.idx} of ${find.count}` : url ? "No matches" : "Nothing to search"}
            </span>
            <IconButton label="Previous match (Shift+Enter)" disabled={!find.found} onClick={() => askFind(find.q, "prev")}>↑</IconButton>
            <IconButton label="Next match (Enter)" disabled={!find.found} onClick={() => askFind(find.q, "next")}>↓</IconButton>
            <IconButton label="Close find (Esc)" onClick={closeFind}>✕</IconButton>
          </div>
        )}
          {tabs.map((t) => {
            const z = t.zoom / 100;
            const empty = t.at < 0;
            return (
              <div key={t.id} className="view" hidden={t.id !== activeId}>
                <iframe
                  ref={(el) => void (el ? frames.current.set(t.id, el) : frames.current.delete(t.id))} title={t.title || "Page"}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups" hidden={empty || !!t.error}
                  style={{ width: `${100 / z}%`, height: `${100 / z}%`, transform: `scale(${z})` }}
                  onLoad={(e) => e.currentTarget.src !== "about:blank" && e.currentTarget.getAttribute("src") && patch(t.id, { loading: false })}
                />
                {t.error && <div className="page error"><h2>Can't open this page</h2><p>{t.error}</p><Button variant="primary" onClick={() => load(t.id, t.stack[t.at])}>Try again</Button></div>}
                {empty && !t.error && (
                  <div className="page newtab">
                    <BrandMark size={56} />
                    <h1>{t.priv ? "Private tab" : "Religare"}</h1>
                    {t.priv && <p className="hint">Pages you visit here are not added to your history.</p>}
                    <form onSubmit={(e) => (e.preventDefault(), submit((new FormData(e.currentTarget).get("q") as string) ?? ""))}>
                      <input name="q" placeholder={`Search ${ENGINES[store.prefs.engine].name} or enter an address`} aria-label="Search or enter an address" autoComplete="off" spellCheck={false} />
                    </form>
                    {store.favs.length > 0 && (
                      <div className="tiles">
                        {store.favs.slice(0, 8).map((f) => <button key={f.id} type="button" onClick={(e) => openFav(e, f)} onContextMenu={(e) => favMenu(e, f)}><Badge url={f.url} size={36} /><span>{f.title || hostOf(f.url)}</span></button>)}
                      </div>
                    )}
                    {!t.priv && store.hist.length > 0 && (
                      <div className="recent"><h3>Recently visited</h3>{store.hist.slice(0, 5).map((h) => <button key={h.id} type="button" onClick={() => navigate(t.id, h.url)}><Badge url={h.url} /><span>{h.title || hostOf(h.url)}</span><small>{hostOf(h.url)}</small></button>)}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {panel && (
          <aside className="panel" aria-label={panel}>
            <header>
              <div role="tablist" aria-label="Panel">
                {(["favorites", "history", "settings"] as const).map((p) => <button key={p} role="tab" type="button" aria-selected={panel === p} onClick={() => (setPanel(p), setFilter(""))}>{p[0].toUpperCase() + p.slice(1)}</button>)}
              </div>
              <button type="button" className="x" aria-label="Close panel" onClick={() => setPanel(null)}>×</button>
            </header>
            {panel !== "settings" && <label className="find"><Icon name="search" size={14} /><input type="search" placeholder={`Search ${panel}`} aria-label={`Search ${panel}`} value={filter} onChange={(e) => setFilter(e.target.value)} /></label>}
            <div className="list">
              {panel === "favorites" && (favList.length ? favList.map((f) => (
                <div key={f.id} className="row"><button type="button" className="go" onClick={(e) => openFav(e, f)}><Badge url={f.url} /><span className="t">{f.title || hostOf(f.url)}</span><small>{hostOf(f.url)}</small></button><button type="button" className="x" aria-label={`Remove ${f.title}`} onClick={() => store.removeFav(f.id)}>×</button></div>
              )) : <p className="empty">{q ? "No favorite matches." : "No favorites yet. Press ☆ in the address bar."}</p>)}
              {panel === "history" && (histGroups.length ? (
                <>
                  <div className="bar"><Button variant="danger" onClick={() => setConfirmClear(true)}>Clear history</Button></div>
                  {histGroups.map((g) => (
                    <section key={g.label}><h4>{g.label}</h4>
                      {g.items.map((h) => (
                        <div key={h.id} className="row"><button type="button" className="go" onClick={(e) => openFav(e, h)}><Badge url={h.url} /><span className="t">{h.title || hostOf(h.url)}</span><small>{new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></button><button type="button" className="x" aria-label={`Remove ${h.title}`} onClick={() => store.removeVisit(h.id)}>×</button></div>
                      ))}
                    </section>
                  ))}
                </>
              ) : <p className="empty">{q ? "Nothing matches." : "No history yet."}</p>)}
              {panel === "settings" && (
                <div className="settings">
                  <SelectField label="Search engine" value={store.prefs.engine} onChange={(e) => store.setPrefs({ engine: e.target.value as EngineId })}>{Object.entries(ENGINES).map(([id, e]) => <option key={id} value={id}>{e.name}</option>)}</SelectField>
                  <TextField label="Home page (blank for the new tab page)" value={store.prefs.homepage} placeholder="https://" onChange={(e) => store.setPrefs({ homepage: e.target.value })} spellCheck={false} />
                  <label className="check"><input type="checkbox" checked={store.prefs.bookmarksBar} onChange={(e) => store.setPrefs({ bookmarksBar: e.target.checked })} />Show the favorites bar</label>
                  <p className="hint">Favorites, history and these settings are kept in this app's own space in the OS database. Private tabs add nothing to history.</p>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      <div className="status" role="status">{status || (tab?.loading ? "Loading…" : tab?.title) || ""}</div>

      {menu && <Menu items={menu.items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
      {confirmClear && (
        <Dialog title="Clear browsing history?" onClose={() => setConfirmClear(false)} actions={<><Button onClick={() => setConfirmClear(false)}>Cancel</Button><Button variant="danger" autoFocus onClick={() => (setConfirmClear(false), store.clearHistory())}>Clear</Button></>}>
          <p>All {store.hist.length} entries will be removed. Favorites are kept.</p>
        </Dialog>
      )}
    </div>
  );
}

// the page mounts when there is a #root; Storybook imports the component instead
const mount = document.getElementById("root");
if (mount) createRoot(mount).render(<Religare />);

export { Religare };
