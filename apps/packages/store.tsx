// "Get apps": install apps from Flathub (Flatpak) for this user, through the host (apps/packages/flatpak.ts). Installed apps show up in
// Start like the others. Where the system has no Flatpak (a plain browser, Storybook, the hardened image) the page says so.
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Icon } from "@brasos/ui";

type Installed = { id: string; name: string; version: string };
type Found = { id: string; name: string; summary: string };
type Job = { state: "idle" | "running" | "done" | "failed"; action: string; id: string; log: string; percent: number | null; started: number; last: number };
type State = { available: boolean; installed: Installed[]; job: Job };

const post = (path: string, body: unknown) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function Store() {
  const [st, setSt] = useState<State | null | "none">(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Found[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/flatpak", { cache: "no-store" });
      setSt(r.ok ? await r.json() : "none");
    } catch {
      setSt("none");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // while a job runs, follow it every second (and its clock); when it ends the installed list is already fresh
  const running = typeof st === "object" && st !== null && st.job.state === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => (setNow(Date.now()), void load()), 1000);
    return () => clearInterval(t);
  }, [running, load]);
  useEffect(() => {
    if (wasRunning.current && !running) void load();
    wasRunning.current = running;
  }, [running, load]);

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    setError("");
    try {
      const r = await fetch(`/flatpak/search?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setResults(d.results ?? []);
      else (setResults(null), setError(d.error ?? "the search failed"));
    } catch {
      setError("the search failed");
    } finally {
      setSearching(false);
    }
  };
  const change = async (action: "install" | "remove", id: string) => {
    setError("");
    const r = await post(`/flatpak/${action}`, { id }).catch(() => null);
    if (!r || !r.ok) setError(((await r?.json().catch(() => null)) as any)?.error ?? "that did not start");
    void load();
  };

  if (st === null) return <main className="store"><p className="empty">Checking…</p></main>;
  if (st === "none" || !st.available)
    return <main className="store"><p className="empty">The app store is not on this system. It needs the dev image with Flatpak, and the hardened image never has it.</p></main>;

  const have = new Set(st.installed.map((a) => a.id));
  const job = st.job;
  const secs = (ms: number) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);
  return (
    <main className="store">
      <form className="bar" onSubmit={search}>
        <label className="find"><Icon name="search" size={16} /><input type="search" placeholder="Search apps on Flathub (Steam, Discord, VLC…)" aria-label="Search apps" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <Button variant="primary" type="submit" disabled={searching || !q.trim()}>{searching ? "Searching…" : "Search"}</Button>
      </form>

      {job.state !== "idle" && (
        <div className="job" role="status">
          <p><strong>{job.state === "running" ? (job.action === "install" ? "Installing" : "Removing") : job.state === "done" ? "Done" : "Failed"}</strong> · {job.id}</p>
          {job.state === "running" && (
            <>
              <progress max={job.percent === null ? undefined : 100} value={job.percent ?? undefined} aria-label="Progress" />
              <p className="note">{job.percent !== null ? `${job.percent}% · ` : ""}running for {secs(now - job.started)} · last activity {secs(now - job.last)} ago</p>
            </>
          )}
          {job.state === "done" && job.action === "install" && <p className="note">Find it in Start. Games and big apps keep downloading data the first time they run.</p>}
          {job.state === "failed" && <p className="note" role="alert">{job.log.trim().split("\n").slice(-3).join(" · ") || "The tool reported an error."}</p>}
        </div>
      )}
      {error && <p className="note" role="alert">{error}</p>}

      <div className="split store-body">
        <section aria-label="Your apps">
          <h4>Your apps</h4>
          {st.installed.length === 0 && <p className="note">Nothing installed from the store yet.</p>}
          {st.installed.map((a) => (
            <div key={a.id} className="item">
              <Icon name="app" size={20} />
              <div className="what"><b>{a.name}</b><small>{a.id}{a.version ? ` · ${a.version}` : ""}</small></div>
              <Button variant="danger" disabled={running} onClick={() => void change("remove", a.id)}>Remove</Button>
            </div>
          ))}
        </section>
        <section aria-label="Search results">
          <h4>{results ? `Results for “${q.trim()}”` : "Search to find apps"}</h4>
          {results?.length === 0 && <p className="note">Nothing found.</p>}
          {results?.map((a) => (
            <div key={a.id} className="item">
              <Icon name="app" size={20} />
              <div className="what"><b>{a.name}</b><small>{a.summary || a.id}</small></div>
              {have.has(a.id) ? <span className="state installed">Installed</span> : <Button variant="primary" disabled={running} onClick={() => void change("install", a.id)}>Install</Button>}
            </div>
          ))}
        </section>
      </div>
      <p className="note foot">Apps come from Flathub and run as you, in their own sandbox; BrasOS doesn't review them.</p>
    </main>
  );
}
