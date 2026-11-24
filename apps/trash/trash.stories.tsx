// Trash in Storybook, on the SDK's in-memory fs polyfill.
import { useEffect, useState } from "react";
import { os } from "@brasos/sdk";
import { Trash } from "./main";

export default { title: "Apps/Trash", parameters: { layout: "fullscreen" } };
export const Default = () => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      await os.fs.mkdir("/Documents/Old project").catch(() => {});
      await os.fs.write("/Documents/Old project/plan.md", "# Plan");
      await os.fs.write("/Desktop/notes.txt", "remember the milk");
      await os.fs.write("/Downloads/photo.png", "not really a png");
      for (const p of ["/Documents/Old project", "/Desktop/notes.txt", "/Downloads/photo.png"]) await os.fs.remove(p).catch(() => {});
      setReady(true);
    })();
  }, []);
  return <div style={{ height: "100vh" }}>{ready && <Trash />}</div>;
};
export const Empty = () => <div style={{ height: "100vh" }}><Trash /></div>;
