// The icon set: line icons, each its own silhouette and its own color. Grey strokes with the detail in the icon's color. Plain inline SVG, no images.
// `Icon` takes a name from this set; anything else (an emoji from an older manifest, a PWA's text) is shown as text.
import type { ReactNode } from "react";

// `d` is the main stroke (--icon), `hi` the detail, drawn in its own color `c` (each icon has one).
const SET: Record<string, { d: string; hi?: string; c?: string }> = {
  about: { d: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z", hi: "M12 11v5M12 8v.01", c: "#6cb6ff" },
  religare: { d: "M9 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10zM15 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10z", hi: "M12 8.2a5 5 0 0 1 0 7.6a5 5 0 0 1 0-7.6z", c: "#9b87f5" },
  browser: { d: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z", hi: "M15.5 8.5l-2 5l-5 2l2-5z", c: "#6cb6ff" },
  globe: { d: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM3.5 12h17", hi: "M12 3c-3 3-3 15 0 18c3-3 3-15 0-18z", c: "#4fd1c5" },
  crash: { d: "M12 2l2 7l7-2l-5 5l5 5l-7-2l-2 7l-2-7l-7 2l5-5l-5-5l7 2z", hi: "M12 10v3M12 15.5v.01", c: "#ff7a7a" },
  docs: { d: "M12 6C10 4.5 7 4 4 4.5v14c3-.5 6 0 8 1.5c2-1.5 5-2 8-1.5v-14C17 4 14 4.5 12 6z", hi: "M12 6v14", c: "#f0b429" },
  files: { d: "M7 3h7l4 4v10H7z", hi: "M4 7v14h11M14 3v4h4", c: "#ffb454" },
  folder: { d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", hi: "M3 10h18", c: "#f0b429" },
  terminal: { d: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM7 9l3 3l-3 3", hi: "M12 15h5", c: "#5fd39a" },
  file: { d: "M6 3h8l4 4v14H6zM14 3v4h4", c: "#9aa0aa" },
  text: { d: "M6 3h8l4 4v14H6zM14 3v4h4", hi: "M9 12h6M9 16h4", c: "#9b87f5" },
  image: { d: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", hi: "M3 17l5-5l4 4l3-3l6 6M9 9.5v.01", c: "#ff8fb1" },
  link: { d: "M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1", hi: "M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1", c: "#4fd1c5" },
  edit: { d: "M4 20l1-4L16 5l3 3L8 19z", hi: "M14 7l3 3", c: "#f0b429" },
  restart: { d: "M20 12a8 8 0 1 1-2.5-5.8", hi: "M20 4v5h-5", c: "#6cb6ff" },
  search: { d: "M11 5a6 6 0 1 0 0 12a6 6 0 0 0 0-12z", hi: "M16 16l5 5", c: "#ffb454" },
  start: { d: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z", c: "#9b87f5" },
  network: { d: "M3 9a13 13 0 0 1 18 0M6 13a8 8 0 0 1 12 0M9.5 16.5a3 3 0 0 1 5 0", hi: "M12 20v.01", c: "#5fd39a" },
  offline: { d: "M3 9a13 13 0 0 1 18 0M6 13a8 8 0 0 1 12 0M9.5 16.5a3 3 0 0 1 5 0", hi: "M4 4l16 16", c: "#ff7a7a" },
  battery: { d: "M3 8h15a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM21 11v2", hi: "M5 11v2M8 11v2", c: "#a3e635" },
  shield: { d: "M12 3l8 3v6c0 5-3.5 8-8 9c-4.5-1-8-4-8-9V6z", hi: "M9 12l2 2l4-4", c: "#5fd39a" },
  dev: { d: "M8 8l-4 4l4 4M16 8l4 4l-4 4", hi: "M13 6l-2 12", c: "#ff8fb1" },
  pulse: { d: "M3 12h4l2.5-7l4 14l2.5-7h5", hi: "M3 21h18", c: "#5fd39a" },
  settings: { d: "M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z", hi: "M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8", c: "#9b87f5" },
  chip: { d: "M7 7h10v10H7z", hi: "M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4", c: "#5fd39a" },
  display: { d: "M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", hi: "M9 21h6M12 17v4", c: "#6cb6ff" },
  sound: { d: "M4 10v4h3.5L12 18V6L7.5 10z", hi: "M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11", c: "#ff8fb1" },
  plug: { d: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0z", hi: "M12 17v4", c: "#ffb454" },
  package: { d: "M3 9h18v11H3zM3 9l2-5h14l2 5", hi: "M10 13h4", c: "#ffb454" },
  brasos: { d: "M8 4v16", hi: "M12 4h2a3.5 3.5 0 0 1 0 7h-2zM12 13h3a3.5 3.5 0 0 1 0 7h-3z", c: "#5fd39a" },
  disk: { d: "M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", hi: "M7 14h6M17 14h.01", c: "#6cb6ff" },
  trash: { d: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13", hi: "M10 11v6M14 11v6", c: "#ff8fb1" },
  user: { d: "M12 4a4 4 0 1 0 0 8a4 4 0 0 0 0-8z", hi: "M4 20c1-4 4-6 8-6s7 2 8 6", c: "#6cb6ff" },
  lock: { d: "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z", hi: "M8 11V8a4 4 0 0 1 8 0v3", c: "#f0b429" },
  app: { d: "M12 3l8 4.5v9L12 21l-8-4.5v-9z", hi: "M4 7.5l8 4.5l8-4.5M12 12v9", c: "#9b87f5" },
};

export const iconNames = Object.keys(SET);

export function Icon({ name, size = 24 }: { name: string; size?: number }): ReactNode {
  const i = SET[name];
  if (!i) return <span className="ui-icon-text">{name}</span>;
  return (
    <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={i.d} className="m" />
      {i.hi && <path d={i.hi} className="h" style={{ stroke: i.c }} />}
    </svg>
  );
}
