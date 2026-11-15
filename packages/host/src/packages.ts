// Enable-able packages. BRASOS_PACKAGES=name,name selects them; an unknown name is an error, never ignored,
// because a typo must not silently leave a security package off.
import { hardened } from "@brasos/hardened";
import type { Policy } from "./types";

const available: Record<string, Policy> = { hardened };

export function resolvePolicies(names: string[]): Policy[] {
  return names.map((n) => {
    const p = available[n];
    if (!p) throw new Error(`unknown package "${n}" (available: ${Object.keys(available).join(", ")})`);
    return p;
  });
}
