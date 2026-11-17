# The real browser (dev only): Chromium as a native window beside the shell, from its own saved profile. Sites load from their real
# address, so sign-in (Google, Steam...), passkeys and anything that checks the origin work; the Browser app's gateway can't do that.
# It is `open`: a plain user process, NOT isolated like a BrasOS app (that is the price of a normal browser). The hardened profile never has it.
# It carries the BrasOS extension (packages/extension): when a site is installed as an app in this browser, the extension asks BrasOS to
# add it, and BrasOS shows its own install prompt (where the app runs: a sandboxed BrasOS window, or an app window of this browser).
{ config, lib, pkgs, ... }:
let
  cfg = config.brasos.browser;
  # the extension's files, with the address of the host written next to them (the port is the shell's: nixos/base.nix)
  extension = pkgs.runCommand "brasos-extension" { } ''
    cp -r ${../extension/ext} $out
    chmod -R u+w $out
    echo 'globalThis.BRASOS_HOST = "http://localhost:7000";' > $out/config.js
  '';
  chromium = [
    "${pkgs.chromium}/bin/chromium"
    "--ozone-platform=wayland"
    "--user-data-dir=/home/brasos/.config/brasos-web" # its own profile: logins, history and extensions persist across restarts
    "--password-store=basic"
    "--no-first-run"
    "--no-default-browser-check"
    "--load-extension=${extension}"
    "--disable-features=DisableLoadExtensionCommandLineSwitch" # newer builds turn the switch off unless told not to
  ];
in {
  options.brasos.browser.enable = lib.mkOption {
    type = lib.types.bool;
    default = config.brasos.compositor.enable && !config.brasos.hardened.enable;
    description = "A real Chromium window as the default Browser (needs the compositor; never with the hardened package).";
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      { assertion = config.brasos.compositor.enable; message = "brasos.browser needs brasos.compositor (native windows)"; }
      { assertion = !config.brasos.hardened.enable; message = "the real browser is an unsandboxed native app: not for the hardened profile"; }
    ];
    brasos.compositor.apps.web = {
      name = "Browser";
      icon = "browser";
      network = true;
      sandbox = "open";
      takesUrl = true; # the shell may pass one http(s) address, which the compositor checks again
      command = chromium;
    };
    # An installed web app that runs in the real browser: the same Chromium, the address as `--app=<address>` (an app window with no tabs).
    # Not offered in Start: the shell starts it for the app by its address (checked in the host and again in the compositor).
    brasos.compositor.apps.webapp = {
      name = "Web app";
      icon = "globe";
      network = true;
      sandbox = "open";
      takesUrl = true;
      urlAsApp = true;
      command = chromium;
    };
  };
}
