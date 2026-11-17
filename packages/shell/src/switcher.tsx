// The Alt+Tab overlay: one card per window, the selected one lit, with a small picture of the window when there is one (a BrasOS window
// draws its own, the compositor reads a native one's) and its icon until then. The selected window is also previewed in place by the
// shell (brought to the front, the others dim).
import { Icon } from "@brasos/ui";
import type { SwItem } from "./switcher-model";

export function Switcher({ items, index, thumbs = {} }: { items: SwItem[]; index: number; thumbs?: Record<string, string> }) {
  return (
    <div className="switcher" role="dialog" aria-label="Switch windows" aria-live="polite">
      <ul>
        {items.map((it, i) => (
          <li key={it.id} className={`${i === index ? "on" : ""}${thumbs[it.id] ? " shot" : ""}`.trim() || undefined} aria-current={i === index ? "true" : undefined}>
            {thumbs[it.id] ? <img src={thumbs[it.id]} alt="" /> : <Icon name={it.icon} size={34} />}
            <span className="t">{it.title}</span>
            {it.minimized && <small>Minimized</small>}
            {it.kind === "native" && <small>Native app</small>}
          </li>
        ))}
      </ul>
      <p className="hint">Tab next · Shift+Tab back · release Alt to switch · Esc to cancel</p>
    </div>
  );
}
