# Shared by every profile: kiosk session, fonts, VM settings. Profile files add (or deliberately omit) everything else.
{ config, pkgs, lib, ... }:
let
  port = "7000";
  # wait for the shell server, then launch the UI
  ui = pkgs.writeShellScript "brasos-ui" ''
    until ${pkgs.curl}/bin/curl -sf http://localhost:${port}/ >/dev/null; do sleep 0.5; done
    exec ${pkgs.chromium}/bin/chromium --kiosk --ozone-platform=wayland --site-per-process --disable-features=Translate,TranslateUI,DownloadBubble,DownloadBubbleV2,GlobalMediaControls,MediaRouter,ReadAnything,SidePanelPinning \
      --password-store=basic --disable-infobars --noerrdialogs --disable-session-crashed-bubble \
      --no-first-run --user-data-dir=/home/brasos/.config/brasos-chromium ${config.brasos.uiUrl}
  '';
in {
  # the command that shows the shell (Chromium, kiosk); a compositor module can launch it among other clients
  # what the kiosk browser shows: the desktop, or (the live install image) the installer app alone, fullscreen
  options.brasos.uiUrl = lib.mkOption { type = lib.types.str; default = "http://localhost:${port}/"; };
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
