import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { os } from "@brasos/sdk";
import { List } from "@brasos/ui";
import "@brasos/ui/ui.css";
import "./docs.css";

type Page = { slug: string; title: string };

function Docs() {
  const [pages, setPages] = useState<Page[]>([]);
  const [slug, setSlug] = useState(decodeURIComponent(location.hash.replace(/^#/, "")));
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");

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

  const current = pages.find((p) => p.slug === slug) ?? null;
  return (
    <div className="docs">
      <nav aria-label="Pages">
        <List label="Pages" items={pages} selected={current} getKey={(p) => p.slug} onSelect={(p) => (location.hash = p.slug)} render={(p) => p.title} />
      </nav>
      <main id="page" tabIndex={-1}>
        {error ? <p className="error" role="alert">{error}</p> : <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />}
      </main>
    </div>
  );
}

// the page mounts when there is a #root; Storybook imports the component instead
const mount = document.getElementById("root");
if (mount) createRoot(mount).render(<Docs />);

export { Docs };
