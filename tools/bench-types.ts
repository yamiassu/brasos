// Contract between the benchmark runner (tools/bench.ts) and the slices: each slice exports a default Bench from bench.ts.
export type Result = { name: string; unit: string; samples: number[] };
export type BenchCtx = {
  host: { port: number; stateDir?: string };
  repeat: (n: number, fn: () => Promise<unknown>) => Promise<number[]>;
  sleep: (ms: number) => Promise<void>;
};
export type Bench = (ctx: BenchCtx) => Promise<Result[]>;
