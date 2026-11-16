// Notes in Storybook, on the SDK's in-memory fs polyfill.
import { useEffect, useState } from "react";
import { os } from "@brasos/sdk";
import { Notes } from "./main";

export default { title: "Apps/Notes", parameters: { layout: "fullscreen" } };
export const Default = () => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      await os.fs.mkdir("/Notes").catch(() => {});
      await os.fs.mkdir("/Notes/Ideas").catch(() => {});
      await os.fs.write("/Notes/welcome.md", "# Welcome\n\nSome **bold**, *italic*, `code` and a [link](https://example.com).\n\n- one\n- two\n\n> a quote");
      setReady(true);
    })();
  }, []);
  return <div style={{ height: "100vh" }}>{ready && <Notes />}</div>;
};
