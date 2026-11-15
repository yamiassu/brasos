# Spike (dev only): brasos-comp, a smithay compositor that lays out Chromium (the shell) beside native Wayland apps. It runs inside
# cage (winit backend) or, with `drm`, owns the display itself. Off by default; the hardened profile never enables it.
{ config, lib, pkgs, ... }:
let
  cfg = config.brasos.compositor;
  comp = pkgs.callPackage ./package.nix { };
  socket = "/run/brasos-comp/ctl.sock"; # 0600, in a directory only the session user can enter

  # The native apps this image offers. The shell lists them and asks for one by id; the command line lives only in the file the
  # compositor reads, and the compositor runs it inside bubblewrap (see src/ctl.rs).
  appsJson = pkgs.writeText "brasos-native-apps.json" (builtins.toJSON (lib.mapAttrsToList (id: a: { inherit id; inherit (a) name icon; }) cfg.apps));
  appsTsv = pkgs.writeText "brasos-native-apps.tsv"
    (lib.concatStrings (lib.mapAttrsToList (id: a: "${id}\t${if a.network then "1" else "0"}\t${lib.concatStringsSep "\x1f" a.command}\n") cfg.apps));

  session = pkgs.writeShellScript "brasos-session" ''
    export BRASOS_COMP_SOCKET=${socket}
    export BRASOS_NATIVE_APPS=${appsTsv}
    export BRASOS_BWRAP=${pkgs.bubblewrap}/bin/bwrap
    exec ${comp}/bin/brasos-comp ${lib.optionalString cfg.drm "--drm"} \
      -c ${lib.escapeShellArg config.brasos.uiCommand} ${lib.concatMapStringsSep " " (c: "-c ${lib.escapeShellArg c}") cfg.clients}
  '';
in {
  options.brasos.compositor.enable = lib.mkEnableOption "the native-app compositor spike";
  # brasos-comp as the session itself (DRM/KMS, libinput), not a window inside cage. Reuses cage's tty/PAM/logind unit: the
  # unit runs `<package>/bin/cage -- <program>`, so a package whose `cage` runs the session script replaces it.
  options.brasos.compositor.drm = lib.mkEnableOption "brasos-comp owning the display (no cage)";
  options.brasos.compositor.clients = lib.mkOption {
    type = lib.types.listOf lib.types.str;
    default = [ ];
    description = "Native Wayland apps started at login, unsandboxed, beside the shell. Prefer `apps`, which are sandboxed and launched on demand.";
  };
  options.brasos.compositor.apps = lib.mkOption {
    default = { };
    description = "Native apps the launcher offers, by id. Each runs in bubblewrap: no home, no network unless `network`, no access to BrasOS's own sockets.";
    type = lib.types.attrsOf (lib.types.submodule {
      options = {
        name = lib.mkOption { type = lib.types.str; };
        icon = lib.mkOption { type = lib.types.str; default = "app"; };
        command = lib.mkOption { type = lib.types.listOf lib.types.str; description = "argv; the first element is an absolute path."; };
        network = lib.mkOption { type = lib.types.bool; default = false; };
      };
    });
  };

  config = lib.mkIf cfg.enable {
    assertions = [{ assertion = !config.brasos.hardened.enable; message = "the compositor spike is not for the hardened profile"; }];
    brasos.compositor.apps.foot = { name = "Terminal (native, sandboxed)"; icon = "terminal"; command = [ "${pkgs.foot}/bin/foot" ]; };
    systemd.tmpfiles.rules = [ "d /run/brasos-comp 0700 brasos users -" ];
    # the shell (host) lists, focuses, closes and launches native windows through it (packages/native)
    systemd.services.brasos-shell.environment = {
      BRASOS_COMP_SOCKET = socket;
      BRASOS_NATIVE_APPS_JSON = "${appsJson}";
    };
    services.cage.package = lib.mkIf cfg.drm (pkgs.writeShellScriptBin "cage" ''exec ${session}'');
    services.cage.program = lib.mkForce session;
  };
}
