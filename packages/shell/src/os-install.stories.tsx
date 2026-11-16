// The OS installer in Storybook, with a simulated install (no drive is touched). Pick the empty WD drive or the Samsung one;
// the USB stick is the installer's own media and can't be chosen.
import { OsInstall, PHASES } from "./os-install";
import { SAMPLE_DISKS } from "./os-install-model";

const simulate = (_d: unknown, _p: unknown, report: (phase: number, percent: number) => void) =>
  new Promise<void>((resolve) => {
    let tick = 0;
    const t = setInterval(() => {
      tick++;
      const percent = Math.min(100, tick * 4);
      report(Math.min(PHASES.length - 1, Math.floor(percent / (100 / PHASES.length))), percent);
      if (percent >= 100) (clearInterval(t), resolve());
    }, 200);
  });

export default { title: "Shell/OS installer", parameters: { layout: "fullscreen" } };
export const Installer = () => <OsInstall disks={SAMPLE_DISKS} run={simulate} onRestart={() => console.log("restart")} />;
export const Failing = () => <OsInstall disks={SAMPLE_DISKS} run={async () => "The bootloader could not be installed (simulated)."} onRestart={() => {}} />;
