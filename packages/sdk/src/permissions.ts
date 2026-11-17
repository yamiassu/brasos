// What each permission means, in words a person can read: shown when an app is installed and in its details. The host enforces
// the capabilities (packages/host); this catalog is only the description. Keep a row for every permission an app can hold.
export type Risk = "low" | "medium" | "high";
export const PERMISSIONS: Record<string, { label: string; risk: Risk }> = {
  "fs.read": { label: "Read your files", risk: "medium" },
  "fs.write": { label: "Create, change and delete your files", risk: "high" },
  "docs.read": { label: "Read the BrasOS guides", risk: "low" },
  "db.own": { label: "Store its own data in the BrasOS database", risk: "low" },
  "db.shared": { label: "Read and write data shared with other apps, and see their changes", risk: "medium" },
  "window.control": { label: "Move, resize, retitle and close its own window", risk: "low" },
  "window.frameless": { label: "Draw its own window frame (no title bar from BrasOS)", risk: "medium" },
  "apps.open": { label: "Open other apps", risk: "low" },
  "apps.read": { label: "See which apps are installed", risk: "low" },
  "web.open": { label: "Load websites through BrasOS", risk: "medium" },
  "apps.install": { label: "Ask to install apps (you are always asked)", risk: "medium" },
  "apps.uninstall": { label: "Remove apps", risk: "high" },
  "system.power": { label: "Shut down or restart the computer", risk: "high" },
  "system.restart": { label: "Restart the BrasOS interface", risk: "high" },
  "system.update": { label: "Update, roll back and rebuild the whole system", risk: "high" },
  "installer.run": { label: "Erase a disk and install BrasOS on it", risk: "high" },
  "settings.read": { label: "See this computer's hardware, drivers and settings", risk: "low" },
  "accounts.manage": { label: "Add, remove and change the accounts on the lock screen", risk: "high" },
  "settings.write": { label: "Change the volume and airplane mode", risk: "medium" },
  "packages.read": { label: "See the software installed on this system", risk: "low" },
  "packages.install": { label: "Install and remove apps from the app store (Flathub)", risk: "high" },
  "drives.read": { label: "See the drives in this computer and their free space", risk: "low" },
  "processes.read": { label: "See what is running and how much it uses", risk: "low" },
  "processes.end": { label: "End running programs", risk: "high" },
  pty: { label: "Run commands as you (a full terminal)", risk: "high" },
};

export const describePermission = (id: string) => PERMISSIONS[id] ?? { label: id, risk: "high" as Risk };
