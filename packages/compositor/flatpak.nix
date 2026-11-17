# Flatpak (dev only): apps from Flathub, installed per user from the Packages app and started from Start like any native app.
# A Flatpak app is its own sandbox, so it runs as a plain user process (`open`) through one fixed runner the image owns; the host only
# ever names an application id (checked by packages/native and again by the compositor), never a command. Not in hardened.
{ config, lib, pkgs, ... }:
let cfg = config.brasos.flatpak;
in {
  options.brasos.flatpak.enable = lib.mkOption {
    type = lib.types.bool;
    default = config.brasos.compositor.enable && !config.brasos.hardened.enable;
    description = "Flatpak with Flathub: install apps from the Packages app (needs the compositor; never with the hardened package).";
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      { assertion = config.brasos.compositor.enable; message = "brasos.flatpak needs brasos.compositor (native windows)"; }
      { assertion = !config.brasos.hardened.enable; message = "Flatpak apps are unconfined by BrasOS and fetched at run time: not for the hardened profile"; }
    ];
    services.flatpak.enable = true; # the flatpak tool and its polkit rules
    # Flatpak apps ask the desktop for file pickers, links and the like through portals (the GTK implementation covers them)
    xdg.portal = { enable = true; extraPortals = [ pkgs.xdg-desktop-portal-gtk ]; config.common.default = "gtk"; };
    brasos.compositor.apps.flatpak = {
      name = "Flatpak app";
      network = true;
      sandbox = "open";
      takesApp = true;
      command = [ "/run/current-system/sw/bin/flatpak" "run" "--user" ];
    };
    # the Packages app (install, remove, search) and packages/native (list, start) find the tool here
    systemd.services.brasos-shell.environment.BRASOS_FLATPAK = "/run/current-system/sw/bin/flatpak";
    systemd.services.brasos-shell-safe.environment.BRASOS_FLATPAK = "/run/current-system/sw/bin/flatpak";
  };
}
