import type { Bench } from "../../tools/bench-types";
import { groupProcs, readMachine } from "./server";

// the cost of one Task Manager refresh (read /proc and group it): it runs every 1.5 s while the app is open
const bench: Bench = async () => {
  {
    const read: number[] = [], group: number[] = [];
    let m = readMachine();
    for (let i = 0; i < 100; i++) {
      let t = performance.now();
      m = readMachine();
      read.push(performance.now() - t);
      t = performance.now();
      groupProcs(m, new Map(m.procs.map((p) => [p.pid, p.ticks])), 1000, 0);
      group.push(performance.now() - t);
    }
    return [{ name: "task-manager.read_proc", unit: "ms", samples: read }, { name: "task-manager.group", unit: "ms", samples: group }];
  }
};
export default bench;
