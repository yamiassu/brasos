# Building apps

An app is a small web app in its own folder. You need [Bun](https://bun.sh); run `bun install` once, then `bun run dev` and open `http://localhost:7000`.

## The smallest app

Create `apps/hello/` with three files.

**manifest.webmanifest**

```json
{ "name": "Hello", "short_name": "Hello", "start_url": "/", "display": "standalone",
  "brasos": { "icon": "👋", "permissions": ["fs.read"] } }
```

**index.html**

```html
<!doctype html>
<html><head><meta charset="utf-8" /><title>Hello</title></head>
<body><div id="root" class="ui-root"></div><script type="module" src="./main.tsx"></script></body></html>
```

**main.tsx**

```tsx
import { createRoot } from "react-dom/client";
import { os } from "@brasos/sdk";
import { Button } from "@brasos/ui";
import "@brasos/ui/ui.css";

createRoot(document.getElementById("root")!).render(
  <Button onClick={async () => alert((await os.fs.list("/Desktop")).length + " items on the desktop")}>Count</Button>,
);
```

Restart `bun run dev`. The app appears on the desktop and on the taskbar.

## Rules

- **Import `@brasos/sdk`.** Importing it also lets the shell tell your app apart from a hung one. An app that never does is reported as "not responding".
- **Declare permissions.** Calling a capability you did not list returns 403. Ask for as little as you need.
- **Be keyboard friendly.** The UI kit components already are; keep it that way.

## Running on the hardened image

Apps are left out of the hardened image unless the manifest says `"hardened": true`. Only opt in apps that need no capability beyond reading the guides or listing apps.

## An app with server code

Some features need the host, for example the terminal. Add `apps/<id>/server.ts`:

```ts
import { json, type Slice, type AuditFn } from "@brasos/host/types";

export const createSlice = ({ audit }: { audit: AuditFn }): Slice => ({
  name: "hello",
  tools: [], // actions an AI agent may call: see Agents
  handle(req, ctx) {
    if (ctx.url.pathname !== "/os/hello") return;
    const g = ctx.gate("hello.say"); // checks the permission, the packages' policies, and records the decision
    if (!g.ok) return g.res;
    return json({ hello: "world" });
  },
});
```

The host loads it only if the app is available, so the hardened image never imports it. Route handling always goes through `ctx.gate`: never decide who may call in your own code.

## Testing and measuring

Put tests next to the code (`apps/<id>/test/*.test.ts`, run with `bun test`) and test the **refused** case as well as the allowed one. Anything new that runs code gets a benchmark in `bench.ts` (`bun run bench`).
