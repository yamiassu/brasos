// The desktop: an icon for every app, then whatever is in the user's /Desktop folder. Double-click or Enter opens.
import { useState } from "react";
import type { AppInfo, FsEntry } from "@brasos/sdk";
import { IconTile, Menu } from "@brasos/ui";

const TEXT = /\.(txt|md|json|ts|tsx|js|css|html|csv|log|toml|ya?ml)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
export const iconFor = (e: FsEntry) => (e.kind === "dir" ? "📁" : e.kind === "link" ? "🔗" : TEXT.test(e.name) ? "📝" : IMAGE.test(e.name) ? "🖼️" : "📄");

export function Desktop({ apps, entries, onOpenApp, onOpenPath, onRefresh }: {
  apps: AppInfo[];
  entries: FsEntry[];
  onOpenApp(app: AppInfo): void;
  onOpenPath(path: string): void;
  onRefresh(): void;
}) {
  const [selected, setSelected] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      className="icons"
      role="group"
      aria-label="Desktop"
      onPointerDown={(e) => e.target === e.currentTarget && setSelected("")}
      onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY }))}
    >
      {apps.map((a) => (
        <IconTile key={"app:" + a.id} icon={a.icon} label={a.name} selected={selected === "app:" + a.id} onSelect={() => setSelected("app:" + a.id)} onOpen={() => onOpenApp(a)} />
      ))}
      {entries.map((e) => (
        <IconTile key={"fs:" + e.name} icon={iconFor(e)} label={e.name} selected={selected === "fs:" + e.name} onSelect={() => setSelected("fs:" + e.name)} onOpen={() => onOpenPath("/Desktop/" + e.name)} />
      ))}
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "Open Files", onSelect: () => onOpenPath("/Desktop") },
            { label: "Refresh", onSelect: onRefresh },
          ]}
        />
      )}
    </div>
  );
}
