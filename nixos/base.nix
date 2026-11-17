# Shared by every profile: kiosk session, fonts, VM settings. Profile files add (or deliberately omit) everything else.
{ config, pkgs, lib, ... }:
let
  port = "7000";
  # Wait for the shell server, then show the UI. Where the image has a recovery page (brasos.recoveryUrl), the browser is moved to it
  # when the server stays unreachable (about 12 s, or 40 s after boot) and back to the UI when it answers again.
  ui = pkgs.writeShellScript "brasos-ui" ''
    up() { ${pkgs.curl}/bin/curl -sf --max-time 2 http://localhost:${port}/ >/dev/null; }
    launch() {
      ${pkgs.chromium}/bin/chromium --kiosk --ozone-platform=wayland --site-per-process --disable-features=Translate,TranslateUI,DownloadBubble,DownloadBubbleV2,GlobalMediaControls,MediaRouter,ReadAnything,SidePanelPinning \
        --password-store=basic --disable-infobars --noerrdialogs --disable-session-crashed-bubble \
        --no-first-run --user-data-dir=/home/brasos/.config/brasos-chromium "$1" &
      pid=$!
    }
    rec=${if config.brasos.recoveryUrl == null then "" else lib.escapeShellArg config.brasos.recoveryUrl}
    if [ -n "$rec" ]; then for _ in $(seq 80); do up && break; sleep 0.5; done; else until up; do sleep 0.5; done; fi
    if up || [ -z "$rec" ]; then mode=ui; launch ${lib.escapeShellArg config.brasos.uiUrl}; else mode=rec; launch "$rec"; fi
    fails=0
    while kill -0 $pid 2>/dev/null; do
      sleep 3
      [ -n "$rec" ] || continue
      if up; then
        fails=0
        if [ $mode = rec ]; then kill $pid; wait $pid 2>/dev/null; mode=ui; launch ${lib.escapeShellArg config.brasos.uiUrl}; fi
      else
        fails=$((fails + 1))
        if [ $fails -ge 4 ] && [ $mode = ui ]; then kill $pid; wait $pid 2>/dev/null; mode=rec; launch "$rec"; fi
      fi
    done
    wait $pid
  '';
in {
  # the command that shows the shell (Chromium, kiosk); a compositor module can launch it among other clients
  # what the kiosk browser shows: the desktop, or (the live install image) the installer app alone, fullscreen
  options.brasos.uiUrl = lib.mkOption { type = lib.types.str; default = "http://localhost:${port}/"; };
  # the page the kiosk falls back to when the desktop's server doesn't answer (null: none, as in hardened)
  options.brasos.recoveryUrl = lib.mkOption { type = lib.types.nullOr lib.types.str; default = null; };
  options.brasos.uiCommand = lib.mkOption { type = lib.types.str; default = "${ui}"; internal = true; };

  config = {
  # A kiosk shows BrasOS and nothing else: no "save this password?", translate, autofill or "make default browser" bubbles over it
  # (the lock screen's password field would otherwise trigger the first). A managed policy, so it holds whatever the page does.
  programs.chromium = {
    enable = true;
    extraOpts = {
      PasswordManagerEnabled = false;
      TranslateEnabled = false;
      AutofillAddressEnabled = false;
      AutofillCreditCardEnabled = false;
      DefaultBrowserSettingEnabled = false;
      PasswordLeakDetectionEnabled = false;
      PromotionalTabsEnabled = false;
      DefaultNotificationsSetting = 2; # a site asking to show notifications, or where you are, gets no panel over the desktop
      DefaultGeolocationSetting = 2;
      SpellcheckEnabled = false;
      BackgroundModeEnabled = false;
      MediaRecommendationsEnabled = false;
      BrowserAddPersonEnabled = false;
      ShoppingListEnabled = false;
      SearchSuggestEnabled = false;
    };
  };
  system.stateVersion = "25.11";
  networking.hostName = "brasos";
  # the system says BrasOS everywhere it names itself: os-release, the login banner, the boot menu entries, systemd's boot text
  system.nixos.distroName = "BrasOS";
  system.nixos.distroId = "brasos"; # os-release: ID=brasos, ID_LIKE=nixos (so tools that care still know what it is built from), no nixos.org links
  system.nixos.vendorName = "BrasOS";
  system.nixos.vendorId = "brasos";
  system.nixos.extraOSReleaseArgs.LOGO = "brasos";
  # Shutting down must not wait 90 s on a service that ignores SIGTERM (the desktop server, the browser): kill it after 10 s
  systemd.settings.Manager = { DefaultTimeoutStopSec = "10s"; };
  services.getty.helpLine = lib.mkForce ""; # the stock help line points at the NixOS manual

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
  # tty1 belongs to the desktop. The login prompt (getty) Conflicts with it, so whenever the prompt's unit changed (any update that
  # touches the login banner) or logind opened one on a VT switch, the switch stopped the desktop and left a text login. No prompt on tty1:
  # the other consoles (Ctrl+Alt+F2...) keep theirs, and a crashed desktop restarts by itself.
  systemd.services."getty@tty1".enable = false;
  systemd.services."autovt@tty1".enable = false;
  # each profile defines brasos-shell.service
  systemd.services."cage-tty1" = {
    serviceConfig.Restart = "always";
    serviceConfig.RestartSec = 1;
    # Closing the desktop closes the browser properly first. systemd stops everything in the unit at once; the compositor dies at
    # once, and a browser that loses its display exits on the spot, before it has written its cookies and site storage (so a
    # website login, such as WhatsApp Web, was lost at every restart). Ask the browser to quit and wait for it (up to 25 s).
    serviceConfig.ExecStop = pkgs.writeShellScript "brasos-browser-quit" ''
      main() { ${pkgs.procps}/bin/pgrep -u brasos -f -- 'brasos-chromium' >/dev/null; }
      ${pkgs.procps}/bin/pkill -u brasos -TERM -f -- '--kiosk' || true
      for _ in $(seq 50); do main || exit 0; sleep 0.5; done
      exit 0
    '';
    serviceConfig.TimeoutStopSec = 30;
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
