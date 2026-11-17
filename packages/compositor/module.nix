# Spike (dev only): brasos-comp, a smithay compositor that lays out Chromium (the shell) beside native Wayland apps. It runs inside
# cage (winit backend) or, with `drm`, owns the display itself. Off by default; the hardened profile never enables it.
{ config, lib, pkgs, ... }:
let
  cfg = config.brasos.compositor;
  comp = pkgs.callPackage ./package.nix { };
  socket = "/run/brasos-comp/ctl.sock"; # 0600, in a directory only the session user can enter

  # The native apps this image offers. The shell lists them and asks for one by id; the command line lives only in the file the
  # compositor reads, and the compositor runs it inside bubblewrap (see src/ctl.rs).
  us = builtins.fromJSON ''"\u001f"''; # the argv separator (Nix strings have no \x escape)
  appsJson = pkgs.writeText "brasos-native-apps.json" (builtins.toJSON (lib.mapAttrsToList (id: a: { inherit id; inherit (a) name icon takesUrl; listed = !a.urlAsApp; }) (lib.filterAttrs (_: a: !a.takesApp) cfg.apps))); # the Flatpak runner is not an app to list
  # flags column of the apps file: n = network, o = open (no sandbox), u = takes a web address, a = takes an application id, "-" = none
  flagsOf = a: let f = (lib.optionalString a.network "n") + (lib.optionalString (a.sandbox == "open") "o") + (lib.optionalString a.takesUrl "u") + (lib.optionalString a.takesApp "a") + (lib.optionalString a.urlAsApp "w"); in if f == "" then "-" else f;
  appsTsv = pkgs.writeText "brasos-native-apps.tsv"
    (lib.concatStrings (lib.mapAttrsToList (id: a: "${id}\t${flagsOf a}\t${lib.concatStringsSep us a.command}\n") cfg.apps));

  session = pkgs.writeShellScript "brasos-session" ''
    export BRASOS_COMP_SOCKET=${socket}
    export BRASOS_NATIVE_APPS=${appsTsv}
    export BRASOS_BWRAP=${pkgs.bubblewrap}/bin/bwrap
    ${lib.optionalString cfg.xwayland ''
      export BRASOS_XWAYLAND=1
      export PATH=${pkgs.xwayland}/bin:$PATH
    ''}
    exec ${comp}/bin/brasos-comp ${lib.optionalString cfg.drm "--drm"} \
      -c ${lib.escapeShellArg config.brasos.uiCommand} ${lib.concatMapStringsSep " " (c: "-c ${lib.escapeShellArg c}") cfg.clients}
  '';
in {
  imports = [ ./steam.nix ./browser.nix ./flatpak.nix ];
  options.brasos.compositor.enable = lib.mkEnableOption "the native-app compositor spike";
  # brasos-comp as the session itself (DRM/KMS, libinput), not a window inside cage. Reuses cage's tty/PAM/logind unit: the
  # unit runs `<package>/bin/cage -- <program>`, so a package whose `cage` runs the session script replaces it.
  options.brasos.compositor.drm = lib.mkEnableOption "brasos-comp owning the display (no cage)";
  options.brasos.compositor.xwayland = lib.mkEnableOption "Xwayland, so X11 apps (Steam) can run";
  options.brasos.compositor.clients = lib.mkOption {
    type = lib.types.listOf lib.types.str;
    default = [ ];
    description = "Native Wayland apps started at login, unsandboxed, beside the shell. Prefer `apps`, which are sandboxed and launched on demand.";
  };
  options.brasos.compositor.apps = lib.mkOption {
    default = { };
    description = "Native apps the launcher offers, by id. By default each runs in bubblewrap: no home, no network unless `network`, no access to BrasOS's own sockets (see `sandbox`).";
    type = lib.types.attrsOf (lib.types.submodule {
      options = {
        name = lib.mkOption { type = lib.types.str; };
        icon = lib.mkOption { type = lib.types.str; default = "app"; };
        command = lib.mkOption { type = lib.types.listOf lib.types.str; description = "argv; the first element is an absolute path."; };
        network = lib.mkOption { type = lib.types.bool; default = false; };
        takesApp = lib.mkOption { type = lib.types.bool; default = false; description = "The host may start this app with one Flatpak application id as its last argument (the Flatpak runner; needs sandbox = \"open\"; not listed in Start)."; };
        takesUrl = lib.mkOption { type = lib.types.bool; default = false; description = "The shell may start this app with one http(s) address as its last argument (after `--`)."; };
        urlAsApp = lib.mkOption { type = lib.types.bool; default = false; description = "With takesUrl: the address is given as `--app=<address>` (a Chromium app window) and the app is not listed in Start (the shell starts it for an installed web app that runs in the real browser)."; };
        sandbox = lib.mkOption {
          type = lib.types.enum [ "strict" "open" ];
          default = "strict";
          description = "strict: bubblewrap, empty home. open: a plain user process (the app sees the user's home and processes); only for apps that cannot run confined, like Steam. Never in hardened.";
        };
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
