# The real browser (dev only): Chromium as a native window beside the shell, from its own saved profile. Sites load from their real
# address, so sign-in (Google, Steam...), passkeys and anything that checks the origin work; the Browser app's gateway can't do that.
# It is `open`: a plain user process, NOT isolated like a BrasOS app (that is the price of a normal browser). The hardened profile never has it.
{ config, lib, pkgs, ... }:
let cfg = config.brasos.browser;
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
      command = [
        "${pkgs.chromium}/bin/chromium"
        "--ozone-platform=wayland"
        "--user-data-dir=/home/brasos/.config/brasos-web" # its own profile: logins, history and extensions persist across restarts
        "--password-store=basic"
        "--no-first-run"
        "--no-default-browser-check"
      ];
    };
  };
}
