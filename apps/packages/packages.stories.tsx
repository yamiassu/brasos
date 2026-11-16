// Packages in Storybook: it runs on a sample catalog (see data.ts), so nothing here needs a BrasOS host.
import { Packages } from "./main";

export default { title: "Apps/Packages", parameters: { layout: "fullscreen" } };
export const Default = () => <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}><Packages /></div>;
