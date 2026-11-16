// The start menu in Storybook: the pinned apps, your files, and the sign-in footer. Type to see the search results.
import { useState } from "react";
import { Taskbar, TaskButton, SearchField, Tray, TrayItem } from "@brasos/ui";
import { Launcher, search, type Hit } from "./launcher";

const app = (id: string, label: string, icon: string): Hit => ({ key: "a:" + id, kind: "App", icon, label, meta: "App", run: () => {} });
const ALL: Hit[] = [
  app("files", "Files", "files"), app("religare", "Religare", "religare"), app("docs", "Docs", "docs"), app("terminal", "Terminal", "terminal"),
  app("settings", "Settings", "settings"), app("tasks", "Task Manager", "pulse"), app("packages", "Packages", "package"), app("about", "About", "about"),
  { key: "f:1", kind: "File", icon: "text", label: "ideas.md", meta: "/Documents", run: () => {} },
  { key: "f:2", kind: "File", icon: "text", label: "hello.txt", meta: "/Desktop", run: () => {} },
  { key: "f:3", kind: "folder" as any, icon: "folder", label: "Projects", meta: "/Documents", run: () => {} },
];

export default { title: "Shell/Start menu", parameters: { layout: "fullscreen" } };
export const Default = () => {
  const [query, setQuery] = useState("");
  const results = search(ALL, query);
  const [picked, setPicked] = useState<Hit | null>(null);
  return (
    <div className="ui-root" style={{ position: "relative", height: "100vh", overflow: "hidden" }}>
      <Taskbar>
        <div className="ui-task-left">
          <TaskButton icon="brasos" label="Start" active={!query} />
          <SearchField label="Search apps, files, guides" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="ui-task-apps">
          {["files", "religare", "docs"].map((n) => <TaskButton key={n} icon={n} label={n} running active={n === "docs"} />)}
        </div>
        <Tray><TrayItem icon="network" label="Network: connected" /><TrayItem label="Clock"><span className="stack"><span>02:17</span><span>15/11</span></span></TrayItem></Tray>
      </Taskbar>
      <Launcher hits={results} selected={picked ?? results[0] ?? null} onSelect={setPicked} onRun={() => {}} query={query}
        files={ALL.filter((h) => h.kind === "File")} user="Rafael"
        actions={[{ label: "Lock the screen", icon: "lock", onClick: () => {} }, { label: "Restart the interface", icon: "restart", onClick: () => {} }]} />
    </div>
  );
};
