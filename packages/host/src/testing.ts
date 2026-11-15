// Test helper shared by every slice's tests: a real host on a free port, a throwaway dist and state dir, audit lines captured.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost, type HostOptions } from "./host";

const ROOT = join(import.meta.dir, "../../..");

export async function testHost(o: Partial<HostOptions> = {}) {
  const dist = mkdtempSync(join(tmpdir(), "brasos-dist-"));
  const stateDir = mkdtempSync(join(tmpdir(), "brasos-state-"));
  const lines: string[] = [];
  const h = await startHost({ root: ROOT, dist, stateDir, audit: [(l) => lines.push(l)], ...o });
  const origin = (host: string) => `http://${host}:${h.port}`;
  return {
    port: h.port,
    stateDir,
    lines,
    origin,
    /** request `path` on the origin named by `host` ("localhost" = shell, "<id>.localhost" = app) */
    at: (host: string, path = "/", init?: RequestInit) => fetch(origin(host) + path, init),
    events: () => lines.map((l) => JSON.parse(l.slice(6)) as { event: string; outcome: string; actor: any; detail: any }),
    stop() {
      h.stop();
      rmSync(dist, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    },
  };
}

export type TestHost = Awaited<ReturnType<typeof testHost>>;
