# Spike (dev only): replace bare cage's single client with brasos-comp, a smithay compositor that runs inside cage (winit backend)
# and lays out Chromium (the shell) beside native Wayland apps. Off by default; the hardened profile never enables it.
{ config, lib, pkgs, ... }:
let
  cfg = config.brasos.compositor;
  socket = "/run/brasos-comp/ctl.sock"; # 0600, in a directory only the session user can enter
in {
  options.brasos.compositor.enable = lib.mkEnableOption "the native-app compositor spike";
  # brasos-comp as the session itself (DRM/KMS, libinput), not a window inside cage. Reuses cage's tty/PAM/logind unit: the
  # unit runs `<package>/bin/cage -- <program>`, so a package whose `cage` starts brasos-comp --drm replaces it.
  options.brasos.compositor.drm = lib.mkEnableOption "brasos-comp owning the display (no cage)";
  options.brasos.compositor.clients = lib.mkOption {
    type = lib.types.listOf lib.types.str;
    default = [ "${pkgs.foot}/bin/foot" ];
    description = "Native Wayland apps started beside the shell.";
  };

  config = lib.mkIf cfg.enable {
    assertions = [{ assertion = !config.brasos.hardened.enable; message = "the compositor spike is not for the hardened profile"; }];
    systemd.tmpfiles.rules = [ "d /run/brasos-comp 0700 brasos users -" ];
    # the shell (host) lists, focuses and closes native windows through it (packages/native)
    systemd.services.brasos-shell.environment.BRASOS_COMP_SOCKET = socket;
    services.cage.package = lib.mkIf cfg.drm (pkgs.writeShellScriptBin "cage" ''
      exec ${pkgs.callPackage ./package.nix { }}/bin/brasos-comp --drm         -c ${lib.escapeShellArg config.brasos.uiCommand} ${lib.concatMapStringsSep " " (c: "-c ${lib.escapeShellArg c}") cfg.clients}
    '');
    services.cage.program = lib.mkForce (pkgs.writeShellScript "brasos-session" ''
      export BRASOS_COMP_SOCKET=${socket}
      exec ${pkgs.callPackage ./package.nix { }}/bin/brasos-comp \
        -c ${lib.escapeShellArg config.brasos.uiCommand} ${lib.concatMapStringsSep " " (c: "-c ${lib.escapeShellArg c}") cfg.clients}
    '');
  };
}
