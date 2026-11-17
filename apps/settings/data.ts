// What the Settings app shows: the host's answer (apps/settings/server.ts reads /proc, /sys and os-release). Volume, mute and
// airplane mode are applied for real (`settings.write`); display settings are kept in memory only (`displayApplied`), because the
// compositor has no control for them yet. Where there is no host (Storybook, a plain browser) it falls back to SAMPLE data.
import { useEffect, useState } from "react";

export type Device = { id: string; name: string; group: "Input" | "Audio" | "Graphics" | "Storage" | "Network"; detail: string; connected: boolean };
export type Driver = { id: string; name: string; device: string; version: string; kind: "Kernel module" | "Firmware" | "User space"; loaded: boolean };
export type Display = { name: string; resolutions: string[]; resolution: string; refresh: number; scale: number; brightness: number; nightLight: boolean };

const SAMPLE_INFO: [string, string][] = [
  ["Device name", "brasos-dev"],
  ["System", "BrasOS 0.1 (dev image)"],
  ["Kernel", "Linux 6.12 (NixOS)"],
  ["Architecture", "x86_64"],
  ["Processor", "Virtual CPU, 4 cores"],
  ["Memory", "4 GB"],
  ["Graphics", "virtio-gpu (software rendering)"],
  ["Uptime", "2 h 14 min"],
];
const SAMPLE_STORAGE = { used: 6.2, total: 24 }; // GB

const DEVICES: Device[] = [
  { id: "kbd", name: "AT Translated Keyboard", group: "Input", detail: "PS/2 · layout us", connected: true },
  { id: "ptr", name: "QEMU USB Tablet", group: "Input", detail: "USB · absolute pointer", connected: true },
  { id: "gpu", name: "virtio-gpu", group: "Graphics", detail: "PCI · software rendering", connected: true },
  { id: "snd", name: "Intel HD Audio", group: "Audio", detail: "PCI · 1 output, 1 input", connected: true },
  { id: "disk", name: "Virtual disk", group: "Storage", detail: "virtio-blk · 24 GB", connected: true },
  { id: "eth", name: "virtio-net", group: "Network", detail: "Ethernet · 52:54:00:12:34:56", connected: true },
  { id: "usb", name: "USB flash drive", group: "Storage", detail: "USB · 16 GB", connected: false },
];

const DRIVERS: Driver[] = [
  { id: "virtio_gpu", name: "virtio_gpu", device: "virtio-gpu", version: "6.12.0", kind: "Kernel module", loaded: true },
  { id: "snd_hda_intel", name: "snd_hda_intel", device: "Intel HD Audio", version: "6.12.0", kind: "Kernel module", loaded: true },
  { id: "virtio_blk", name: "virtio_blk", device: "Virtual disk", version: "6.12.0", kind: "Kernel module", loaded: true },
  { id: "virtio_net", name: "virtio_net", device: "virtio-net", version: "6.12.0", kind: "Kernel module", loaded: true },
  { id: "atkbd", name: "atkbd", device: "AT Translated Keyboard", version: "6.12.0", kind: "Kernel module", loaded: true },
  { id: "usbhid", name: "usbhid", device: "QEMU USB Tablet", version: "6.12.0", kind: "Kernel module", loaded: true },
  { id: "usb_storage", name: "usb_storage", device: "USB flash drive", version: "6.12.0", kind: "Kernel module", loaded: false },
  { id: "linux-firmware", name: "linux-firmware", device: "Various", version: "20251020", kind: "Firmware", loaded: true },
  { id: "pipewire", name: "PipeWire", device: "Sound server", version: "1.4.2", kind: "User space", loaded: true },
];

export type System = {
  sample: boolean;
  info: [string, string][];
  storage: { used: number; total: number }; // GB
  /** false: the display controls only change this window's state */
  displayApplied: boolean;
  /** false: this machine has no sound server / no radio switch to talk to */
  soundAvailable: boolean;
  airplaneAvailable: boolean;
  adapter: { name: string; ip: string };
  devices: Device[];
  drivers: Driver[];
  display: Display;
  setDisplay(patch: Partial<Display>): void;
  sound: { output: string; volume: number; muted: boolean };
  setSound(patch: Partial<System["sound"]>): void;
  network: { airplane: boolean };
  setNetwork(patch: Partial<System["network"]>): void;
};

function useSample(): System {
  const [display, setD] = useState<Display>({ name: "Virtual display", resolutions: ["1280x800", "1366x768", "1600x900", "1920x1080"], resolution: "1280x800", refresh: 60, scale: 100, brightness: 80, nightLight: false });
  const [sound, setS] = useState({ output: "Speakers", volume: 60, muted: false });
  const [network, setN] = useState({ airplane: false });
  return {
    sample: true, info: SAMPLE_INFO, storage: SAMPLE_STORAGE, displayApplied: false, soundAvailable: true, airplaneAvailable: true,
    adapter: { name: "virtio-net (Ethernet)", ip: "10.0.2.15" },
    devices: DEVICES,
    drivers: DRIVERS,
    display,
    setDisplay: (p) => setD((d) => ({ ...d, ...p })),
    sound,
    setSound: (p) => setS((s) => ({ ...s, ...p })),
    network,
    setNetwork: (p) => setN((n) => ({ ...n, ...p })),
  };
}

type Real = { info: [string, string][]; storage: { used: number; total: number }; devices: Device[]; drivers: Driver[]; display: { name: string; resolutions: string[]; resolution: string } | null; network: { adapter: string; ip: string }; sound: { volume: number; muted: boolean } | null; airplane: boolean | null };

const post = (path: string, body: unknown) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** the host's answer, refreshed every 10 s; null while the first answer is pending, "none" if there is no usable host */
function useReal(): Real | null | "none" {
  const [real, setReal] = useState<Real | null | "none">(null);
  useEffect(() => {
    let alive = true, got = false;
    const load = () =>
      fetch("/system", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<Real>) : Promise.reject(r.status)))
        .then((d) => alive && ((got = true), setReal(d)))
        .catch(() => alive && !got && setReal("none"));
    void load();
    const t = setInterval(load, 10_000);
    return () => ((alive = false), clearInterval(t));
  }, []);
  return real;
}

export function useSystem(): System {
  const real = useReal();
  const sample = useSample();
  const [display, setD] = useState({ refresh: 60, scale: 100, brightness: 80, nightLight: false });
  const [sound, setS] = useState<{ volume: number; muted: boolean } | null>(null);
  const [airplane, setA] = useState<boolean | null>(null);
  useEffect(() => {
    if (real && real !== "none") (setS(real.sound), setA(real.airplane));
  }, [real]);
  if (real === null) return { ...sample, sample: false, info: [], storage: { used: 0, total: 0 }, devices: [], drivers: [] }; // first answer pending
  if (real === "none") return sample;
  const shown = real.display;
  return {
    sample: false, info: real.info, storage: real.storage, displayApplied: false, soundAvailable: !!real.sound, airplaneAvailable: real.airplane !== null,
    adapter: { name: real.network.adapter || "none", ip: real.network.ip || "none" },
    devices: real.devices, drivers: real.drivers,
    display: { name: shown?.name ?? "No display detected", resolutions: shown?.resolutions ?? [], resolution: shown?.resolution ?? "", ...display },
    setDisplay: (p) => setD((d) => ({ ...d, ...p })),
    sound: { output: "Default output", volume: sound?.volume ?? 0, muted: sound?.muted ?? false },
    setSound: (p) => {
      const change = { ...(p.volume !== undefined ? { volume: p.volume } : {}), ...(p.muted !== undefined ? { muted: p.muted } : {}) };
      setS((s) => ({ volume: s?.volume ?? 0, muted: s?.muted ?? false, ...change }));
      if (Object.keys(change).length) void post("/sound", change);
    },
    network: { airplane: airplane ?? false },
    setNetwork: (p) => {
      if (p.airplane === undefined) return;
      setA(p.airplane);
      void post("/airplane", { on: p.airplane });
    },
  };
}
