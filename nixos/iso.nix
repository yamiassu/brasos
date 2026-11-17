# A bootable UEFI/USB image of BrasOS: runs live from the stick (nothing is written to the PC's disks) and carries `brasos-install`,
# which erases one disk and installs the system on it, offline. Dev profile only for now: NOT secure (default password, passwordless sudo).
{ config, modulesPath, lib, pkgs, ... }:
let
  cfg = config.brasos.installer;
  # a plain boot menu in BrasOS colors (the stock theme draws the NixOS logo); the font is what lets GRUB draw the menu at all
  grubTheme = pkgs.runCommand "brasos-grub-theme" { } ''
    mkdir $out
    cp ${pkgs.grub2_efi}/share/grub/unicode.pf2 $out/
    cat > $out/theme.txt <<'EOF'
    title-text: "BrasOS"
    title-font: "Unifont Regular 16"
    title-color: "#ececee"
    desktop-color: "#0c0c0d"
    message-font: "Unifont Regular 16"
    message-color: "#9aa0aa"
    terminal-font: "Unifont Regular 16"
    + boot_menu {
      left = 15%
      top = 25%
      width = 70%
      height = 55%
      item_font = "Unifont Regular 16"
      item_color = "#9aa0aa"
      selected_item_font = "Unifont Regular 16"
      selected_item_color = "#5fd39a"
      item_height = 32
      item_padding = 8
      item_spacing = 6
    }
    EOF
  '';
  lsblk = "${pkgs.util-linux}/bin/lsblk -J -b -o PATH,SIZE,MODEL,TYPE,RM,ROTA,FSTYPE,LABEL,PARTTYPENAME,MOUNTPOINTS";
  install = pkgs.writeShellScriptBin "brasos-install" ''
    set -euo pipefail
    [ "$(id -u)" = 0 ] || exec sudo "$0" "$@"
    export PATH=${lib.makeBinPath (with pkgs; [ parted dosfstools e2fsprogs util-linux coreutils gnugrep systemd config.nix.package config.system.build.nixos-install ])}:$PATH
    yes=0; swap=0 # --yes: the installer app asks the person itself; --swap GB: a swap partition of that size
    while [ "''${1:-}" = --yes ] || [ "''${1:-}" = --swap ]; do
      if [ "$1" = --yes ]; then yes=1; shift; else swap=''${2:?--swap needs a size in GB}; shift 2; fi
    done
    case $swap in (*[!0-9]*|"") echo "--swap takes whole GB"; exit 1;; esac
    disk=''${1:-}
    if [ ! -b "$disk" ]; then
      echo "usage: brasos-install [--swap GB] /dev/DISK   (erases the whole disk; UEFI only)"; lsblk -dpno NAME,SIZE,MODEL; exit 1
    fi
    [ -d /sys/firmware/efi ] || { echo "this stick was booted in BIOS mode: boot it in UEFI mode"; exit 1; }
    if lsblk -no MOUNTPOINTS "$disk" | grep -q .; then echo "$disk is in use (is it the install stick?)"; exit 1; fi
    if [ $yes = 0 ]; then
      read -rp "Erase ALL of $disk and install BrasOS (dev profile, NOT secure)? Type ERASE: " answer
      [ "$answer" = ERASE ] || { echo "cancelled"; exit 1; }
    fi
    echo "@phase 0"
    if [ "$swap" -gt 0 ]; then
      parted -s "$disk" -- mklabel gpt mkpart brasos-esp fat32 1MiB 1025MiB set 1 esp on mkpart brasos-swap linux-swap 1025MiB "$((1025 + swap * 1024))MiB" mkpart brasos-root ext4 "$((1025 + swap * 1024))MiB" 100%
    else
      parted -s "$disk" -- mklabel gpt mkpart brasos-esp fat32 1MiB 1025MiB set 1 esp on mkpart brasos-root ext4 1025MiB 100%
    fi
    udevadm settle
    echo "@phase 1"
    mkfs.fat -F32 -n BRASOS-ESP /dev/disk/by-partlabel/brasos-esp
    mkfs.ext4 -qF -L brasos-root /dev/disk/by-partlabel/brasos-root
    if [ "$swap" -gt 0 ]; then mkswap /dev/disk/by-partlabel/brasos-swap; fi
    udevadm settle # the by-label links appear after mkfs; the partition names exist already
    mkdir -p /mnt # the live system has none
    mount /dev/disk/by-partlabel/brasos-root /mnt
    mkdir -p /mnt/boot && mount /dev/disk/by-partlabel/brasos-esp /mnt/boot
    echo "@total $(nix-store -qR ${cfg.system} | wc -l)"
    echo "@phase 2"
    nixos-install --system ${cfg.system} --no-root-passwd --no-channel-copy --option substituters ""
    echo "@phase 4"
    umount -R /mnt
    echo "BRASOS INSTALLED: remove the stick and reboot"
  '';
in {
  imports = [
    (modulesPath + "/installer/cd-dvd/iso-image.nix")
    (modulesPath + "/profiles/all-hardware.nix") # drivers for the disks, network and GPUs of most PCs
    ./video.nix # KMS drivers early, firmware and Mesa: native resolution from the first screen
    ./splash.nix # the BrasOS mark instead of the boot log
  ];
  options.brasos.installer.system = lib.mkOption {
    type = lib.types.package;
    description = "The system `brasos-install` puts on the disk (the flake's brasos-installed).";
  };
  config = {
    isoImage = {
      volumeID = "BRASOS";
      isoName = "brasos-dev.iso";
      inherit grubTheme;
      makeEfiBootable = true;
      makeUsbBootable = true; # dd/Rufus-able hybrid image
      squashfsCompression = "zstd -Xcompression-level 6"; # xz would take far longer to build for little gain
      storeContents = [ cfg.system ]; # so the install needs no network
    };
    brasos.uiUrl = "http://installer.localhost:7000/"; # the live image shows the installer, fullscreen, and no desktop: that comes after the first boot of the installed system
    environment.systemPackages = [ install ];
    # the Install BrasOS app is live only on this image: it runs the command above (sudo: the dev profile's passwordless wheel)
    # the shell's service has a minimal PATH (no util-linux, no sudo wrapper): name every program by its full path
    systemd.services.brasos-shell.environment.BRASOS_INSTALLER_LSBLK = lsblk;
    systemd.services.brasos-shell-safe.environment.BRASOS_INSTALLER_LSBLK = lsblk;
    systemd.services.brasos-shell.environment.BRASOS_INSTALLER_CMD = "/run/wrappers/bin/sudo ${install}/bin/brasos-install";
    systemd.services.brasos-shell-safe.environment.BRASOS_INSTALLER_CMD = "/run/wrappers/bin/sudo ${install}/bin/brasos-install";
    boot.supportedFilesystems = [ "ext4" "vfat" "btrfs" ];
    hardware.enableRedistributableFirmware = true; # Wi-Fi and GPU firmware
    networking.networkmanager.enable = lib.mkDefault true;
  };
}
