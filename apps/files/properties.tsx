// The properties bar: what is selected (one item, several, or the folder itself when nothing is).
import { useEffect, useState } from "react";
import { os, type FsEntry } from "@brasos/sdk";
import { formatSize, join } from "./paths";

const kindOf = (e: FsEntry) => (e.kind === "dir" ? "Folder" : e.kind === "link" ? "Link" : /\.([a-z0-9]{1,8})$/i.test(e.name) ? `${e.name.split(".").pop()!.toUpperCase()} file` : "File");
const bytes = (n: number) => (n < 1024 ? `${n} B` : `${formatSize(n)} (${n.toLocaleString()} bytes)`);
const total = (l: FsEntry[]) => l.reduce((a, e) => a + (e.kind === "dir" ? 0 : e.size), 0);

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

export function Properties({ dir, entries, selected, multi }: { dir: string; entries: FsEntry[]; selected: FsEntry | null; multi: string[] }) {
  const [inside, setInside] = useState<number | null>(null); // how many items a selected folder holds
  const path = selected?.kind === "dir" ? join(dir, selected.name) : null;
  useEffect(() => {
    setInside(null);
    if (path) void os.fs.list(path).then((l) => setInside(l.length), () => setInside(null));
  }, [path]);

  if (selected)
    return (
      <section className="props" aria-label="Properties">
        <h3>{selected.name}</h3>
        <dl>
          <Row k="Type" v={kindOf(selected)} />
          <Row k="Location" v={dir} />
          {selected.kind === "dir" ? <Row k="Contains" v={inside === null ? "…" : `${inside} item${inside === 1 ? "" : "s"}`} /> : <Row k="Size" v={bytes(selected.size)} />}
          <Row k="Modified" v={new Date(selected.mtime).toLocaleString()} />
        </dl>
      </section>
    );
  if (multi.length > 1) {
    const picked = entries.filter((e) => multi.includes(e.name));
    const folders = picked.filter((e) => e.kind === "dir").length;
    return (
      <section className="props" aria-label="Properties">
        <h3>{picked.length} items selected</h3>
        <dl>
          <Row k="Folders" v={String(folders)} />
          <Row k="Files" v={String(picked.length - folders)} />
          <Row k="Size of files" v={bytes(total(picked))} />
          <Row k="Location" v={dir} />
        </dl>
      </section>
    );
  }
  return (
    <section className="props" aria-label="Properties">
      <h3>{dir === "/" ? "Home" : dir.split("/").pop()}</h3>
      <dl>
        <Row k="Type" v="Folder" />
        <Row k="Location" v={dir} />
        <Row k="Contains" v={`${entries.length} item${entries.length === 1 ? "" : "s"}`} />
        <Row k="Size of files" v={bytes(total(entries))} />
      </dl>
    </section>
  );
}
