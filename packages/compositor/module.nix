# Spike (dev only): replace bare cage's single client with brasos-comp, a smithay compositor that runs inside cage (winit backend)
# and lays out Chromium (the shell) beside native Wayland apps. Off by default; the hardened profile never enables it.
{ config, lib, pkgs, ... }:
let cfg = config.brasos.compositor;
in {
  options.brasos.compositor.enable = lib.mkEnableOption "the native-app compositor spike";
  options.brasos.compositor.clients = lib.mkOption {
    type = lib.types.listOf lib.types.str;
    default = [ "${pkgs.foot}/bin/foot" ];
    description = "Native Wayland apps started beside the shell.";
  };

  config = lib.mkIf cfg.enable {
    assertions = [{ assertion = !config.brasos.hardened.enable; message = "the compositor spike is not for the hardened profile"; }];
    services.cage.program = lib.mkForce (pkgs.writeShellScript "brasos-session" ''
      exec ${pkgs.callPackage ./package.nix { }}/bin/brasos-comp \
        -c ${lib.escapeShellArg config.brasos.uiCommand} ${lib.concatMapStringsSep " " (c: "-c ${lib.escapeShellArg c}") cfg.clients}
    '');
  };
}
