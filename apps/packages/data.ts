// What the Packages app shows. Today: a SAMPLE catalog with Linux-style dependencies, so the interface (and the
// dependency logic: what an install pulls in, what blocks a removal) can be built and judged. A host slice (the real
// package set of the NixOS image, install and remove as audited, privileged actions, never allowed in hardened) replaces
// `usePackages` later; the interface only depends on the shapes below.
import { useState } from "react";

export type Kind = "App" | "Driver" | "Library" | "Tool";
export type Pkg = { id: string; name: string; kind: Kind; version: string; size: number; summary: string; deps: string[] }; // size in MB

export const KINDS: Kind[] = ["App", "Driver", "Library", "Tool"];

const P = (id: string, kind: Kind, version: string, size: number, summary: string, deps: string[] = [], name = id): Pkg => ({ id, name, kind, version, size, summary, deps });

export const CATALOG: Pkg[] = [
  // libraries
  P("glibc", "Library", "2.40", 32, "The C library every program links against"),
  P("zlib", "Library", "1.3.1", 1, "Compression", ["glibc"]),
  P("openssl", "Library", "3.3.2", 14, "TLS and cryptography", ["glibc", "zlib"]),
  P("libpng", "Library", "1.6.43", 2, "PNG images", ["glibc", "zlib"]),
  P("libdrm", "Library", "2.4.123", 3, "Direct access to the graphics hardware", ["glibc"]),
  P("alsa-lib", "Library", "1.2.12", 5, "Sound for Linux", ["glibc"]),
  P("mesa", "Library", "24.2.5", 188, "Open-source graphics (OpenGL, Vulkan)", ["glibc", "libdrm", "zlib"]),
  P("gtk4", "Library", "4.16.3", 52, "Toolkit for graphical apps", ["glibc", "mesa", "libpng"]),
  P("qt6", "Library", "6.8.0", 210, "Toolkit for graphical apps", ["glibc", "mesa", "libpng", "openssl"]),
  // drivers
  P("linux-firmware", "Driver", "20251020", 540, "Firmware blobs for Wi-Fi, GPUs and more"),
  P("mesa-drivers", "Driver", "24.2.5", 96, "Graphics drivers for Intel, AMD and virtual GPUs", ["mesa", "linux-firmware"]),
  P("nvidia-driver", "Driver", "560.35", 310, "Proprietary NVIDIA graphics driver", ["linux-firmware", "libdrm"]),
  P("pipewire", "Driver", "1.4.2", 38, "Sound and video routing", ["glibc", "alsa-lib"]),
  P("bluez", "Driver", "5.78", 6, "Bluetooth stack", ["glibc"]),
  P("cups", "Driver", "2.4.11", 22, "Printing", ["glibc", "openssl", "zlib"]),
  // tools
  P("git", "Tool", "2.47.0", 48, "Version control", ["glibc", "openssl", "zlib"]),
  P("python3", "Tool", "3.12.7", 96, "The Python language", ["glibc", "openssl", "zlib"]),
  P("nodejs", "Tool", "22.9.0", 74, "JavaScript runtime", ["glibc", "openssl", "zlib"]),
  P("ffmpeg", "Tool", "7.1", 140, "Audio and video conversion", ["glibc", "zlib", "alsa-lib"]),
  P("htop", "Tool", "3.3.0", 1, "Interactive process viewer", ["glibc"]),
  // apps
  P("vlc", "App", "3.0.21", 120, "Media player", ["qt6", "ffmpeg", "pipewire"], "VLC"),
  P("gimp", "App", "3.0.0", 260, "Image editor", ["gtk4", "python3", "libpng"], "GIMP"),
  P("libreoffice", "App", "24.8", 680, "Office suite", ["qt6", "python3", "cups"], "LibreOffice"),
  P("inkscape", "App", "1.4", 210, "Vector graphics", ["gtk4", "python3", "libpng"], "Inkscape"),
  P("blender", "App", "4.2", 520, "3D creation", ["mesa", "python3", "ffmpeg"], "Blender"),
  P("firefox", "App", "132.0", 240, "Web browser", ["gtk4", "pipewire", "openssl"], "Firefox"),
];

export const BY_ID = new Map(CATALOG.map((p) => [p.id, p]));
/** what is already there when the image boots */
const BASE = ["glibc", "zlib", "openssl", "libdrm", "mesa", "mesa-drivers", "linux-firmware", "pipewire", "alsa-lib", "git", "nodejs", "htop"];

/** every package an install of `id` needs, in the order they would be installed, skipping what is already installed */
export function plan(id: string, installed: Set<string>): Pkg[] {
  const out: Pkg[] = [];
  const seen = new Set<string>();
  const visit = (x: string) => {
    if (seen.has(x) || installed.has(x)) return;
    seen.add(x);
    const p = BY_ID.get(x);
    if (!p) return;
    p.deps.forEach(visit);
    out.push(p);
  };
  visit(id);
  return out;
}

/** installed packages that need `id`: while there are any, it can't be removed */
export const requiredBy = (id: string, installed: Set<string>) => CATALOG.filter((p) => installed.has(p.id) && p.deps.includes(id));

export type Packages = {
  sample: boolean;
  installed: Set<string>;
  manual: Set<string>; // chosen by the user, as opposed to pulled in as a dependency
  busy: Map<string, "installing" | "removing">;
  install(id: string): void;
  remove(id: string): void;
};

export function usePackages(): Packages {
  const [installed, setInstalled] = useState(() => new Set(BASE));
  const [manual, setManual] = useState(() => new Set(["git", "nodejs", "htop"]));
  const [busy, setBusy] = useState(() => new Map<string, "installing" | "removing">());
  const mark = (id: string, v?: "installing" | "removing") => setBusy((b) => { const n = new Map(b); v ? n.set(id, v) : n.delete(id); return n; });
  return {
    sample: true,
    installed, manual, busy,
    install(id) {
      const add = plan(id, installed);
      mark(id, "installing");
      setTimeout(() => {
        setInstalled((s) => new Set([...s, ...add.map((p) => p.id)]));
        setManual((s) => new Set([...s, id]));
        mark(id);
      }, 900);
    },
    remove(id) {
      if (requiredBy(id, installed).length) return;
      mark(id, "removing");
      setTimeout(() => {
        setInstalled((s) => (s.delete(id), new Set(s)));
        setManual((s) => (s.delete(id), new Set(s)));
        mark(id);
      }, 600);
    },
  };
}
