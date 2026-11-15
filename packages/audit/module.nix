# R4: the shell's audit lines (stdout of brasos-shell) land in the journal, which the service can't rewrite.
# Persistent, and never rate-limited: dropped audit lines would be a silent gap. Retention is a policy decision
# (open question): size/time limits are deliberately unset. Clock sync is NixOS's default systemd-timesyncd.
{ ... }:
{
  services.journald.settings.Journal = {
    Storage = "persistent";
    RateLimitIntervalSec = 0;
    RateLimitBurst = 0;
  };
}
