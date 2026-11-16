// What the Settings app shows. Today: SAMPLE data, so the interface can be built and judged. A host slice (system info,
// displays, devices, drivers, each behind its own capability, audited) replaces `useSystem` later; the interface only
// depends on the shapes below. Changes made in the interface live in memory and are not applied to anything.
import { useState } from "react";

export type Device = { id: string; name: string; group: "Input" | "Audio" | "Graphics" | "Storage" | "Network"; detail: string; connected: boolean };
export type Driver = { id: string; name: string; device: string; version: string; kind: "Kernel module" | "Firmware" | "User space"; loaded: boolean };
export type Display = { name: string; resolutions: string[]; resolution: string; refresh: number; scale: number; brightness: number; nightLight: boolean };

export const INFO: [string, string][] = [
  ["Device name", "brasos-dev"],
  ["System", "BrasOS 0.1 (dev image)"],
  ["Kernel", "Linux 6.12 (NixOS)"],
  ["Architecture", "x86_64"],
  ["Processor", "Virtual CPU, 4 cores"],
  ["Memory", "4 GB"],
  ["Graphics", "virtio-gpu (software rendering)"],
  ["Uptime", "2 h 14 min"],
];
export const STORAGE = { used: 6.2, total: 24 }; // GB

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
  devices: Device[];
  drivers: Driver[];
  display: Display;
  setDisplay(patch: Partial<Display>): void;
  sound: { output: string; volume: number; muted: boolean };
  setSound(patch: Partial<System["sound"]>): void;
  network: { airplane: boolean };
  setNetwork(patch: Partial<System["network"]>): void;
};

export function useSystem(): System {
  const [display, setD] = useState<Display>({ name: "Virtual display", resolutions: ["1280x800", "1366x768", "1600x900", "1920x1080"], resolution: "1280x800", refresh: 60, scale: 100, brightness: 80, nightLight: false });
  const [sound, setS] = useState({ output: "Speakers", volume: 60, muted: false });
  const [network, setN] = useState({ airplane: false });
  return {
    sample: true,
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
