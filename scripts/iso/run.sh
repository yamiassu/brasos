#!/usr/bin/env bash
# Boot .iso/brasos-dev.iso under QEMU with UEFI firmware, as a PC would (needs qemu + OVMF: nix shell nixpkgs#qemu nixpkgs#OVMF.fd).
set -euo pipefail
cd "$(dirname "$0")/../.."
fw=${OVMF_CODE:-$(nix build nixpkgs#OVMF.fd --no-link --print-out-paths)/FV/OVMF.fd}
exec qemu-system-x86_64 -enable-kvm -cpu host -m 4096 -smp 4 -bios "$fw" -drive file=.iso/brasos-dev.iso,media=cdrom,readonly=on \
  -device virtio-vga -display gtk -nic user "$@"
