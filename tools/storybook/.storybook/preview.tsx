// Every story runs with the real tokens and the shell's user.css (edit either and the story updates), on the SDK polyfill:
// no BrasOS host is needed. The toolbar's "Palette" swaps the rare colors, to try a mood without editing files.
import type { Preview } from "@storybook/react-vite";
import "../../../packages/ui/src/ui.css";
import "../../../packages/shell/src/user.css";

// The guides, for the Docs app. Rendered crudely (headings and paragraphs): the real renderer is Bun's, on the host.
const guides = import.meta.glob("../../../docs/guide/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const pages = Object.entries(guides)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([file, md]) => {
    const slug = file.split("/").pop()!.replace(/^\d+-/, "").replace(/\.md$/, "");
    const title = md.match(/^#\s+(.+)$/m)?.[1] ?? slug;
    const html = md
      .split(/\n{2,}/)
      .map((b) => (/^#{1,3}\s/.test(b) ? `<h${b.match(/^#+/)![0].length}>${esc(b.replace(/^#+\s+/, ""))}</h${b.match(/^#+/)![0].length}>` : `<p>${esc(b)}</p>`))
      .join("\n");
    return { slug, title, html };
  });
(globalThis as any).__brasosPolyfill = {
  standalone: true, // served from localhost, but not BrasOS: use the polyfills
  docs: {
    list: async () => pages.map(({ slug, title }) => ({ slug, title })),
    page: async (slug: string) => pages.find((p) => p.slug === slug) ?? Promise.reject(new Error("no such page")),
  },
};

const PALETTES: Record<string, Record<string, string>> = {
  "Amber and coral": {},
  "Mint and violet": { "--accent": "#38f2c0", "--accent-2": "#8f7bff", "--on-accent": "#03110d" },
  "Ice and blue": { "--accent": "#7fd4ff", "--accent-2": "#5b7cff", "--on-accent": "#021018" },
  "Mono": { "--accent": "#ffffff", "--accent-2": "#9a9aa2", "--on-accent": "#0c0c0d" },
};

const preview: Preview = {
  globalTypes: {
    palette: { description: "The rare colors", toolbar: { title: "Palette", icon: "paintbrush", items: Object.keys(PALETTES), dynamicTitle: true } },
  },
  initialGlobals: { palette: "Amber and coral" },
  decorators: [
    (Story, ctx) => {
      const el = document.documentElement;
      for (const k of ["--accent", "--accent-2", "--on-accent"]) el.style.removeProperty(k);
      for (const [k, v] of Object.entries(PALETTES[ctx.globals.palette] ?? {})) el.style.setProperty(k, v);
      return (
        <div className="ui-root">
          <Story />
        </div>
      );
    },
  ],
  parameters: { layout: "fullscreen", backgrounds: { disabled: true }, controls: { disable: false } },
};
export default preview;
