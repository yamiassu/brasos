// Religare in Storybook: favorites, history and settings run on the SDK's in-memory database polyfill; pages are loaded
// directly (there is no gateway here), so many sites will refuse to be framed. Try the address bar, tabs, favorites and history.
import { useEffect, useState } from "react";
import { os } from "@brasos/sdk";
import { Religare } from "./main";

const seed = async () => {
  const favs = os.db.collection("favorites");
  const hist = os.db.collection("history");
  if ((await favs.list()).length) return;
  const now = Date.now();
  await favs.put({ url: "https://en.wikipedia.org/", title: "Wikipedia", at: now - 5 }, "b1");
  await favs.put({ url: "https://news.ycombinator.com/", title: "Hacker News", at: now - 4 }, "b2");
  await favs.put({ url: "https://developer.mozilla.org/", title: "MDN Web Docs", at: now - 3 }, "b3");
  for (const [i, [url, title]] of ([["https://example.com/", "Example Domain"], ["https://en.wikipedia.org/wiki/Brazil", "Brazil - Wikipedia"], ["https://www.iana.org/", "IANA"]] as const).entries())
    await hist.put({ url, title, at: now - i * 3_600_000 * 7 });
};

export default { title: "Apps/Religare", parameters: { layout: "fullscreen" } };
export const Default = () => {
  const [ready, setReady] = useState(false);
  useEffect(() => void seed().then(() => setReady(true)), []);
  return <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>{ready && <Religare />}</div>;
};
