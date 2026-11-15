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
      # One system per profile: the same modules, with the hardened package off (dev) or on.
      mk = hardened: extra: lib.nixosSystem {
        system = "x86_64-linux";
        modules = [
          ./nixos/base.nix
          ./packages/host/module.nix
          ./packages/audit/module.nix
          ./packages/hardened/module.nix
          ./packages/devtools/module.nix
          ./packages/compositor/module.nix
          { brasos.src = src; brasos.hardened.enable = hardened; }
        ] ++ extra;
      };
    in {
      nixosConfigurations = {
        brasos-dev = mk false [ ];
        brasos-hardened = mk true [ ];
        # spike: the native-app compositor instead of bare cage (see packages/compositor)
        brasos-dev-comp = mk false [ { brasos.compositor.enable = true; } ];
        brasos-dev-drm = mk false [ { brasos.compositor.enable = true; brasos.compositor.drm = true; } ];
      };
    };
}
