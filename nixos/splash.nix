# What a PC shows while it starts and while it shuts down: the BrasOS mark on a dark screen instead of the text of the boot log.
# Plymouth draws it (early, from the initrd, and again at poweroff/reboot). Imported by the images that run on real PCs.
{ pkgs, ... }:
let
  theme = pkgs.runCommand "brasos-plymouth-theme" { nativeBuildInputs = [ pkgs.librsvg ]; } ''
    d=$out/share/plymouth/themes/brasos
    mkdir -p $d
    rsvg-convert -w 192 -h 192 ${../docs/brand/logo-mark.svg} -o $d/logo.png
    cat > $d/brasos.plymouth <<EOF
    [Plymouth Theme]
    Name=BrasOS
    Description=The BrasOS mark, breathing, on a dark screen
    ModuleName=script

    [script]
    ImageDir=$d
    ScriptFile=$d/brasos.script
    EOF
    cat > $d/brasos.script <<'EOF'
    Window.SetBackgroundTopColor(0.047, 0.047, 0.051);
    Window.SetBackgroundBottomColor(0.047, 0.047, 0.051);
    logo.image = Image("logo.png");
    logo.sprite = Sprite(logo.image);
    logo.sprite.SetX(Window.GetWidth() / 2 - logo.image.GetWidth() / 2);
    logo.sprite.SetY(Window.GetHeight() / 2 - logo.image.GetHeight() / 2);
    t = 0;
    fun refresh() {
      t++;
      logo.sprite.SetOpacity(0.7 + 0.3 * Math.Sin(t / 18));
    }
    Plymouth.SetRefreshFunction(refresh);
    EOF
  '';
in {
  boot.plymouth = { enable = true; theme = "brasos"; themePackages = [ theme ]; };
  # no kernel or systemd messages over it (they stay in the journal)
  boot.consoleLogLevel = 0;
  boot.kernelParams = [ "quiet" "loglevel=3" "udev.log_level=3" "systemd.show_status=false" "rd.systemd.show_status=false" "vt.global_cursor_default=0" ];
}
