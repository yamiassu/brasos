// What the Packages app shows: the packages of the running system, from the host (apps/packages/server.ts reads the Nix store).
// The system's software is fixed by its image, so `canChange` is false there and install/remove are off. Where there is no host
// (Storybook, a plain browser) it falls back to a SAMPLE catalog that does allow changes, so the dependency logic (what an
// install pulls in, what blocks a removal) can still be built and judged.
import { useEffect, useState } from "react";

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
export function plan(id: string, installed: Set<string>, byId: Map<string, Pkg> = BY_ID): Pkg[] {
  const out: Pkg[] = [];
  const seen = new Set<string>();
  const visit = (x: string) => {
    if (seen.has(x) || installed.has(x)) return;
    seen.add(x);
    const p = byId.get(x);
    if (!p) return;
    p.deps.forEach(visit);
    out.push(p);
  };
  visit(id);
  return out;
}

/** installed packages that need `id`: while there are any, it can't be removed */
export const requiredBy = (id: string, installed: Set<string>, catalog: Pkg[] = CATALOG) => catalog.filter((p) => installed.has(p.id) && p.deps.includes(id));

export type Packages = {
  sample: boolean;
  /** false: the system's packages are fixed by its image, so install and remove are not offered */
  canChange: boolean;
  catalog: Pkg[];
  byId: Map<string, Pkg>;
  installed: Set<string>;
  manual: Set<string>; // chosen by the user, as opposed to pulled in as a dependency
  busy: Map<string, "installing" | "removing">;
  install(id: string): void;
  remove(id: string): void;
};

function useSample(): Packages {
  const [installed, setInstalled] = useState(() => new Set(BASE));
  const [manual, setManual] = useState(() => new Set(["git", "nodejs", "htop"]));
  const [busy, setBusy] = useState(() => new Map<string, "installing" | "removing">());
  const mark = (id: string, v?: "installing" | "removing") => setBusy((b) => { const n = new Map(b); v ? n.set(id, v) : n.delete(id); return n; });
  return {
    sample: true, canChange: true, catalog: CATALOG, byId: BY_ID,
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

/** the host's package list; null while pending, "none" if there is no usable host */
function useReal(): { packages: Pkg[]; canChange: boolean } | null | "none" {
  const [real, setReal] = useState<{ packages: Pkg[]; canChange: boolean } | null | "none">(null);
  useEffect(() => {
    let alive = true;
    fetch("/packages", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => alive && (Array.isArray(d.packages) ? setReal(d) : setReal("none")))
      .catch(() => alive && setReal("none"));
    return () => void (alive = false);
  }, []);
  return real;
}

export function usePackages(): Packages {
  const real = useReal();
  const sample = useSample();
  if (real === null) return { ...sample, sample: false, canChange: false, catalog: [], byId: new Map(), installed: new Set(), manual: new Set() }; // first answer pending
  if (real === "none") return sample;
  const installed = new Set(real.packages.map((p) => p.id));
  // "chosen" as far as we can tell: nothing installed needs it
  const manual = new Set(real.packages.filter((p) => !requiredBy(p.id, installed, real.packages).length).map((p) => p.id));
  return { sample: false, canChange: real.canChange, catalog: real.packages, byId: new Map(real.packages.map((p) => [p.id, p])), installed, manual, busy: new Map(), install() {}, remove() {} };
}
