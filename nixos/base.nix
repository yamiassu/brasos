# Shared by every profile: kiosk session, fonts, VM settings. Profile files add (or deliberately omit) everything else.
{ pkgs, lib, ... }:
let
  port = "7000";
  # wait for the shell server, then launch the UI
  ui = pkgs.writeShellScript "brasos-ui" ''
    until ${pkgs.curl}/bin/curl -sf http://localhost:${port}/ >/dev/null; do sleep 0.5; done
    exec ${pkgs.chromium}/bin/chromium --kiosk --ozone-platform=wayland --site-per-process \
      --no-first-run --user-data-dir=/home/brasos/.config/brasos-chromium http://localhost:${port}/
  '';
in {
  # the command that shows the shell (Chromium, kiosk); a compositor module can launch it among other clients
  options.brasos.uiCommand = lib.mkOption { type = lib.types.str; default = "${ui}"; internal = true; };

  config = {
  system.stateVersion = "25.11";
  networking.hostName = "brasos";

  users.users.brasos = {
    isNormalUser = true;
    extraGroups = [ "video" "input" ];
  };

  # a browser needs more than Latin: CJK is the common gap (Arabic and Cyrillic render with DejaVu)
  fonts.packages = with pkgs; [ dejavu_fonts noto-fonts-color-emoji noto-fonts-cjk-sans ];
  hardware.graphics.enable = true;

  services.cage = {
    enable = true;
    user = "brasos";
    program = "${ui}";
    environment = {
      WLR_NO_HARDWARE_CURSORS = "1"; # VM cursor quirk
      WLR_RENDERER_ALLOW_SOFTWARE = "1"; # no GPU in the VM yet
    };
  };
  # each profile defines brasos-shell.service
  systemd.services."cage-tty1" = {
    after = [ "brasos-shell.service" ];
    wants = [ "brasos-shell.service" ];
  };

  virtualisation.vmVariant.virtualisation = {
    memorySize = 4096;
    cores = 4;
    # virtiofs (the default store share) fails under WSL2; bake the store into a disk image instead
    mountHostNixStore = false;
    useNixStoreImage = true;
    # no GL: QEMU's GL display crashes under WSLg. On native Linux use "-device virtio-vga-gl" "-display gtk,gl=on".
    qemu.options = [ "-device virtio-vga" "-display gtk" ];
  };
  };
}
