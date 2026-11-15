# DEVELOPMENT PROFILE. Convenient and deliberately NOT secure (see AGENTS.md, docs/compliance/ppsi-mapping.md):
# default password, passwordless root, an AI agent with full privilege, dependencies fetched at boot, a user-editable shell.
{ pkgs, shellSrc, ... }:
{
  nixpkgs.config.allowUnfree = true; # claude-code
  networking.networkmanager.enable = true;

  users.users.brasos = {
    initialPassword = "brasos";
    extraGroups = [ "wheel" "networkmanager" ];
  };
  # Full privilege for Claude Code.
  security.sudo.wheelNeedsPassword = false;
  nix.settings.trusted-users = [ "brasos" ];

  environment.systemPackages = (with pkgs; [ bun claude-code git curl vim chromium ]) ++ [
    (pkgs.writeShellScriptBin "brasos-reset-shell" ''
      sudo systemctl stop brasos-shell brasos-shell-safe
      sudo rm -rf /var/lib/brasos/shell
      sudo systemctl reset-failed brasos-shell
      sudo systemctl start brasos-shell
    '')
  ];

  # The live shell (/var/lib/brasos/shell) is user-editable. If it keeps failing, systemd starts the
  # pristine copy from the Nix store on the same port. `brasos-reset-shell` re-seeds the live copy.
  systemd.services.brasos-shell = {
    wantedBy = [ "multi-user.target" ];
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    path = with pkgs; [ bun bash coreutils ];
    unitConfig = {
      OnFailure = [ "brasos-shell-safe.service" ];
      StartLimitIntervalSec = 60;
      StartLimitBurst = 3;
    };
    serviceConfig = {
      User = "brasos";
      StateDirectory = "brasos"; # /var/lib/brasos, owned by brasos
      Restart = "on-failure";
      RestartSec = 2;
    };
    script = ''
      d=/var/lib/brasos/shell
      if [ ! -d "$d" ]; then cp -r ${shellSrc} "$d" && chmod -R u+w "$d"; fi
      cd "$d"
      bun install
      exec bun server.ts
    '';
  };
  systemd.services.brasos-shell-safe = {
    path = with pkgs; [ bun bash coreutils ];
    serviceConfig = {
      User = "brasos";
      StateDirectory = "brasos";
    };
    script = ''
      d=/var/lib/brasos/safe
      rm -rf "$d" && cp -r ${shellSrc} "$d" && chmod -R u+w "$d"
      cd "$d"
      bun install
      exec bun server.ts
    '';
  };
}
