// The BrasOS browser extension's identity. Its manifest carries a public key, which fixes the extension id (the private half was thrown
// away: the extension is loaded unpacked, so nothing is signed). The host recognises a request by this id in the Origin header, which a
// web page cannot set; a test checks the id still matches the key in manifest.json.
export const EXTENSION_ID = "iffhdmkhhopgncbfdamlljjggbenhdnl";
export const extensionOrigin = `chrome-extension://${EXTENSION_ID}`;
