// The OS installer's logic, apart from its look: what can be installed where, and the layout an install would create.
// Pure functions, so they can be tested. Nothing here touches a disk: a real installer needs a privileged host slice
// (and its own audit events), which does not exist yet.
export type Disk = {
  id: string;
  path: string;
  model: string;
  bus: "NVMe" | "SSD" | "HDD" | "USB";
  sizeGB: number;
  installerMedia?: boolean; // the stick this installer booted from
  parts: { label: string; sizeGB: number; fs: string }[]; // what is on it now
};
export type Plan = { swapGB: number; fs: "ext4" | "btrfs" };
export type Part = { id: string; mount: string; label: string; fs: string; sizeGB: number };

export const MIN_GB = 20;
export const EFI_GB = 0.5;
export const CONFIRM_WORD = "erase";

/** why this disk can't be the target, or "" */
export function diskProblem(d: Disk): string {
  if (d.installerMedia) return "This is the installer's own media.";
  if (d.sizeGB < MIN_GB) return `Needs at least ${MIN_GB} GB.`;
  return "";
}

/** the partitions an erase-and-install creates: boot, optional swap, and the system on the rest */
export function layoutFor(d: Disk, p: Plan): Part[] {
  const out: Part[] = [{ id: "efi", mount: "/boot", label: "Boot", fs: "FAT32", sizeGB: EFI_GB }];
  if (p.swapGB > 0) out.push({ id: "swap", mount: "swap", label: "Swap", fs: "swap", sizeGB: p.swapGB });
  const used = out.reduce((a, x) => a + x.sizeGB, 0);
  out.push({ id: "root", mount: "/", label: "BrasOS", fs: p.fs, sizeGB: Math.max(0, +(d.sizeGB - used).toFixed(1)) });
  return out;
}

/** the destructive step needs the word typed: a click alone is not enough to erase a disk */
export const confirmed = (typed: string) => typed.trim().toLowerCase() === CONFIRM_WORD;

export const hasData = (d: Disk) => d.parts.length > 0;
export const size = (gb: number) => (gb >= 1000 ? `${(gb / 1000).toFixed(gb % 1000 === 0 ? 0 : 1)} TB` : `${+gb.toFixed(1)} GB`);

export const SAMPLE_DISKS: Disk[] = [
  { id: "nvme0", path: "/dev/nvme0n1", model: "Samsung SSD 980", bus: "NVMe", sizeGB: 512, parts: [{ label: "EFI", sizeGB: 0.5, fs: "FAT32" }, { label: "Windows", sizeGB: 420, fs: "NTFS" }, { label: "Data", sizeGB: 91.5, fs: "NTFS" }] },
  { id: "sda", path: "/dev/sda", model: "WD Blue", bus: "HDD", sizeGB: 1000, parts: [] },
  { id: "sdb", path: "/dev/sdb", model: "SanDisk Cruzer", bus: "USB", sizeGB: 16, installerMedia: true, parts: [{ label: "BrasOS installer", sizeGB: 4, fs: "ISO9660" }] },
];
