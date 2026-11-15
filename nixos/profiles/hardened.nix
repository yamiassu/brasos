# HARDENED PROFILE (work in progress; see docs/compliance/ppsi-mapping.md for what is and isn't done).
# No credentials, no sudo, no terminal, no runtime fetching, immutable shell, sandboxed service, locked-down browser.
{ pkgs, lib, shellSrc, ... }:
let
  # R7: dependencies are fetched once at BUILD time and pinned by hash, never at boot.
  # When shell/bun.lock changes: set outputHash to pkgs.lib.fakeHash, build, and paste the hash Nix reports.
  nodeModules = pkgs.stdenvNoCC.mkDerivation {
    name = "brasos-shell-node_modules";
    src = shellSrc;
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
    name = "brasos-shell-dist";
    src = shellSrc;
    nativeBuildInputs = [ pkgs.bun ];
    dontFixup = true;
    buildPhase = ''
      cp -r ${nodeModules} node_modules && chmod -R u+w node_modules
      export HOME=$TMPDIR
      BRASOS_PROFILE=hardened BRASOS_DIST=$out bun server.ts --build-only
    '';
    installPhase = "true";
  };
in {
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

  # R12/R5: the shell server runs from the immutable store as a throwaway user, loopback only, nothing writable.
  systemd.services.brasos-shell = {
    wantedBy = [ "multi-user.target" ];
    environment = {
      BRASOS_PROFILE = "hardened";
      BRASOS_PREBUILT = "1";
      BRASOS_DIST = "${dist}";
    };
    serviceConfig = {
      ExecStart = "${pkgs.bun}/bin/bun ${shellSrc}/server.ts";
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
}
