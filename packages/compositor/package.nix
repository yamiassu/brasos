# The compositor: smithay, built from the pinned Cargo.lock. The only git dependency (smithay) needs its hash listed.
{ lib, rustPlatform, pkg-config, wayland, libinput, systemdLibs, seatd, pixman, libdrm, libgbm, libxkbcommon, libGL, libx11, libxcursor, libxi, libxrandr, mesa, libglvnd, makeWrapper }:
rustPlatform.buildRustPackage {
  pname = "brasos-comp";
  version = "0.1.0";
  # its own copy in the store (by content, not as a subpath of the whole flake), so an update that does not touch the compositor
  # does not recompile it on every machine: only these files decide its identity
  src = builtins.path { path = ./.; name = "brasos-comp-src"; filter = p: _: !(builtins.elem (baseNameOf p) [ "target" "README.md" "module.nix" "package.nix" "steam.nix" ]); };
  cargoLock = {
    lockFile = builtins.path { path = ./Cargo.lock; name = "brasos-comp-Cargo.lock"; };
    outputHashes."smithay-0.7.0" = "sha256-NG49dc+dCPGRoxeaEUkQ/8smI4JWqnCZVzEAWWvanlc=";
  };
  nativeBuildInputs = [ pkg-config makeWrapper ];
  buildInputs = [ libinput systemdLibs seatd pixman libdrm libgbm wayland libxkbcommon libGL mesa libx11 libxcursor libxi libxrandr ];
  # winit loads these at run time
  postFixup = ''
    wrapProgram $out/bin/brasos-comp --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath [ wayland libxkbcommon libGL libglvnd libx11 libxcursor libxi libxrandr ]}
  '';
}
