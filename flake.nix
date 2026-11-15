{
  description = "BrasOS";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      lib = nixpkgs.lib;
      # An app is in the hardened image only if its manifest lists "hardened" in "profiles" (default deny).
      optedIn = p:
        builtins.pathExists (p + "/manifest.json")
        && builtins.elem "hardened" ((builtins.fromJSON (builtins.readFile (p + "/manifest.json"))).profiles or [ "dev" ]);
      # dev: seed copy of the shell (the live copy in /var/lib/brasos/shell is the user's to edit)
      # hardened: the immutable source the server and build run from
      mkShellSrc = profile: lib.cleanSourceWith {
        src = ./shell;
        filter = p: t:
          !(builtins.elem (baseNameOf p) [ "node_modules" "dist" ])
          && !(profile == "hardened" && t == "directory" && baseNameOf (dirOf p) == "apps" && !(optedIn p));
      };
      mk = profile: lib.nixosSystem {
        system = "x86_64-linux";
        specialArgs = { shellSrc = mkShellSrc profile; };
        modules = [ ./nixos/base.nix (./nixos/profiles + "/${profile}.nix") ];
      };
    in {
      nixosConfigurations = {
        brasos-dev = mk "dev";
        brasos-hardened = mk "hardened";
      };
    };
}
