// The Files app's server side: the drives of this computer (`GET /drives`, capability `drives.read`), read with `lsblk` where the
// host runs on Linux. It only lists them: the files API stays confined to the home folder (contract 10), so a drive's contents are
// never reachable from here. The program is named by the image (`BRASOS_DRIVES_LSBLK`); a page supplies nothing. Where lsblk is
// missing (Windows, macOS) the answer is 501, never an invented list.
import type { AuditFn, Slice } from "@brasos/host/types";
import { json } from "@brasos/host/types";
import { parseDrives } from "./drives";

const DEFAULT = "lsblk -J -b -o NAME,PATH,SIZE,MODEL,TYPE,RM,ROTA,FSTYPE,LABEL,MOUNTPOINTS,FSUSED";

export const createSlice = (_: { audit: AuditFn }): Slice => ({
  name: "files-drives",
  async handle(req, ctx) {
    if (ctx.target.kind !== "app" || ctx.target.id !== "files" || ctx.url.pathname !== "/drives" || req.method !== "GET") return;
    const g = ctx.gate("drives.read"); // a same-origin GET carries no Origin: the gate identifies it by Sec-Fetch-Site; allow and deny are audited by the gate
    if (!g.ok) return g.res;
    try {
      const argv = (process.env.BRASOS_DRIVES_LSBLK ?? DEFAULT).split(" ").filter(Boolean);
      const p = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
      const out = await new Response(p.stdout).text();
      await p.exited;
      if (p.exitCode !== 0) throw new Error("lsblk failed");
      return json({ drives: parseDrives(out) });
    } catch {
      return json({ error: "this system cannot list its drives (lsblk is not available)" }, 501);
    }
  },
});
