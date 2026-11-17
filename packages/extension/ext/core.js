// What the worker sends to BrasOS: checked here, and again by the host. Pure, so it is tested without a browser.
const URL_CHARS = /^https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/;

/** { manifestUrl } for a plain http(s) address of at most 2048 characters, or null */
export function installRequest(m) {
  const u = m && typeof m.manifestUrl === "string" ? m.manifestUrl : "";
  return u.length <= 2048 && URL_CHARS.test(u) ? { manifestUrl: u } : null;
}
