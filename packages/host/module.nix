# The source tree the OS runs. flake.nix sets it (a filtered copy of the repo); the profile modules decide how to run it.
{ lib, ... }:
{
  options.brasos.src = lib.mkOption {
    type = lib.types.path;
    description = "Source of BrasOS (packages/, apps/, package.json, bun.lock, tsconfig.json).";
  };

  # Unattended first boot: a JSON file with the account (an argon2 password hash, never a password) and the preferences.
  # Without it, the first boot shows the installer. See packages/setup.
  options.brasos.setup.preseed = lib.mkOption {
    type = lib.types.nullOr lib.types.path;
    default = null;
    description = "A first-boot provisioning file ({ account: { username, display, passwordHash }, prefs: {...} }); null shows the installer.";
  };

  # Development only: no installer and no lock screen (a throwaway account, default preferences). Refused with the hardened package.
  options.brasos.setup.devSkip = lib.mkOption {
    type = lib.types.bool;
    default = false;
    description = "Skip the first-boot installer and the lock screen (dev profile only).";
  };
}
