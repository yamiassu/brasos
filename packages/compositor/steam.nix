# Steam as a native app (dev only). Steam is an unfree X11 client with its own sandbox (pressure-vessel) and a 32-bit userland, so
# it runs `open` (not inside our bubblewrap) beside the shell through Xwayland. The client downloads itself on first launch;
# games and the Steam account live in the user's home (/home/brasos/.local/share/Steam). The hardened profile never has it.
{ config, lib, pkgs, ... }:
{
  options.brasos.steam.enable = lib.mkEnableOption "Steam in the launcher (unfree; adds Xwayland and 32-bit graphics)";

  config = lib.mkIf config.brasos.steam.enable {
    assertions = [
      { assertion = config.brasos.compositor.enable; message = "brasos.steam needs brasos.compositor (native apps)"; }
      { assertion = !config.brasos.hardened.enable; message = "Steam is an unsandboxed native app: not for the hardened profile"; }
    ];
    # unfree, but only Steam's own packages
    nixpkgs.config.allowUnfreePredicate = pkg: builtins.elem (lib.getName pkg) [ "steam" "steam-unwrapped" "steam-original" "steam-run" ];
    programs.steam.enable = true;
    hardware.graphics.enable32Bit = true;
    brasos.compositor.xwayland = true;
    # the client alone wants hundreds of MB free before it starts, and games are far larger: give the test VM room
    virtualisation.vmVariant.virtualisation = { diskSize = 40960; memorySize = lib.mkForce 6144; };
    brasos.compositor.apps.steam = {
      name = "Steam";
      icon = "app";
      command = [ "${config.programs.steam.package}/bin/steam" ];
      network = true;
      sandbox = "open";
    };
  };
}
