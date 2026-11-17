# The dev profile's JavaScript dependencies, fetched once at BUILD time and pinned by hash (the same fixed-output derivation the
# hardened package uses: same name and hash, so the same store path), so the first boot needs no network. Only package.json and
# bun.lock matter, so editing other source never rebuilds it. When bun.lock changes: update the hash here AND in
# packages/hardened/module.nix (set it to lib.fakeHash, build, paste the hash Nix reports).
{ pkgs, src }: pkgs.stdenvNoCC.mkDerivation {
  name = "brasos-node_modules";
  src = builtins.path { path = src; name = "brasos-deps-src"; filter = p: _: builtins.elem (baseNameOf p) [ "package.json" "bun.lock" ] || p == toString src; };
  nativeBuildInputs = [ pkgs.bun pkgs.cacert ];
  dontConfigure = true;
  dontFixup = true;
  buildPhase = ''
    export HOME=$TMPDIR SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt
    bun install --frozen-lockfile --production --backend=copyfile
  '';
  installPhase = "cp -r node_modules $out";
  outputHashMode = "recursive";
  outputHashAlgo = "sha256";
  outputHash = "sha256-8ZQSI5a0YeozVU1W1soj4EDu9xPrb0fXj3JDtM0mogY=";
}
