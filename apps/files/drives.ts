// The drives of this computer, from `lsblk -J -b` (see server.ts). Pure, so it is tested without a machine.
export type Volume = { name: string; label: string; fs: string; size: number; used: number | null; mount: string | null };
export type Drive = { path: string; model: string; size: number; removable: boolean; rotational: boolean; volumes: Volume[] };

type Node = {
  path?: string | null; name?: string | null; size?: string | number | null; model?: string | null; type?: string | null; rm?: boolean | string | number | null; rota?: boolean | string | number | null;
  fstype?: string | null; label?: string | null; mountpoints?: (string | null)[] | null; mountpoint?: string | null; fsused?: string | number | null; fsavail?: string | number | null; children?: Node[];
};

const flag = (v: unknown) => v === true || v === "1" || v === 1;
const bytes = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
/** every partition, and what is stacked on one (encryption, LVM), that holds a filesystem */
const volumes = (n: Node): Volume[] =>
  (n.children ?? []).flatMap((c) => [
    ...(c.fstype
      ? [{ name: c.name ?? "", label: (c.label ?? "").trim(), fs: c.fstype, size: bytes(c.size) ?? 0, used: bytes(c.fsused), mount: [...(c.mountpoints ?? []), c.mountpoint].find((m) => m) ?? null }]
      : []),
    ...volumes(c),
  ]);

/** the whole disks (not loop devices, RAM disks or optical drives), each with the volumes on it */
export function parseDrives(out: string): Drive[] {
  let tree: Node[];
  try {
    tree = JSON.parse(out).blockdevices ?? [];
  } catch {
    return [];
  }
  return tree
    .filter((n) => n.type === "disk" && typeof n.path === "string")
    .map((n) => ({ path: n.path!, model: (n.model ?? "").trim(), size: bytes(n.size) ?? 0, removable: flag(n.rm), rotational: flag(n.rota), volumes: volumes(n) }));
}
