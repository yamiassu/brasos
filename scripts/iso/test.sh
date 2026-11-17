#!/usr/bin/env bash
# End to end: build the self-installing test ISO, let it install onto a blank 20 GB disk under UEFI QEMU, then boot that disk
# and screenshot it -> .iso/installed.png. Run in WSL/Linux (needs /dev/kvm).
set -euo pipefail
cd "$(dirname "$0")/../.."
git add -N . # a flake only sees files git knows: without this a new file is silently missing from the image (the shell then fails to start)
free=$(df --output=avail -BG . | tail -1 | tr -dc 0-9)
[ "$free" -ge 30 ] || { echo "only ${free} GB free: run nix-collect-garbage -d first" >&2; exit 1; }
nix build .#iso-test --out-link .iso/test-result
iso=$(ls .iso/test-result/iso/*.iso)
fw=$(nix build nixpkgs#OVMF.fd --no-link --print-out-paths)/FV/OVMF.fd
q() { nix shell nixpkgs#qemu -c qemu-system-x86_64 -enable-kvm -cpu host -smp 4 -bios "$fw" -device virtio-vga -display none "$@"; }
rm -f .iso/disk.qcow2 .iso/serial.log /tmp/brasos-mon
nix shell nixpkgs#qemu -c qemu-img create -f qcow2 .iso/disk.qcow2 20G >/dev/null
q -m 6144 -drive file="$iso",media=cdrom,readonly=on -drive file=.iso/disk.qcow2,if=virtio -serial file:.iso/serial.log -nic user &
pid=$!
for _ in $(seq 180); do grep -aq "BRASOS INSTALLED" .iso/serial.log 2>/dev/null && break; sleep 10; done
grep -aq "BRASOS INSTALLED" .iso/serial.log || { pkill -f qemu-system-x86_64; tail -30 .iso/serial.log; echo "install did not finish" >&2; exit 1; }
pkill -f qemu-system-x86_64 || true # $pid is the nix wrapper: qemu itself must be stopped by name
sleep 3
echo "installed; booting from the disk"
q -m 4096 -drive file=.iso/disk.qcow2,if=virtio -monitor unix:/tmp/brasos-mon,server,nowait -nic user &
pid=$!
sleep 150
echo "screendump .iso/installed.ppm" | nix shell nixpkgs#socat -c socat - UNIX-CONNECT:/tmp/brasos-mon >/dev/null
sleep 2; pkill -f qemu-system-x86_64 || true
nix shell nixpkgs#imagemagick -c magick .iso/installed.ppm .iso/installed.png && echo ".iso/installed.png"
