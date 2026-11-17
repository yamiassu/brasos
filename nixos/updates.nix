# Updating the running system from inside it (dev profile only; the hardened package gets none of this). Two ways, one script:
#  - `brasos-update`            fetch the operator's manifest (brasos.updates.url) and switch to the system it names
#  - `brasos-update --local`    rebuild from the editable on-device copy of the flake (/var/lib/brasos/flake), so a change made inside
#                               BrasOS can be built without leaving it
#  - `brasos-update --rollback` back to the previous generation (the bootloader keeps them too)
# The script runs as root (sudo, dev profile) and validates the manifest itself: the host never passes it anything to run.
# Building new store paths needs a network (cache.nixos.org, or brasos.updates.cache) unless they are already in the store.
# Authenticity of an update is TLS to the manifest host plus the signature of the binary cache; there is no offline signing yet.
{ config, lib, pkgs, ... }:
let
  cfg = config.brasos.updates;
  on = cfg.attr != null && !config.brasos.hardened.enable;
  flake = "/var/lib/brasos/flake";
  update = pkgs.writeShellApplication {
    name = "brasos-update";
    runtimeInputs = with pkgs; [ curl jq coreutils nixos-rebuild nix ];
    text = ''
      attr=${lib.escapeShellArg (toString cfg.attr)}
      cache=${lib.escapeShellArg (toString cfg.cache)}
      key=${lib.escapeShellArg (toString cfg.publicKey)}
      extra=()
      if [ -n "$cache" ] && [ -n "$key" ]; then extra=(--option extra-substituters "$cache" --option extra-trusted-public-keys "$key"); fi
      case "''${1:-}" in
        --rollback) exec nixos-rebuild switch --rollback ;;
        --local)
          if [ ! -f ${flake}/flake.nix ]; then
            mkdir -p ${flake} && cp -rL --no-preserve=mode,ownership /etc/brasos-flake/. ${flake}/
          fi
          exec nixos-rebuild switch --flake "path:${flake}#$attr" "''${extra[@]}" ;;
        "")
          url=${lib.escapeShellArg (toString cfg.url)}
          [ -n "$url" ] || { echo "no update server is configured" >&2; exit 2; }
          m=$(curl -fsS --max-time 20 --max-filesize 65536 --proto '=https' "$url")
          # the manifest names a flake to switch to; accept only a plain https reference
          flakeref=$(jq -er 'select(.flake | test("^https://[A-Za-z0-9._~:/?#=&%+-]{1,400}$")) | .flake' <<<"$m") || { echo "bad manifest" >&2; exit 3; }
          exec nixos-rebuild switch --flake "$flakeref#$attr" "''${extra[@]}" ;;
        *) echo "usage: brasos-update [--local|--rollback]" >&2; exit 64 ;;
      esac
    '';
  };
  envs = {
    BRASOS_VERSION = config.brasos.version;
    # In its own transient unit, not inside brasos-shell: switching the system restarts the shell's service, and an update that is a
    # child of that service would be killed halfway through activating. The unit survives; the page just reloads when it is done.
    BRASOS_UPDATE_CMD = "/run/wrappers/bin/sudo ${pkgs.systemd}/bin/systemd-run --unit=brasos-update --collect --wait --pipe ${update}/bin/brasos-update";
  } // lib.optionalAttrs (cfg.url != null) { BRASOS_UPDATE_URL = cfg.url; };
in {
  options.brasos.version = lib.mkOption { type = lib.types.str; default = "dev"; description = "Which build this is (the flake's revision); Settings compares it with the manifest's."; };
  options.brasos.flakeSrc = lib.mkOption { type = lib.types.nullOr lib.types.path; default = null; description = "The whole flake source, shipped in the image so the system can be rebuilt from inside it."; };
  options.brasos.updates = {
    attr = lib.mkOption { type = lib.types.nullOr lib.types.str; default = null; description = "The nixosConfiguration this installed system is (null: this image cannot update itself)."; };
    url = lib.mkOption { type = lib.types.nullOr lib.types.str; default = null; description = "HTTPS URL of the update manifest: {\"version\", \"flake\", \"notes\"}."; };
    cache = lib.mkOption { type = lib.types.nullOr lib.types.str; default = null; description = "Binary cache that holds the update's store paths."; };
    publicKey = lib.mkOption { type = lib.types.nullOr lib.types.str; default = null; description = "Public key that cache signs with (never a secret)."; };
  };

  config = lib.mkIf on {
    assertions = [{ assertion = config.brasos.devtools.enable; message = "brasos.updates needs the dev profile (the root update script is a dev convenience)"; }];
    nix.settings.experimental-features = [ "nix-command" "flakes" ];
    environment.systemPackages = [ update ];
    environment.etc."brasos-flake" = lib.mkIf (config.brasos.flakeSrc != null) { source = config.brasos.flakeSrc; };
    systemd.services.brasos-shell.environment = envs;
    systemd.services.brasos-shell-safe.environment = envs;
  };
}
