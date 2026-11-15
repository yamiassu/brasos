#!/usr/bin/env bash
# Build and boot a VM from a clean disk: PROFILE=dev (default) or PROFILE=hardened.
# State lives in $BRASOS_VM_DIR (default ./.vm, per worktree, so agents don't collide). To run two VMs at once give
# each its own BRASOS_VM_DIR. Control one with scripts/vm/ctl.py (same BRASOS_VM_DIR) via its QEMU monitor socket.
# Keep this process alive: on WSL the VM dies when the launching shell exits.
set -euo pipefail
cd "$(dirname "$0")/../.."
VM=$(scripts/vm/build.sh)
DIR=$(realpath -m "${BRASOS_VM_DIR:-.vm}")
mkdir -p "$DIR" && cd "$DIR"
rm -f brasos.qcow2 mon.sock
export QEMU_OPTS="-monitor unix:$DIR/mon.sock,server,nowait"
# WSL2 notes: needs your user in the `kvm` group; virtiofs and QEMU's GL display don't work there (config already avoids both).
exec "$VM/bin/run-brasos-vm"
