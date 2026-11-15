{
  description = "BrasOS";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      lib = nixpkgs.lib;
      # seed copy of the shell; the live copy in /var/lib/brasos/shell is the user's to edit
      shellSrc = lib.cleanSourceWith {
        src = ./shell;
        filter = p: _: !(builtins.elem (baseNameOf p) [ "node_modules" "dist" ]);
      };
    in {
      nixosConfigurations.brasos = lib.nixosSystem {
        system = "x86_64-linux";
        specialArgs = { inherit shellSrc; };
        modules = [ ./nixos/configuration.nix ];
      };
    };
}
