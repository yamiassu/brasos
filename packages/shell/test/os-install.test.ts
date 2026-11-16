import { expect, test } from "bun:test";
import { confirmed, diskProblem, layoutFor, SAMPLE_DISKS, size } from "../src/os-install-model";

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
