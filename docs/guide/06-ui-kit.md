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

## Tokens

Everything is styled with CSS variables, so the whole OS can be restyled by changing a few values:

| Variable | Used for |
|---|---|
| `--bg`, `--panel`, `--panel-2` | Backgrounds, from the page to raised surfaces |
| `--text`, `--muted` | Text |
| `--accent`, `--danger`, `--warn` | Highlights, destructive actions, notices |
| `--border`, `--hover` | Lines and hover fills |
| `--radius`, `--radius-sm`, `--gap` | Shape and spacing |
| `--font`, `--shadow` | Type and elevation |

See [Customizing](09-customizing.md) for where to override them.
