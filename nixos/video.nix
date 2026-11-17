# Video drivers for real PCs, shared by the install image and the installed system, so the screen runs at its native resolution.
# The open-source KMS drivers (Intel, AMD, the common VMs) are in the system's module set and udev loads the right one when the GPU
# appears, before the compositor starts; its firmware is in the system, not in the early boot image (putting every GPU's firmware
# there made that image 1.4 GB, bigger than the boot partition).
# NVIDIA is the exception: nouveau cannot light a Pascal card (GTX 10xx) reliably (the monitor loses its signal when the driver
# takes over), so the proprietary driver is bundled (unfree; the legacy 580 branch is the newest that still supports Pascal) and
# nouveau is blacklisted. On a PC without an NVIDIA GPU the module simply never loads. Not for Blackwell (RTX 50): those need the
# open kernel modules of a newer branch.
{ config, pkgs, ... }: {
  hardware.enableRedistributableFirmware = true; # amdgpu, i915 need their firmware to light the screen at all
  nixpkgs.config.allowUnfree = true;
  services.xserver.videoDrivers = [ "nvidia" ]; # also what loads the kernel module and blacklists nouveau without X
  hardware.nvidia = {
    package = config.boot.kernelPackages.nvidiaPackages.legacy_580;
    open = false;
    modesetting.enable = true; # nvidia-drm.modeset=1: the compositor needs KMS
  };
  # Without X nothing asks for the DRM half of the driver, so no /dev/dri card appears and the compositor has no screen: load it when
  # an NVIDIA display controller shows up (and only then, so other PCs see no failed module).
  services.udev.extraRules = ''
    ACTION=="add", SUBSYSTEM=="pci", ATTR{vendor}=="0x10de", ATTR{class}=="0x03*", RUN+="${pkgs.kmod}/bin/modprobe nvidia_drm"
  '';
  hardware.graphics = {
    enable = true; # Mesa: OpenGL and Vulkan for the open drivers
    extraPackages = with pkgs; [ intel-media-driver libva-vdpau-driver ]; # hardware video decoding on Intel and AMD
  };
}
