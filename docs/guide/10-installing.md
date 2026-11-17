# Installing BrasOS on a PC

BrasOS ships as a bootable image for UEFI PCs. Today there is one: the **dev profile**. It is **not secure** (default password, passwordless sudo, a terminal and an agent with full user access). Use it on a machine you own and can wipe. The [hardened](08-security.md) profile has no installable image yet.

## Build the image

On Linux (or WSL, with the repository cloned on the Linux filesystem and Nix installed):

```bash
scripts/iso/build.sh      # writes .iso/brasos-dev.iso, about 2.5 GB; needs 20 GB free
```

## Try it without installing

Write the image to a USB stick (`dd`, or Rufus in DD mode) and boot the PC from it in **UEFI** mode. BrasOS runs live from the stick and writes nothing to the PC's disks. Anything you save is gone at the next boot.

## Install it

The stick boots straight into **Install BrasOS**, fullscreen: there is no desktop on the live image. The desktop appears only on the installed system, after its first boot (you create the account and set your preferences there). The installer lists the disks the machine reports (never one that is in use, so never the stick you booted from), you pick one, choose the swap size, see the layout it will create and type `erase` to confirm. It then shows the real progress: partitioning, formatting, copying the system and the boot loader. When it says it is done, remove the stick and press Restart.

It partitions the disk (1 GB EFI system partition, an optional swap partition, and the rest ext4), installs the system with systemd-boot, and needs no network. Everything on the chosen disk is erased.

Prefer a terminal? The Terminal app runs the same thing:

```bash
brasos-install [--swap 4] /dev/nvme0n1     # the disk to ERASE, with an optional swap size in GB: run it without an argument to list the disks
```

It asks you to type `ERASE` first.

## Known limits

- UEFI only; no BIOS boot, no secure boot, no disk encryption.
- Graphics are software-rendered for now, so it is slow on a real GPU.
- The default account is `brasos`, password `brasos`. Change it.
- To test the whole path without a PC, run `scripts/iso/test.sh` (a UEFI VM installs onto a blank disk, then boots it).

## Updating and changing the installed system

An installed BrasOS (dev profile) can update itself from inside: **Settings → Updates**.

- **Update now** asks the update server named in the image (`brasos.updates.url`) for its manifest and switches to the build it names. It needs a network, because the new build's files are downloaded.
- **Rebuild from this device** builds the editable copy of BrasOS at `/var/lib/brasos/flake` (a first run copies it from `/etc/brasos-flake`). Edit it, rebuild, and the change is part of the system, without leaving it.
- **Roll back** returns to the previous generation. After an update only the new version and the one before it stay on the computer; older ones are deleted to free space. If a new version fails to start 3 times, the computer starts the previous one by itself, and holding Space at power-on shows the list.

The same three actions exist in a terminal as `sudo brasos-update`, `sudo brasos-update --local` and `sudo brasos-update --rollback`.

A manifest is a small JSON file: `{"version": "...", "flake": "https://.../brasos.tar.gz?narHash=sha256-...", "notes": "..."}`. This is a development convenience and not a secure update channel: the update is trusted because of the TLS connection to the manifest host and the signature of the binary cache. The hardened profile has no updater; it needs signed images applied by an administrator.

Publishing is automatic: every push to `main` runs the tests and, if they pass, the **Publish update** workflow (`.github/workflows/publish-update.yml`) uploads the source tarball and the manifest the image reads. It needs four repository secrets, set once: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (the update bucket's keys; they never go in the repository). To publish by hand instead, run `bun tools/update-server/publish.ts "what changed"` with the same four values in the environment; with `DRY_RUN=<folder>` it builds the files there and uploads nothing.

An update builds on the computer, not on a server: it downloads the source and Nix builds what changed. Most of the system comes ready-made from the public Nix cache; BrasOS's own parts are built on the device, and the compositor (the slowest, a Rust program) is rebuilt only when its own files change.

## Shutting down

Open the Start menu and choose **Shut down** or **Restart the computer**; you are asked to confirm. In a terminal (dev profile) `poweroff` and `reboot` also work.
