# The compositor: smithay, built from the pinned Cargo.lock. The only git dependency (smithay) needs its hash listed.
{ lib, rustPlatform, pkg-config, wayland, libxkbcommon, libGL, libx11, libxcursor, libxi, libxrandr, mesa, libglvnd, makeWrapper }:
rustPlatform.buildRustPackage {
  pname = "brasos-comp";
  version = "0.1.0";
  src = ./.;
  cargoLock = {
    lockFile = ./Cargo.lock;
    outputHashes."smithay-0.7.0" = lib.fakeHash;
  };
  nativeBuildInputs = [ pkg-config makeWrapper ];
  buildInputs = [ wayland libxkbcommon libGL mesa libx11 libxcursor libxi libxrandr ];
  # winit loads these at run time
  postFixup = ''
    wrapProgram $out/bin/brasos-comp --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath [ wayland libxkbcommon libGL libglvnd libx11 libxcursor libxi libxrandr ]}
  '';
}
