// Entry of the standalone bundle served at /__brasos/sdk.js (and injected into websites by the gateway):
// exposes window.brasos and starts the site reporter. Apps import "@brasos/sdk" instead.
import { os } from "./index";
import { installSiteReporter } from "./site";

(globalThis as any).brasos = os;
installSiteReporter(globalThis);
