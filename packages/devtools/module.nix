# DEVELOPMENT conveniences. Deliberately NOT secure (see AGENTS.md, docs/compliance/ppsi-mapping.md): default password,
# passwordless root, an AI agent with full privilege, dependencies fetched at boot, a user-editable shell.
# On unless the hardened package is enabled; the two are mutually exclusive.
{ config, lib, pkgs, ... }:
let
  cfg = config.brasos.devtools;
  src = config.brasos.src;
  # PWAs installed through the browser app live here, next to the editable copy of the OS
  env.BRASOS_STATE_DIR = "/var/lib/brasos/state";
  script = dir: ''
    d=/var/lib/brasos/${dir}
    ${lib.optionalString (dir == "os") ''if [ ! -d "$d" ]; then cp -r ${src} "$d" && chmod -R u+w "$d"; fi''}
    ${lib.optionalString (dir == "safe") ''rm -rf "$d" && cp -r ${src} "$d" && chmod -R u+w "$d"''}
    cd "$d"
    bun install
    exec bun packages/host/src/main.ts
  '';
in {
  options.brasos.devtools.enable = lib.mkOption {
    type = lib.types.bool;
    default = !config.brasos.hardened.enable;
    description = "Development conveniences (terminal, sudo, Claude Code, editable shell). Insecure by design.";
  };

  config = lib.mkIf cfg.enable {
    assertions = [{
      assertion = !config.brasos.hardened.enable;
      message = "brasos.devtools and brasos.hardened are mutually exclusive";
    }];

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
        sudo rm -rf /var/lib/brasos/os
        sudo systemctl reset-failed brasos-shell
        sudo systemctl start brasos-shell
      '')
    ];

    # The live copy (/var/lib/brasos/os) is user-editable. If it keeps failing, systemd starts the pristine copy
    # from the Nix store on the same port. `brasos-reset-shell` re-seeds the live copy.
    systemd.services.brasos-shell = {
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      path = with pkgs; [ bun bash coreutils ];
      environment = env;
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
      script = script "os";
    };
    systemd.services.brasos-shell-safe = {
      path = with pkgs; [ bun bash coreutils ];
      environment = env;
      serviceConfig = {
        User = "brasos";
        StateDirectory = "brasos";
      };
      script = script "safe";
    };
  };
}
