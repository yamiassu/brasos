# What `brasos-install` puts on a PC's disk: the layout it creates (labels) and a UEFI bootloader. Dev profile: NOT secure.
{ modulesPath, lib, ... }: {
  imports = [ (modulesPath + "/profiles/all-hardware.nix") ./video.nix ];
  fileSystems."/" = { device = "/dev/disk/by-label/brasos-root"; fsType = "ext4"; };
  fileSystems."/boot" = { device = "/dev/disk/by-label/BRASOS-ESP"; fsType = "vfat"; };
  swapDevices = [ { device = "/dev/disk/by-partlabel/brasos-swap"; options = [ "nofail" ]; } ]; # present only if the install made one
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
  # Boot the newest generation without showing the menu (hold Space at power-on to get it). Boot counting makes the fallback automatic:
  # a new generation that fails to reach a working system 3 times in a row is skipped, and the previous one boots.
  boot.loader.timeout = 0;
  boot.loader.systemd-boot.bootCounting = { enable = true; tries = 3; };
  boot.loader.systemd-boot.configurationLimit = 10;
  hardware.enableRedistributableFirmware = true;
  brasos.updates.url = "https://s3.upuai.cloud/updates-lgig3v/manifest.json"; # the bucket tools/update-server/publish.ts fills; readable only once its public access is enabled
  brasos.updates.attr = "brasos-installed"; # this system can rebuild and update itself
  networking.networkmanager.enable = lib.mkDefault true;
}
