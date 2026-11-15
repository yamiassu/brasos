// The installer and the lock screen in Storybook: they only hand their result to a callback, so no host is needed.
import { Login, Setup } from "./setup";

export default { title: "Shell/First boot", parameters: { layout: "fullscreen" } };
export const Installer = () => <Setup onSubmit={async (f) => void console.log("setup", { ...f, password: "(hidden)" })} />;
export const LockScreen = () => <Login display="Maria Souza" onSubmit={async (pw) => (pw === "correct horse 42" ? undefined : "wrong username or password")} />;
