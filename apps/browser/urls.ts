// The address bar's logic, apart from the UI so it can be tested: what a typed line means (an address or a search),
// suggestions from favorites and history, and history grouped by day. Pure functions.

export const ENGINES = {
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
  bing: { name: "Bing", url: "https://www.bing.com/search?q=" },
  brave: { name: "Brave Search", url: "https://search.brave.com/search?q=" },
  wikipedia: { name: "Wikipedia", url: "https://en.wikipedia.org/w/index.php?search=" },
} as const;
export type EngineId = keyof typeof ENGINES;

export type Target = { kind: "url" | "search"; url: string } | { kind: "blocked"; url: "" };

const HOSTLIKE = /^(localhost|[\w-]+(\.[\w-]+)+|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#]|$)/i;

/** what a typed line means: an address (http or https only), a search, or something we won't open */
export function toTarget(raw: string, engine: EngineId = "duckduckgo"): Target | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(javascript|data|file|blob|about):/i.test(t)) {
    try {
      const u = new URL(t);
      return u.protocol === "http:" || u.protocol === "https:" ? { kind: "url", url: u.href } : { kind: "blocked", url: "" };
    } catch {
      return { kind: "blocked", url: "" };
    }
  }
  if (!/\s/.test(t) && HOSTLIKE.test(t)) {
    try {
      return { kind: "url", url: new URL((/^(localhost|\d{1,3}(\.\d{1,3}){3})/i.test(t) ? "http://" : "https://") + t).href };
    } catch {}
  }
  return { kind: "search", url: ENGINES[engine].url + encodeURIComponent(t) };
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
};
export const isSecure = (url: string) => url.startsWith("https://");

/** a letter and a color for a site, where a favicon would go (we load no third-party images) */
export function siteBadge(url: string): { letter: string; hue: number } {
  const h = hostOf(url) || "?";
  let n = 0;
  for (const c of h) n = (n * 31 + c.charCodeAt(0)) % 360;
  return { letter: h[0].toUpperCase(), hue: n };
}

export type Mark = { id: string; url: string; title: string; at: number };
export type Suggestion = { url: string; title: string; kind: "favorite" | "history" };

/** up to `n` matches for what is typed: favorites first, then history, each address once */
export function suggest(q: string, favorites: Mark[], history: Mark[], n = 6): Suggestion[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hit = (m: Mark) => words.every((w) => m.url.toLowerCase().includes(w) || m.title.toLowerCase().includes(w));
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const [list, kind] of [[favorites, "favorite"], [history, "history"]] as const) {
    for (const m of list) {
      if (out.length >= n) return out;
      if (seen.has(m.url) || !hit(m)) continue;
      seen.add(m.url);
      out.push({ url: m.url, title: m.title || hostOf(m.url), kind });
    }
  }
  return out;
}

/** history, newest first, split into "Today", "Yesterday" and dated groups */
export function groupByDay(items: Mark[], now = new Date()): { label: string; items: Mark[] }[] {
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const today = day(now.getTime());
  const groups: { label: string; items: Mark[] }[] = [];
  for (const m of [...items].sort((a, b) => b.at - a.at)) {
    const d = day(m.at);
    const label = d === today ? "Today" : d === today - 864e5 ? "Yesterday" : new Date(d).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(m);
    else groups.push({ label, items: [m] });
  }
  return groups;
}

/** a stable short id for an address, so a favorite is stored once */
export function idFor(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) >>> 0;
  return "b" + h.toString(36);
}
