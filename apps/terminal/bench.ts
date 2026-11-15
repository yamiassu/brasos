import type { Bench } from "../../tools/bench-types";

// PTY round trip: send one character, wait for it to be echoed back.
const bench: Bench = async ({ host, sleep }) => {
  const origin = `http://terminal.localhost:${host.port}`;
  const ws = new WebSocket(`ws://terminal.localhost:${host.port}/pty`, { headers: { origin } } as any);
  let waiting: ((s: string) => void) | undefined;
  ws.onmessage = (e) => waiting?.(Buffer.from(e.data as ArrayBuffer).toString());
  await new Promise((r) => (ws.onopen = r));
  await sleep(1500); // let the shell print its prompt
  const samples: number[] = [];
  for (let i = 0; i < 50; i++) {
    const t = performance.now();
    const got = new Promise<void>((res) => (waiting = (s) => s.includes("x") && res()));
    ws.send(JSON.stringify({ t: "i", d: "x" }));
    await got;
    samples.push(performance.now() - t);
    await sleep(30);
  }
  ws.close();
  return [{ name: "terminal.keystroke_echo", unit: "ms", samples }];
};
export default bench;
