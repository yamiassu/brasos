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
  parts: { label: string; sizeGB: number; fs: string; kind?: string }[]; // what is on it now (kind: the partition type name, e.g. "Microsoft basic data")
};
export type Plan = { swapGB: number; fs: "ext4" | "btrfs" };
export type Part = { id: string; mount: string; label: string; fs: string; sizeGB: number };

export const MIN_GB = 20;
export const EFI_GB = 1; // the boot partition holds the kernel and early-boot image (with the video drivers: big), so brasos-install makes it 1 GB
export const CONFIRM_WORD = "erase";

/** why this disk can't be the target, or "" */
export function diskProblem(d: Disk): string {
  if (d.installerMedia) return "This is the installer's own media.";
  if (d.sizeGB < MIN_GB) return `Needs at least ${MIN_GB} GB.`;
  return "";
}

/** the partitions an erase-and-install creates: boot, optional swap, and the system on the rest */
export function layoutFor(d: Disk, p: Plan): Part[] {
  const out: Part[] = [{ id: "efi", mount: "/boot", label: "Startup files", fs: "FAT32", sizeGB: EFI_GB }];
  if (p.swapGB > 0) out.push({ id: "swap", mount: "swap", label: "Extra memory (swap)", fs: "swap", sizeGB: p.swapGB });
  const used = out.reduce((a, x) => a + x.sizeGB, 0);
  out.push({ id: "root", mount: "/", label: "BrasOS and your files", fs: p.fs, sizeGB: Math.max(0, +(d.sizeGB - used).toFixed(1)) });
  return out;
}

/** the destructive step needs the word typed: a click alone is not enough to erase a disk */
export const confirmed = (typed: string) => typed.trim().toLowerCase() === CONFIRM_WORD;

export type PartInfo = Disk["parts"][number];
export type What = "windows" | "recovery" | "boot" | "linux" | "mac" | "swap" | "encrypted" | "files" | "installer" | "unknown";

/** A best guess at what a partition holds, from its file system and its partition type. Only a guess: nothing is mounted or read. */
export function identify(p: PartInfo): What {
  const fs = p.fs.toLowerCase(), kind = (p.kind ?? "").toLowerCase();
  const fat = /^(vfat|fat32|fat16|exfat)$/.test(fs);
  if (fs === "iso9660" || fs === "udf") return "installer";
  if (kind.includes("recovery")) return "recovery";
  if (kind.includes("efi system") || (/^(vfat|fat32|fat16)$/.test(fs) && p.sizeGB <= 1.1 && /^(efi|esp|system|boot)/i.test(p.label))) return "boot";
  if (fs === "ntfs" || fs === "bitlocker" || fs === "refs") return "windows";
  if (/^(ext[234]|btrfs|xfs|f2fs|zfs_member)$/.test(fs)) return "linux";
  if (fs === "swap" || kind.includes("linux swap")) return "swap";
  if (/^(apfs|hfs|hfsplus)$/.test(fs) || kind.includes("apple")) return "mac";
  if (fs === "crypto_luks") return "encrypted";
  if (fat) return "files";
  return "unknown";
}

/** the name a person would use for a partition */
export function friendly(p: PartInfo): string {
  const named = p.label && p.label !== "Partition" ? p.label : "";
  switch (identify(p)) {
    case "windows": return "Windows";
    case "recovery": return "Windows recovery";
    case "boot": return "Startup files";
    case "linux": return "Linux";
    case "mac": return "macOS";
    case "swap": return "Linux extra memory";
    case "encrypted": return "Encrypted data";
    case "installer": return "Installer";
    case "files": return named || "Files";
    default: return named || "Data";
  }
}

/** what a drive holds now, in words for someone who has never opened a disk tool */
export function describeDisk(d: Disk): { systems: string[]; summary: string } {
  if (!d.parts.length) return { systems: [], summary: "Nothing on it: it is empty." };
  const kinds = new Set(d.parts.map(identify));
  const names = { windows: "Windows", linux: "Linux", mac: "macOS" } as const;
  const systems = (["windows", "linux", "mac"] as const).filter((k) => kinds.has(k)).map((k) => names[k]);
  const other = [...kinds].some((k) => k === "files" || k === "unknown" || k === "encrypted");
  const summary = systems.length
    ? `Looks like it has ${systems.join(" and ")}${other ? " and other files" : ""}.`
    : kinds.has("installer") ? "This is an installer disk."
    : "Has files or data on it (no operating system recognised).";
  return { systems, summary };
}

/** the kind of drive, as people say it */
export const busName = (b: Disk["bus"]) => ({ NVMe: "Fast internal drive (NVMe)", SSD: "Internal solid-state drive (SSD)", HDD: "Internal hard disk", USB: "USB drive" })[b];

export const hasData = (d: Disk) => d.parts.length > 0;
export const size = (gb: number) => (gb >= 1000 ? `${(gb / 1000).toFixed(gb % 1000 === 0 ? 0 : 1)} TB` : `${+gb.toFixed(1)} GB`);

export const SAMPLE_DISKS: Disk[] = [
  { id: "nvme0", path: "/dev/nvme0n1", model: "Samsung SSD 980", bus: "NVMe", sizeGB: 512, parts: [{ label: "EFI", sizeGB: 0.5, fs: "FAT32" }, { label: "Windows", sizeGB: 420, fs: "NTFS" }, { label: "Data", sizeGB: 91.5, fs: "NTFS" }] },
  { id: "sda", path: "/dev/sda", model: "WD Blue", bus: "HDD", sizeGB: 1000, parts: [] },
  { id: "sdb", path: "/dev/sdb", model: "SanDisk Cruzer", bus: "USB", sizeGB: 16, installerMedia: true, parts: [{ label: "BrasOS installer", sizeGB: 4, fs: "ISO9660" }] },
];
