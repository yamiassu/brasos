#!/usr/bin/env bash
# Build and boot the VM from a clean disk. State lives in ./.vm (per worktree, so agents don't collide).
# Control it with scripts/vm/ctl.py via the QEMU monitor socket ./.vm/mon.sock.
# Keep this process alive: on WSL the VM dies when the launching shell exits.
set -euo pipefail
cd "$(dirname "$0")/../.."
VM=$(scripts/vm/build.sh)
mkdir -p .vm && cd .vm
rm -f brasos.qcow2 mon.sock
export QEMU_OPTS="-monitor unix:$PWD/mon.sock,server,nowait"
# WSL2 notes: needs your user in the `kvm` group; virtiofs and QEMU's GL display don't work there (config already avoids both).
exec "$VM/bin/run-brasos-vm"
