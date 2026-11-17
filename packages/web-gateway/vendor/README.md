# vendored: Eruda

`eruda.js` is [Eruda](https://github.com/liriliri/eruda) **3.4.3** (MIT, by liriliri), a devtools panel (elements, console, network,
resources, info) that runs inside a page. BrasOS loads it into a website open in the Browser app when you press F12 there, because
a web page cannot open Chromium's own devtools for itself.

- Source: `https://registry.npmjs.org/eruda/-/eruda-3.4.3.tgz` (542,622 bytes), file `package/eruda.js`.
- Tarball integrity (from the registry, checked): `sha512-J2TsF4dXSspOXev5bJ6mljv0dRrxj21wklrDzbvPmYaEmVoC+2psylyRi70nUPFh1mTQfIBsSusUtAMZtUN+/w==`
- `eruda.js` sha256: `332f95b14b1dc53cdbe6042e0ea95ac6025ac691c285d51b647c64360fe939e2`
- Reviewed for: network calls (none; the only URLs are links in its About panel).
- Served by the host at `/__brasos/devtools.js` to website origins only, and only when no package is enabled (never in the hardened package).
- To update: download the new tarball, check its integrity against the registry, replace `eruda.js`, and update this file.
