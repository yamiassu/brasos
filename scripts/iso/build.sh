#!/usr/bin/env bash
# Build the bootable dev image (UEFI, USB-able) -> .iso/brasos-dev.iso. Run in WSL/Linux, from a clone on the Linux filesystem.
set -euo pipefail
cd "$(dirname "$0")/../.."
git add -N . # a flake only sees files git knows: without this a new file is silently missing from the image (the shell then fails to start)
free=$(df --output=avail -BG . | tail -1 | tr -dc 0-9)
[ "$free" -ge 20 ] || { echo "only ${free} GB free: run nix-collect-garbage -d first" >&2; exit 1; }
nix build .#iso --out-link .iso/result
rm -f .iso/brasos-dev.iso # the previous copy is read-only (it came from the store)
cp -L .iso/result/iso/*.iso .iso/brasos-dev.iso
ls -lh .iso/brasos-dev.iso
