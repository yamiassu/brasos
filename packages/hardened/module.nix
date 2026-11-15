# The hardened package, OS side. Enable with `brasos.hardened.enable = true;` (the server side is src/index.ts, enabled
# by BRASOS_PACKAGES=hardened, which this module sets). Work in progress: see docs/compliance/ppsi-mapping.md.
# No credentials, no sudo, no terminal, no runtime fetching, immutable shell, sandboxed service, locked-down browser.
{ config, lib, pkgs, ... }:
let
  cfg = config.brasos.hardened;

  # default deny at image level too: an app is in the hardened image only if its manifest says brasos.hardened = true
  optedIn = p:
    builtins.pathExists (p + "/manifest.webmanifest")
    && (builtins.fromJSON (builtins.readFile (p + "/manifest.webmanifest"))).brasos.hardened or false;
  src = lib.cleanSourceWith {
    src = config.brasos.src;
    filter = p: t: !(t == "directory" && baseNameOf (dirOf p) == "apps" && !(optedIn p));
  };

  # R7: dependencies are fetched once at BUILD time and pinned by hash, never at boot.
  # When bun.lock changes: set outputHash to lib.fakeHash, build, and paste the hash Nix reports.
  nodeModules = pkgs.stdenvNoCC.mkDerivation {
    name = "brasos-node_modules";
    inherit src;
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
  };

  # The shell and opted-in apps are bundled at build time; the running server never builds anything.
  dist = pkgs.stdenvNoCC.mkDerivation {
    name = "brasos-dist";
    inherit src;
    nativeBuildInputs = [ pkgs.bun ];
    dontFixup = true;
    buildPhase = ''
      cp -r ${nodeModules} node_modules && chmod -R u+w node_modules
      export HOME=$TMPDIR
      BRASOS_PACKAGES=hardened BRASOS_DIST=$out bun packages/host/src/main.ts --build-only
    '';
    installPhase = "true";
  };
in {
  options.brasos.hardened.enable = lib.mkEnableOption "the hardened package (locked-down OS image and default-deny server policy)";

  config = lib.mkIf cfg.enable {
    # R1/R2: nobody can log in or escalate on this image. Admin accounts (with MFA) are provisioned at deployment: still open.
    users.mutableUsers = false;
    users.allowNoPasswordLogin = true;
    users.users.brasos = {
      hashedPassword = "!";
      shell = "${pkgs.shadow}/bin/nologin";
    };
    security.sudo.enable = false;
    environment.defaultPackages = lib.mkForce [ ]; # no perl, rsync, strace, ... on a kiosk
    nix.settings.allowed-users = [ "root" ];

    # R5/R14: kernel and network baseline
    networking.firewall.enable = true;
    boot.kernel.sysctl = {
      "kernel.dmesg_restrict" = 1;
      "kernel.kptr_restrict" = 2;
      "kernel.unprivileged_bpf_disabled" = 1;
      "net.core.bpf_jit_harden" = 2;
      "kernel.yama.ptrace_scope" = 2;
    };

    # R12/R5: the server runs from the immutable store as a throwaway user, loopback only, nothing writable.
    systemd.services.brasos-shell = {
      wantedBy = [ "multi-user.target" ];
      environment = {
        BRASOS_PACKAGES = "hardened";
        BRASOS_PREBUILT = "1";
        BRASOS_DIST = "${dist}";
      };
      serviceConfig = {
        ExecStart = "${pkgs.bun}/bin/bun ${src}/packages/host/src/main.ts";
        Restart = "on-failure";
        RestartSec = 2;
        DynamicUser = true;
        NoNewPrivileges = true;
        CapabilityBoundingSet = "";
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectKernelLogs = true;
        ProtectControlGroups = true;
        ProtectClock = true;
        ProtectHostname = true;
        RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_UNIX" ];
        RestrictNamespaces = true;
        RestrictRealtime = true;
        RestrictSUIDSGID = true;
        LockPersonality = true;
        SystemCallArchitectures = "native";
        SystemCallFilter = [ "@system-service" ];
        IPAddressDeny = "any";
        IPAddressAllow = "localhost";
      };
    };

    # Kiosk browser: only the local shell, no devtools, no extensions, no sync or telemetry.
    programs.chromium = {
      enable = true;
      extraOpts = {
        URLBlocklist = [ "*" ];
        URLAllowlist = [ "localhost" ]; # also matches *.localhost, where apps live
        DeveloperToolsAvailability = 2;
        ExtensionInstallBlocklist = [ "*" ];
        IncognitoModeAvailability = 1;
        BrowserSignin = 0;
        SyncDisabled = true;
        PasswordManagerEnabled = false;
        MetricsReportingEnabled = false;
      };
    };
  };
}
