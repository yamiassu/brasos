# The source tree the OS runs. flake.nix sets it (a filtered copy of the repo); the profile modules decide how to run it.
{ lib, ... }:
{
  options.brasos.src = lib.mkOption {
    type = lib.types.path;
    description = "Source of BrasOS (packages/, apps/, package.json, bun.lock, tsconfig.json).";
  };
}
