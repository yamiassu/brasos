{ pkgs, shellSrc, ... }:
let
  port = "7000";
  # wait for the shell server (first boot runs `bun install`), then launch the UI
  ui = pkgs.writeShellScript "brasos-ui" ''
    until ${pkgs.curl}/bin/curl -sf http://localhost:${port}/ >/dev/null; do sleep 0.5; done
    exec ${pkgs.chromium}/bin/chromium --kiosk --ozone-platform=wayland --site-per-process \
      --no-first-run --user-data-dir=/home/brasos/.config/brasos-chromium http://localhost:${port}/
  '';
in {
  system.stateVersion = "25.11";
  nixpkgs.config.allowUnfree = true; # claude-code
  networking.hostName = "brasos";

  # Full privilege for Claude Code: passwordless root for the main user. Fine inside a dev VM; revisit before bare metal.
  users.users.brasos = {
    isNormalUser = true;
    initialPassword = "brasos";
    extraGroups = [ "wheel" "video" "input" "networkmanager" ];
  };
  security.sudo.wheelNeedsPassword = false;
  nix.settings.trusted-users = [ "brasos" ];
  networking.networkmanager.enable = true;

  environment.systemPackages = (with pkgs; [ bun claude-code git curl vim chromium ]) ++ [
    (pkgs.writeShellScriptBin "brasos-reset-shell" ''
      sudo systemctl stop brasos-shell brasos-shell-safe
      sudo rm -rf /var/lib/brasos/shell
      sudo systemctl reset-failed brasos-shell
      sudo systemctl start brasos-shell
    '')
  ];

  fonts.packages = with pkgs; [ dejavu_fonts noto-fonts-color-emoji ];

  # The live shell (/var/lib/brasos/shell) is user-editable. If it keeps failing, systemd starts the
  # pristine copy from the Nix store on the same port. `brasos-reset-shell` re-seeds the live copy.
  systemd.services.brasos-shell = {
    wantedBy = [ "multi-user.target" ];
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    path = with pkgs; [ bun bash coreutils ];
    unitConfig = {
      OnFailure = [ "brasos-shell-safe.service" ];
      StartLimitIntervalSec = 60;
      StartLimitBurst = 3;
    };
    serviceConfig = {
      User = "brasos";
      StateDirectory = "brasos"; # /var/lib/brasos, owned by brasos
      Restart = "on-failure";
      RestartSec = 2;
    };
    script = ''
      d=/var/lib/brasos/shell
      if [ ! -d "$d" ]; then cp -r ${shellSrc} "$d" && chmod -R u+w "$d"; fi
      cd "$d"
      bun install
      exec bun server.ts
    '';
  };
  systemd.services.brasos-shell-safe = {
    path = with pkgs; [ bun bash coreutils ];
    serviceConfig = {
      User = "brasos";
      StateDirectory = "brasos";
    };
    script = ''
      d=/var/lib/brasos/safe
      rm -rf "$d" && cp -r ${shellSrc} "$d" && chmod -R u+w "$d"
      cd "$d"
      bun install
      exec bun server.ts
    '';
  };

  services.cage = {
    enable = true;
    user = "brasos";
    program = "${ui}";
    environment = {
      WLR_NO_HARDWARE_CURSORS = "1"; # VM cursor quirk
      WLR_RENDERER_ALLOW_SOFTWARE = "1"; # no GPU in the VM yet
    };
  };
  systemd.services."cage-tty1" = {
    after = [ "brasos-shell.service" ];
    wants = [ "brasos-shell.service" ];
  };
  hardware.graphics.enable = true;

  virtualisation.vmVariant.virtualisation = {
    memorySize = 4096;
    cores = 4;
    # virtiofs (the default store share) fails under WSL2; bake the store into a disk image instead
    mountHostNixStore = false;
    useNixStoreImage = true;
    # no GL: QEMU's GL display crashes under WSLg. On native Linux use "-device virtio-vga-gl" "-display gtk,gl=on".
    qemu.options = [ "-device virtio-vga" "-display gtk" ];
  };
}
