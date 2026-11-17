# Test fixture for scripts/iso/test.sh, never shipped: the ISO installs itself onto /dev/vda at boot and reports on the serial port.
{ pkgs, ... }: {
  boot.kernelParams = [ "console=ttyS0" ];
  # the serial login would hang up the port the install writes to (agetty vhangup), killing the install mid-copy
  systemd.services."serial-getty@ttyS0".enable = false;
  systemd.services.brasos-autoinstall = {
    wantedBy = [ "multi-user.target" ];
    path = [ "/run/current-system/sw" ];
    script = "echo ERASE | brasos-install --swap 1 /dev/vda > /dev/ttyS0 2>&1";
  };
}
