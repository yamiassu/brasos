# UI kit

`@brasos/ui` has the basic components for building an interface, written in React with no runtime dependencies. The shell, Files and Docs are all built from it.

```tsx
import { Button, List } from "@brasos/ui";
import "@brasos/ui/ui.css";
```

Put `class="ui-root"` on your root element and import `ui.css` once.

## Components

| Component | What it is |
|---|---|
| `Button` | `variant`: `default`, `primary`, `danger`, `ghost` |
| `IconButton` | A button with only an icon. The `label` is required: it is what screen readers and agents see |
| `TextField` | A labelled input |
| `Toolbar` | A row of actions (`role="toolbar"`, needs a `label`) |
| `Breadcrumb` | A path as clickable parts. `splitPath(path)` is exported too |
| `List` | A keyboard list: Up/Down/Home/End move, Enter opens, double-click opens. Controlled by `selected` |
| `IconTile` | A glyph with a label, for desktops and file grids. Enter or double-click opens |
| `Menu` | A context menu at a position. Escape or an outside click closes it |
| `Dialog` | A modal with a title and actions. Escape or the backdrop closes it |
| `WindowFrame` | A window's title bar and body; dragging is up to you, via `headerProps` |
| `Dock`, `Badge` | The bottom bar and a status notice |

Every component sets its roles and labels itself, so an interface built from them is usable with a keyboard and a screen reader without extra work.

## Visual identity: Aurora

BrasOS is dark, and it glows. The base is a night forest (near-black with a green-teal cast); edges light up like neon; surfaces catch a little light from above; the colors are those of living things that make their own light.

- **Neon edges.** Windows and dialogs have a gradient rim (mint to violet) drawn behind a solid panel, plus a soft glow. Buttons light their edge on hover; focus is a glow, not a hard outline.
- **Light gradients.** `--sheen` is a faint light falling on a surface (toolbars, title bars, menus); `--aurora` is the mint-to-violet gradient for primary actions and rims. The desktop is night with a few soft aurora glows.
- **Colors from nature.** Mint (`--accent`) is bioluminescent plankton, violet (`--accent-2`) is the aurora, amber (`--firefly`) is for warnings and the dev marker, coral (`--coral`, also `--danger`) is reef. Use the glow sparingly: one bright thing per area, so it stays meaningful.
- **Cost.** Everything is gradients, shadows and borders: no images, no animation. The one blur is behind dialogs.

## Tokens

Everything is styled with CSS variables, so the whole OS can be restyled by changing a few values:

| Variable | Used for |
|---|---|
| `--bg`, `--panel`, `--panel-2` | Backgrounds, from the page to raised surfaces |
| `--text`, `--muted`, `--on-accent` | Text, and text on a filled glow |
| `--accent`, `--accent-2`, `--firefly`, `--coral` | The living colors; `--danger` and `--warn` point at coral and firefly |
| `--border`, `--border-strong`, `--hover`, `--selected` | Lines and fills, all tinted by `--accent` |
| `--glow`, `--glow-soft`, `--aurora`, `--sheen` | Neon shadow, a quieter one, the gradient, the light on surfaces |
| `--radius`, `--radius-sm`, `--gap` | Shape and spacing |
| `--font`, `--shadow` | Type and elevation |

Change `--accent` and `--accent-2` and every edge, glow and gradient follows. A different mood is a few lines in `user.css`, for example a warmer one: `:root { --accent: #ffb454; --accent-2: #ff6b9a; }`.

See [Customizing](09-customizing.md) for where to override them.
