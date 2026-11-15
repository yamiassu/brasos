#!/usr/bin/env bash
# Build a BrasOS test VM and print its store path. PROFILE=dev (default) or PROFILE=hardened.
# Needs Nix with flakes, on Linux or WSL2 (clone the repo inside WSL's own filesystem, not /mnt/c:
# it is slow and flakes need git).
set -euo pipefail
cd "$(dirname "$0")/../.."
git add -N . # flakes only see tracked files; intent-to-add exposes new ones without staging content
exec nix build ".#nixosConfigurations.brasos-${PROFILE:-dev}.config.system.build.vm" --no-link --print-out-paths
