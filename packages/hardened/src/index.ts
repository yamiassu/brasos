// The hardened package (server side). Enable it with BRASOS_PACKAGES=hardened; the NixOS side is module.nix
// (brasos.hardened.enable). It only ever restricts: default deny for apps and for capabilities.
import type { Policy } from "@brasos/host/types";

/** the only capabilities left on: no terminal, no web gateway, no installing apps, no files, no agents. Setup and login stay: a government machine still needs its first-boot account. */
const SAFE_CAPABILITIES = new Set(["apps.read", "docs.read", "setup.write", "setup.login"]);

export const hardened: Policy = {
  name: "hardened",
  allowApp: (m) => m.brasos?.hardened === true,
  allowCapability: (cap) => SAFE_CAPABILITIES.has(cap),
};
