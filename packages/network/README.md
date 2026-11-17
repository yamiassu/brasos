# network

The network from the taskbar: what is connected, the Wi-Fi networks in range, and joining one. It runs NetworkManager's `nmcli`.

- **Routes** (shell origin only): `GET /os/network` (`?rescan=1` asks for a fresh scan) returns `{ available, connected, active: { device, type, connection, ip, gateway, dns, ssid?, signal? }, hasWifi, wifiEnabled, wifi: [{ ssid, signal, secure, active }] }`; `POST /os/network/connect` `{ ssid, password? }`; `POST /os/network/disconnect` (the connected Wi-Fi network).
- **Capabilities**: `network.read` (the GET) and `network.control` (the POSTs, same-origin only). The shell holds both; no app, agent or installed PWA can, and the hardened package denies them (default deny).
- **The program** is named by the image in `BRASOS_NMCLI` (the devtools module sets it). A page never supplies a command. Without it every route answers 501 and the tray shows only the browser's online flag.
- **Input checks** (`src/nmcli.ts`): a network name is 1 to 32 bytes, has no control characters and never starts with `-`; a password is empty, 8 to 63 characters or 64 hex digits. The device that is disconnected comes from nmcli's own device list.
- **The password** is placed on nmcli's command line for the few seconds the connection takes (visible to processes of the same user: this is the dev image, which is not secure), and is never audited, logged or returned; an error from nmcli is shown with the password replaced.
- **Audit**: `network.connect`, `network.disconnect` (outcome only, never the network's name), plus the capability decisions.
- The installer's network step (`apps/installer`) uses the same parsers.
