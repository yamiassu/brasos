{
  description = "BrasOS";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      lib = nixpkgs.lib;
      root = toString ./.;
      # Only what the OS runs goes into the image source (the in-OS guides in docs/ included), so editing tests or benches doesn't rebuild it.
      src = lib.cleanSourceWith {
        src = ./.;
        filter = p: t:
          let top = builtins.head (lib.splitString "/" (lib.removePrefix (root + "/") (toString p)));
          in toString p == root
            || (builtins.elem top [ "packages" "apps" "docs" "package.json" "bun.lock" "tsconfig.json" ]
                && !(builtins.elem (baseNameOf p) [ "node_modules" "dist" "test" "bench.ts" "bench.tsx" ]));
      };
      # The whole source, for rebuilding from inside the installed system (brasos-update --local); everything but build output and state.
      flakeSrc = lib.cleanSourceWith {
        src = self;
        filter = p: t: !(builtins.elem (baseNameOf p) [ "node_modules" "dist" "target" ".iso" ".vm" ".state" ".git" ".claude" ]);
      };
      # One system per profile: the same modules, with the hardened package off (dev) or on.
      drm = { brasos.compositor.enable = true; brasos.compositor.drm = true; };
      dev-drm = drm // { brasos.setup.devSkip = true; }; # no first-boot setup or lock screen: for the live image and VMs
      # the installed system keeps the real first-boot setup (account, preferences) and the lock screen
      mk = hardened: extra: lib.nixosSystem {
        system = "x86_64-linux";
        modules = [
          ./nixos/base.nix
          ./packages/host/module.nix
          ./packages/audit/module.nix
          ./packages/hardened/module.nix
          ./packages/devtools/module.nix
          ./packages/compositor/module.nix
          ./nixos/updates.nix
          { brasos.src = src; brasos.hardened.enable = hardened; brasos.flakeSrc = flakeSrc; brasos.version = self.shortRev or self.dirtyShortRev or "dev"; }
        ] ++ extra;
      };
    in {
      nixosConfigurations = {
        brasos-dev = mk false [ ];
        brasos-hardened = mk true [ ];
        # spike: the native-app compositor instead of bare cage (see packages/compositor)
        brasos-dev-comp = mk false [ { brasos.compositor.enable = true; brasos.setup.devSkip = true; } ];
        brasos-dev-drm = mk false [ { brasos.compositor.enable = true; brasos.compositor.drm = true; brasos.setup.devSkip = true; } ];
        # dev-drm plus Steam in the launcher (unfree, large closure)
        brasos-dev-steam = mk false [ { brasos.compositor.enable = true; brasos.compositor.drm = true; brasos.setup.devSkip = true; brasos.steam.enable = true; } ];
        # bootable UEFI/USB image of the dev profile: `nix build .#iso` (see scripts/iso/build.sh)
        # (the live system is the dev-drm one; `brasos-install` writes brasos-installed to a disk)
        brasos-installed = mk false [ ./nixos/installed.nix drm ];
        brasos-iso = mk false [ ./nixos/iso.nix dev-drm { brasos.installer.system = self.nixosConfigurations.brasos-installed.config.system.build.toplevel; brasos.installer.updateUrl = self.nixosConfigurations.brasos-installed.config.brasos.updates.url; } ];
        # test fixture: the same ISO, installing itself onto /dev/vda at boot (scripts/iso/test.sh)
        brasos-iso-test = mk false [ ./nixos/iso.nix ./nixos/iso-test.nix dev-drm { brasos.installer.system = self.nixosConfigurations.brasos-installed.config.system.build.toplevel; brasos.installer.updateUrl = self.nixosConfigurations.brasos-installed.config.brasos.updates.url; } ];
      };
      packages.x86_64-linux.iso = self.nixosConfigurations.brasos-iso.config.system.build.isoImage;
      packages.x86_64-linux.iso-test = self.nixosConfigurations.brasos-iso-test.config.system.build.isoImage;
    };
}
