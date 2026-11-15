// The install prompt in Storybook: what a PWA asking for things looks like, with and without a reason.
import { InstallPrompt, type Inspection } from "./install";

export default { title: "Shell/Install prompt", parameters: { layout: "fullscreen" } };
const base: Inspection = { name: "Notes", origin: "https://notes.example.com", start_url: "https://notes.example.com/app/", frameless: false, requested: [] };
const noop = () => {};
export const AsksNothing = () => <InstallPrompt info={base} onInstall={noop} onCancel={noop} />;
export const AsksForSeveral = () => (
  <InstallPrompt
    info={{
      ...base,
      frameless: true,
      requested: [
        { id: "db.own", label: "Store its own data in the BrasOS database", risk: "low", reason: "Keep your notes", grantable: true },
        { id: "fs.read", label: "Read your files", risk: "medium", reason: "Import text files", grantable: true },
        { id: "fs.write", label: "Create, change and delete your files", risk: "high", reason: "", grantable: true },
        { id: "system.restart", label: "Restart the BrasOS interface", risk: "high", reason: "", grantable: false },
      ],
    }}
    onInstall={(g) => console.log("grant", g)}
    onCancel={noop}
  />
);
export const Failed = () => <InstallPrompt info={base} error="manifest fetch failed: 404" onInstall={noop} onCancel={noop} />;
