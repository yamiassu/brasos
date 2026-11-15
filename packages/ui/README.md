# ui

`@brasos/ui`: the basic components for building an OS interface, and the design tokens that style the whole system. Written in React, no runtime dependencies. Reference: [`docs/guide/06-ui-kit.md`](../../docs/guide/06-ui-kit.md).

```tsx
import { Button, List } from "@brasos/ui";
import "@brasos/ui/ui.css";
```

- **Components:** `Button`, `IconButton`, `TextField`, `Toolbar`, `Breadcrumb` (+ `splitPath`), `List`, `IconTile`, `Menu`, `Dialog`, `WindowFrame`, `Dock`, `Badge`.
- **Accessibility is built in:** roles and labels (icon buttons *require* a label), a keyboard-navigable list, Escape closes menus and dialogs, a focus ring on everything focusable.
- **Tokens** (`src/ui.css`): `--bg`, `--panel`, `--panel-2`, `--text`, `--muted`, `--accent`, `--danger`, `--warn`, `--border`, `--hover`, `--radius`, `--radius-sm`, `--gap`, `--font`, `--shadow`. Override them in `packages/shell/src/user.css` to restyle everything.

A test checks that every `ui-` class a component uses is defined in the stylesheet.

Tests: `test/ui.test.tsx` (server-rendered markup: roles, labels, selection state). Benchmarks: `bench.tsx` (rendering a 1000-row list and a 200-tile grid). Interaction (keyboard behavior in a real DOM) is exercised by using the apps; there is no DOM test environment yet.
