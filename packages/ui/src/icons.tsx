// The icon set: line icons in the Aurora style (grey strokes with a dimmer detail; hover or selection lights them). Plain inline SVG, no images.
// `Icon` takes a name from this set; anything else (an emoji from an older manifest, a PWA's text) is shown as text.
import type { ReactNode } from "react";

// `d` is the main stroke (--icon), `hi` the detail (--icon-2); `danger` draws in --danger.
const SET: Record<string, { d: string; hi?: string; danger?: boolean }> = {
  about: { d: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z", hi: "M12 11v5M12 8v.01" },
  browser: { d: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM3.5 12h17", hi: "M12 3c-3 3-3 15 0 18c3-3 3-15 0-18z" },
  globe: { d: "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM3.5 12h17", hi: "M12 3c-3 3-3 15 0 18c3-3 3-15 0-18z" },
  crash: { d: "M12 2l2 7l7-2l-5 5l5 5l-7-2l-2 7l-2-7l-7 2l5-5l-5-5l7 2z", danger: true },
  docs: { d: "M12 6C10 4.5 7 4 4 4.5v14c3-.5 6 0 8 1.5c2-1.5 5-2 8-1.5v-14C17 4 14 4.5 12 6z", hi: "M12 6v14" },
  files: { d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", hi: "M3 10h18" },
  folder: { d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", hi: "M3 10h18" },
  terminal: { d: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM7 9l3 3l-3 3", hi: "M12 15h5" },
  file: { d: "M6 3h8l4 4v14H6zM14 3v4h4" },
  text: { d: "M6 3h8l4 4v14H6zM14 3v4h4", hi: "M9 12h6M9 16h4" },
  image: { d: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", hi: "M3 17l5-5l4 4l3-3l6 6M9 9.5v.01" },
  link: { d: "M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1", hi: "M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" },
  edit: { d: "M4 20l1-4L16 5l3 3L8 19z", hi: "M14 7l3 3" },
  restart: { d: "M20 12a8 8 0 1 1-2.5-5.8", hi: "M20 4v5h-5" },
  app: { d: "M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z", hi: "M9 12h6M12 9v6" },
};

export const iconNames = Object.keys(SET);

export function Icon({ name, size = 24 }: { name: string; size?: number }): ReactNode {
  const i = SET[name];
  if (!i) return <span className="ui-icon-text">{name}</span>;
  return (
    <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={i.d} className={i.danger ? "d" : "m"} />
      {i.hi && <path d={i.hi} className="h" />}
    </svg>
  );
}
