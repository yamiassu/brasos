import type { Bench } from "../../tools/bench-types";
import { parseDevices, parseShow, parseWifi } from "./src/nmcli";

// Turning nmcli's output into what the network panel shows (the part that runs on every open and every few seconds while it is open).
const bench: Bench = async () => {
  const wifi = Array.from({ length: 60 }, (_, i) => `${i === 3 ? "yes" : "no"}:Net${i % 30}:${(i * 7) % 100}:WPA2`).join("\n");
  const devs = "lo:loopback:unmanaged:\nwlan0:wifi:connected:Home\neth0:ethernet:unavailable:";
  const show = "IP4.ADDRESS[1]:192.168.0.5/24\nIP4.GATEWAY:192.168.0.1\nIP4.DNS[1]:1.1.1.1\nIP4.DNS[2]:8.8.8.8";
  const samples: number[] = [];
  for (let i = 0; i < 300; i++) {
    const t = performance.now();
    parseWifi(wifi);
    parseDevices(devs);
    parseShow(show);
    samples.push(performance.now() - t);
  }
  return [{ name: "network.parse_panel", unit: "ms", samples }];
};
export default bench;
