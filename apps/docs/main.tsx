import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { os } from "@brasos/sdk";
import { Icon } from "@brasos/ui";
import "@brasos/ui/ui.css";
import "./docs.css";

type Page = { slug: string; title: string };
type Toc = { id: string; text: string }[];

/** the BrasOS mark, inline so the app needs no image */
const Mark = () => (
  <svg width="28" height="28" viewBox="0 0 96 96" aria-hidden="true">
    <defs>
      <linearGradient id="dm" gradientUnits="userSpaceOnUse" x1="0" y1="16" x2="0" y2="80"><stop offset="0" stopColor="#5fd39a" /><stop offset="1" stopColor="#9b87f5" /></linearGradient>
    </defs>
    <rect x="29" y="16" width="10" height="64" rx="5" fill="#ececee" />
    <path d="M43 16h6a14 14 0 0 1 0 28h-6z" fill="url(#dm)" />
    <path d="M43 48h8a16 16 0 0 1 0 32h-8z" fill="url(#dm)" />
  </svg>
);

/** give every h2 an id and collect them for the "On this page" list (the html is our own content, rendered on the host) */
function withToc(html: string): { html: string; toc: Toc } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const toc: Toc = [];
  doc.body.querySelectorAll("h2").forEach((h, i) => {
    h.id = `s${i}`;
    toc.push({ id: h.id, text: h.textContent ?? "" });
  });
  doc.body.querySelectorAll("blockquote").forEach((b) => b.classList.add("callout"));
  return { html: doc.body.innerHTML, toc };
}

function Docs() {
  const [pages, setPages] = useState<Page[]>([]);
  const [slug, setSlug] = useState(decodeURIComponent(location.hash.replace(/^#/, "")));
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    os.docs.list().then((p) => (setPages(p), !slug && p[0] && setSlug(p[0].slug))).catch((e) => setError(e.message));
    const onHash = () => setSlug(decodeURIComponent(location.hash.replace(/^#/, "")));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!slug) return;
    setError("");
    os.docs.page(slug).then((p) => (setHtml(p.html), document.getElementById("page")?.scrollTo(0, 0))).catch(() => (setHtml(""), setError("That page doesn't exist.")));
  }, [slug]);

  const idx = pages.findIndex((p) => p.slug === slug);
  const current = pages[idx] ?? null;
  const prev = pages[idx - 1], next = pages[idx + 1];
  const page = useMemo(() => withToc(html), [html]);
  const shown = pages.map((p, i) => ({ p, i })).filter(({ p }) => p.title.toLowerCase().includes(q.trim().toLowerCase()));
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="docs">
      <nav aria-label="Pages">
        <header className="brand"><Mark /><span>BrasOS <b>Docs</b></span></header>
        <label className="find"><Icon name="search" size={16} /><input type="search" placeholder="Filter guides" aria-label="Filter guides" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <ol className="pages">
          {shown.map(({ p, i }) => (
            <li key={p.slug}>
              <a href={`#${p.slug}`} aria-current={p.slug === slug ? "page" : undefined}><span className="num">{String(i + 1).padStart(2, "0")}</span>{p.title}</a>
            </li>
          ))}
          {!shown.length && <li className="none">No guide matches.</li>}
        </ol>
      </nav>
      <main id="page" tabIndex={-1}>
        {error ? <p className="error" role="alert">{error}</p> : (
          <div className="sheet">
            <article>
              {current && <p className="eyebrow">Guide {idx + 1} of {pages.length}</p>}
              <div className="prose" dangerouslySetInnerHTML={{ __html: page.html }} />
              <footer className="pager">
                {prev ? <a href={`#${prev.slug}`} className="prev"><small>Previous</small>{prev.title}</a> : <span />}
                {next ? <a href={`#${next.slug}`} className="next"><small>Next</small>{next.title}</a> : <span />}
              </footer>
            </article>
            {page.toc.length > 1 && (
              <aside aria-label="On this page">
                <h4>On this page</h4>
                {page.toc.map((t) => <a key={t.id} href={`#${t.id}`} onClick={(e) => (e.preventDefault(), jump(t.id))}>{t.text}</a>)}
              </aside>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// the page mounts when there is a #root; Storybook imports the component instead
const mount = document.getElementById("root");
if (mount) createRoot(mount).render(<Docs />);

export { Docs };
