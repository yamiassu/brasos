// What Religare remembers: favorites, history and preferences, in the OS database (`os.db`, the app's own space), so they
// survive a restarted window (which gets a fresh origin, and so would lose localStorage). Needs the `db.own` permission.
import { useCallback, useEffect, useRef, useState } from "react";
import { os } from "@brasos/sdk";
import { idFor, type EngineId, type Mark } from "./urls";

export type Prefs = { engine: EngineId; homepage: string; bookmarksBar: boolean };
export const DEFAULTS: Prefs = { engine: "duckduckgo", homepage: "", bookmarksBar: true };

const favorites = () => os.db.collection("favorites");
const history = () => os.db.collection("history");
const settings = () => os.db.collection("settings");

const toMark = (r: { id: string; doc: any }): Mark => ({ id: r.id, url: String(r.doc.url), title: String(r.doc.title ?? ""), at: Number(r.doc.at) || 0 });

export function useStore() {
  const [favs, setFavs] = useState<Mark[]>([]);
  const [hist, setHist] = useState<Mark[]>([]);
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULTS);
  const last = useRef({ url: "", at: 0 });

  const loadFavs = useCallback(() => favorites().list({ order: { field: "at", dir: "asc" }, limit: 500 }).then((l) => setFavs(l.map(toMark))).catch(() => {}), []);
  const loadHist = useCallback(
    // the newest 1000 visits are shown; the database's own size limit bounds the rest (ponytail: no pruning, add one if it grows)
    () => history().list({ order: { field: "at", dir: "desc" }, limit: 1000 }).then((l) => setHist(l.map(toMark))).catch(() => {}),
    [],
  );

  useEffect(() => {
    loadFavs();
    loadHist();
    settings().get("prefs").then((r) => setPrefsState({ ...DEFAULTS, ...r.doc })).catch(() => {});
    const stops = [favorites().watch(loadFavs), history().watch(loadHist), settings().watch((e) => e.doc && setPrefsState({ ...DEFAULTS, ...e.doc }))];
    return () => stops.forEach((s) => s());
  }, []);

  return {
    favs, hist, prefs,
    isFav: (url: string) => favs.some((f) => f.url === url),
    toggleFav(url: string, title: string) {
      const id = idFor(url);
      return favs.some((f) => f.id === id) ? favorites().delete(id) : favorites().put({ url, title, at: Date.now() }, id);
    },
    removeFav: (id: string) => favorites().delete(id),
    /** one entry per visit; reloading the same page within 30 s is not a new visit */
    visit(url: string, title: string) {
      const now = Date.now();
      if (last.current.url === url && now - last.current.at < 30_000) return;
      last.current = { url, at: now };
      return history().put({ url, title, at: now });
    },
    removeVisit: (id: string) => history().delete(id),
    async clearHistory() {
      const all = await history().list({ limit: 1000 });
      await Promise.all(all.map((r) => history().delete(r.id)));
      if (all.length >= 1000) return this.clearHistory();
    },
    setPrefs(patch: Partial<Prefs>) {
      const next = { ...prefs, ...patch };
      setPrefsState(next);
      return settings().put(next, "prefs");
    },
  };
}
