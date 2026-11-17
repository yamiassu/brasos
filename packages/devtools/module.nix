# DEVELOPMENT conveniences. Deliberately NOT secure (see AGENTS.md, docs/compliance/ppsi-mapping.md): default password,
# passwordless root, an AI agent with full privilege, dependencies fetched at boot, a user-editable shell.
# On unless the hardened package is enabled; the two are mutually exclusive.
{ config, lib, pkgs, ... }:
let
  cfg = config.brasos.devtools;
  src = config.brasos.src;
  nodeModules = import ../../nixos/node-modules.nix { inherit pkgs src; }; # dependencies pinned at build time: the first boot needs no network
  # PWAs installed through the browser app live here, next to the editable copy of the OS
  # The live copy of the OS sits in the user's home (/BrasOS in Files), so the interface can be edited from inside it.
  live = "/var/lib/brasos/state/home/BrasOS";
  restartCmd = pkgs.writeShellScript "brasos-restart" ''
    # reset-failed clears the crash-loop counter, so a deliberate restart never trips safe mode; Conflicts= stops the safe copy.
    /run/wrappers/bin/sudo ${pkgs.systemd}/bin/systemctl reset-failed brasos-shell
    /run/wrappers/bin/sudo ${pkgs.systemd}/bin/systemctl --no-block restart brasos-shell
  '';
  env = {
    BRASOS_STATE_DIR = "/var/lib/brasos/state";
    BRASOS_RESTART_CMD = "${restartCmd}";
    BRASOS_POWER_CMD = "/run/wrappers/bin/sudo ${pkgs.systemd}/bin/systemctl"; # the host adds the action (poweroff or reboot)
  } // lib.optionalAttrs (config.brasos.setup.preseed != null) { BRASOS_SETUP_PRESEED = "${config.brasos.setup.preseed}"; }
    // lib.optionalAttrs config.brasos.setup.devSkip { BRASOS_SETUP_DEV_SKIP = "1"; };
  # The live copy of the OS is the person's to edit, so an update must not blindly overwrite it, and must not leave it stale either.
  # It is seeded from the store and stamped with a hash of what was seeded and the store path it came from. A new build replaces
  # it only if it is still exactly what was seeded (never edited); an edited copy is kept. A copy made before stamps existed is
  # backed up first, because nothing says whether it was edited. node_modules is kept (it is the slow part to get).
  seed = pkgs.writeShellApplication {
    name = "brasos-seed";
    runtimeInputs = with pkgs; [ coreutils findutils diffutils gnused ];
    text = ''
      src=$1 d=$2
      stamp=$d/.brasos-seed
      tree() { (cd "$1" && find . -path ./node_modules -prune -o -type f ! -name .brasos-seed -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1); }
      seed() {
        keep=""
        if [ -d "$d/node_modules" ]; then keep=$(mktemp -d) && mv "$d/node_modules" "$keep/"; fi
        rm -rf "$d"; mkdir -p "$(dirname "$d")"; cp -r "$src" "$d"; chmod -R u+w "$d"
        if [ -n "$keep" ]; then mv "$keep/node_modules" "$d/" && rmdir "$keep"; fi
        printf '%s\n%s\n' "$(tree "$d")" "$src" > "$stamp"
      }
      if [ ! -d "$d" ]; then seed
      elif [ -f "$stamp" ]; then
        if [ "$(sed -n 2p "$stamp")" != "$src" ]; then
          if [ "$(tree "$d")" = "$(sed -n 1p "$stamp")" ]; then seed
          else echo "BrasOS: the new build is not applied because $d has your edits; run brasos-reset-shell to start from the new build"; fi
        fi
      else
        if ! diff -rq -x node_modules -x .brasos-seed "$src" "$d" >/dev/null 2>&1; then
          b="$d.backup-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$b"; cp -r --no-preserve=ownership "$d"/. "$b"/ 2>/dev/null || true; rm -rf "$b/node_modules"
          echo "BrasOS: the old interface copy was saved to $b"
        fi
        seed
      fi
    '';
  };
  resetShell = pkgs.writeShellScriptBin "brasos-reset-shell" ''
    sudo systemctl stop brasos-shell brasos-shell-safe
    sudo rm -rf /var/lib/brasos/state/home/BrasOS
    sudo systemctl reset-failed brasos-shell
    sudo systemctl start brasos-shell
  '';
  sudo = "/run/wrappers/bin/sudo";
  systemctl = "${pkgs.systemd}/bin/systemctl";
  # what the recovery page may do (fixed commands; see packages/recovery)
  recoveryActions = {
    restart = [ "${restartCmd}" ];
    safe = [ sudo systemctl "start" "brasos-shell-safe" ];
    reset = [ "${resetShell}/bin/brasos-reset-shell" ];
    reboot = [ sudo systemctl "reboot" ];
    logs = [ "${pkgs.systemd}/bin/journalctl" "-u" "brasos-shell" "-u" "brasos-shell-safe" "-n" "80" "--no-pager" "-o" "cat" ];
  };
  script = dir: ''
    d=${if dir == "os" then live else "/var/lib/brasos/safe"}
    ${lib.optionalString (dir == "os") ''${seed}/bin/brasos-seed ${src} "$d"''}
    ${lib.optionalString (dir == "safe") ''rm -rf "$d" && cp -r ${src} "$d" && chmod -R u+w "$d"''}
    cd "$d"
    # the first boot has no network on many PCs (Wi-Fi is not set up yet): start from the pinned dependencies, then refresh if online
    if [ ! -d node_modules ]; then cp -r ${nodeModules} node_modules && chmod -R u+w node_modules; fi
    timeout 30 bun install || true
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
    # `poweroff` and `reboot` work from the terminal without sudo (the person at the keyboard is the owner of this dev machine)
    security.polkit.enable = true;
    security.polkit.extraConfig = ''
      polkit.addRule(function (action, subject) {
        if (subject.isInGroup("wheel") && /^org\.freedesktop\.login1\.(power-off|reboot|halt)/.test(action.id)) return polkit.Result.YES;
      });
    '';
    nix.settings.trusted-users = [ "brasos" ];

    environment.systemPackages = (with pkgs; [ bun claude-code git curl vim chromium ]) ++ [
      resetShell
    ];

    # The recovery page (packages/recovery): a separate service from the pristine store copy, so a broken desktop can't take it down.
    brasos.recoveryUrl = "http://localhost:7001/";
    systemd.services.brasos-recovery = {
      wantedBy = [ "multi-user.target" ];
      path = with pkgs; [ bun coreutils systemd "/run/wrappers" ]; # the reset script calls sudo, systemctl and rm by name
      environment = { BRASOS_RECOVERY_ACTIONS = builtins.toJSON recoveryActions; };
      serviceConfig = { User = "brasos"; Restart = "always"; RestartSec = 2; WorkingDirectory = "${src}"; };
      script = "exec bun packages/recovery/src/main.ts";
    };

    # The live copy (/var/lib/brasos/os) is user-editable. If it keeps failing, systemd starts the pristine copy
    # from the Nix store on the same port. `brasos-reset-shell` re-seeds the live copy.
    systemd.services.brasos-shell = {
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      path = with pkgs; [ bun bash coreutils util-linux wireplumber ]; # coreutils: cp, timeout; util-linux: lsblk, rfkill; wireplumber: wpctl (Settings, Installer)
      environment = env // { BRASOS_SRC = "${src}"; BRASOS_LIVE = live; }; # Settings → Updates compares the interface's stamp with the system's build
      unitConfig = {
        Conflicts = [ "brasos-shell-safe.service" ];
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
      path = with pkgs; [ bun bash coreutils util-linux wireplumber ]; # coreutils: cp, timeout; util-linux: lsblk, rfkill; wireplumber: wpctl (Settings, Installer)
      environment = env;
      serviceConfig = {
        User = "brasos";
        StateDirectory = "brasos";
      };
      script = script "safe";
    };
  };
}
