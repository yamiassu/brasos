// The Files app in Storybook: it runs on the SDK's in-memory fs polyfill, no BrasOS needed.
import { useEffect, useState } from "react";
import { os } from "@brasos/sdk";
import { Files } from "./main";

const seed = async () => {
  if ((await os.fs.list("/Documents")).length) return;
  await os.fs.write("/Desktop/hello.txt", "Hello from the polyfill.");
  await os.fs.write("/Documents/ideas.md", "# Ideas\n\n- a calmer desktop\n- rare, vivid color");
  await os.fs.mkdir("/Documents/Projects");
  await os.fs.write("/Documents/Projects/readme.md", "A project.");
};

export default { title: "Apps/Files", parameters: { layout: "fullscreen" } };
export const Default = () => {
  const [ready, setReady] = useState(false);
  useEffect(() => void seed().then(() => setReady(true)), []);
  return <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>{ready && <Files />}</div>;
};
