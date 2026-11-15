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
| `WindowFrame` | A window's title bar and body; `focused` makes it glow brighter; dragging is up to you, via `headerProps` |
| `Icon` | One of the OS's line icons by name, or text if the name isn't one |
| `Taskbar`, `TaskButton`, `SearchField`, `Tray`, `TrayItem` | The bottom bar: app buttons that show running and focused state, a search box, and a tray for status (clock, network, mode). `Dock` and `Badge` are the older, simpler bar |

Every component sets its roles and labels itself, so an interface built from them is usable with a keyboard and a screen reader without extra work.

## Visual identity: Aurora

BrasOS is dark, neutral and quiet. The surface is grey; color is rare, so that it stands out when it appears. Where attention is, edges light up like neon, and the color is that of living things that make their own light (amber, with coral as its partner).

- **Color is a signal.** It appears only on: the **focused window** (a gradient rim and glow; `WindowFrame` takes `focused`; the others stay grey), keyboard focus, the selected row, the primary button, and dialogs. Danger and notices have their own colors. Everything else, including every icon at rest, is grey. Nothing is saturated: the amber is soft, and the coral is muted.
- **Neon edges.** The focused window and dialogs have a gradient rim (amber to coral) drawn behind a solid panel, plus a glow.
- **Light gradients.** `--sheen` is a faint light falling on a surface (toolbars, title bars, menus); `--aurora` is the amber-to-coral gradient for primary actions and rims. The desktop is night with a few soft aurora glows.
- **Colors from nature.** Amber (`--accent`) is fireflies and embers, coral (`--accent-2`) is reef. Danger is a separate alarm red (`--danger`) and notices are pale gold (`--warn`), so neither looks decorative. Keep it rare: one bright thing per area, so it stays meaningful.
- **Icons.** `Icon` draws the OS's line icons (`about`, `browser`, `docs`, `files`, `folder`, `terminal`, `text`, `image`, `link`, `edit`, `restart`, `app`, ...) as inline SVG: grey strokes with a dimmer detail; hover or selection lights them amber and coral. An app names its icon in the manifest (`"brasos": { "icon": "files" }`); any other text, such as an emoji, is shown as is.
- **Cost.** Everything is gradients, shadows and borders: no images, no animation. The one blur is behind dialogs.

## Tokens

Everything is styled with CSS variables, so the whole OS can be restyled by changing a few values:

| Variable | Used for |
|---|---|
| `--bg`, `--panel`, `--panel-2` | Backgrounds, from the page to raised surfaces |
| `--text`, `--muted`, `--on-accent` | Text, and text on a filled glow |
| `--accent`, `--accent-2` | The living colors (amber and coral) |
| `--danger`, `--warn` | Alarm red and pale gold |
| `--icon`, `--icon-2` | Icons at rest (main stroke and detail) |
| `--border`, `--border-strong`, `--hover`, `--selected` | Lines and fills: neutral |
| `--glow`, `--aurora`, `--sheen` | Neon shadow, the gradient, the light on surfaces |
| `--radius`, `--radius-sm`, `--gap` | Shape and spacing |
| `--font`, `--shadow` | Type and elevation |

Change `--accent` and `--accent-2` and every glow and gradient follows. A different mood is a few lines in `user.css`, for example a cool one: `:root { --accent: #38f2c0; --accent-2: #8f7bff; }`.

See [Customizing](09-customizing.md) for where to override them.

## Trying it without the OS

The repository has a Storybook (`bun run storybook`, then open http://localhost:6006) with every component, the icon set, the palette, a whole desktop, and the Files and Docs apps. It runs in a plain browser: outside BrasOS the SDK falls back to polyfills (an in-memory file tree for `os.fs`), which is also how your own apps can be developed without booting anything. A *Palette* menu in its toolbar swaps the two rare colors so you can try a mood before editing `user.css`.
