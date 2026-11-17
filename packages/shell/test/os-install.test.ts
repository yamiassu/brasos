import { expect, test } from "bun:test";
import { confirmed, describeDisk, diskProblem, friendly, identify, layoutFor, SAMPLE_DISKS, size } from "../src/os-install-model";

const [windows, empty, usb] = SAMPLE_DISKS;

test("the installer's own media and too-small disks can't be the target", () => {
  expect(diskProblem(windows)).toBe("");
  expect(diskProblem(empty)).toBe("");
  expect(diskProblem(usb)).toMatch(/installer/);
  expect(diskProblem({ ...empty, sizeGB: 8 })).toMatch(/20 GB/);
});

test("the layout fills the whole disk: boot, optional swap, then the system", () => {
  const withSwap = layoutFor(windows, { swapGB: 8, fs: "ext4" });
  expect(withSwap.map((p) => p.mount)).toEqual(["/boot", "swap", "/"]);
  expect(withSwap.reduce((a, p) => a + p.sizeGB, 0)).toBeCloseTo(windows.sizeGB, 1);
  const noSwap = layoutFor(empty, { swapGB: 0, fs: "btrfs" });
  expect(noSwap.map((p) => p.mount)).toEqual(["/boot", "/"]);
  expect(noSwap[1].fs).toBe("btrfs");
});

test("erasing needs the word typed", () => {
  expect(confirmed("")).toBe(false);
  expect(confirmed("yes")).toBe(false);
  expect(confirmed(" Erase ")).toBe(true);
});

test("sizes read like a person would say them", () => {
  expect(size(0.5)).toBe("0.5 GB");
  expect(size(512)).toBe("512 GB");
  expect(size(1000)).toBe("1 TB");
  expect(size(2500)).toBe("2.5 TB");
});

test("a drive is described by what it seems to hold, in plain words", () => {
  const p = (fs: string, kind = "", label = "", sizeGB = 100) => ({ fs, kind, label, sizeGB });
  expect(identify(p("ntfs", "Microsoft basic data"))).toBe("windows");
  expect(identify(p("BitLocker"))).toBe("windows");
  expect(identify(p("vfat", "EFI System", "", 0.5))).toBe("boot");
  expect(identify(p("ntfs", "Windows recovery environment", "", 0.5))).toBe("recovery");
  expect(identify(p("ext4"))).toBe("linux");
  expect(identify(p("swap"))).toBe("swap");
  expect(identify(p("apfs"))).toBe("mac");
  expect(identify(p("crypto_LUKS"))).toBe("encrypted");
  expect(identify(p("exfat", "", "PHOTOS"))).toBe("files");
  expect(identify(p("iso9660"))).toBe("installer");
  expect(identify(p(""))).toBe("unknown");
  expect(friendly(p("ntfs"))).toBe("Windows");
  expect(friendly(p("exfat", "", "PHOTOS"))).toBe("PHOTOS");
  expect(describeDisk(empty).summary).toMatch(/empty/);
  expect(describeDisk(windows).systems).toEqual(["Windows"]);
  expect(describeDisk(windows).summary).toMatch(/Windows/);
  expect(describeDisk({ ...windows, parts: [p("ext4"), p("ntfs")] }).systems).toEqual(["Windows", "Linux"]);
  expect(describeDisk({ ...windows, parts: [p("exfat", "", "X")] }).summary).toMatch(/no operating system recognised/);
});
