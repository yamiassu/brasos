// Settings in Storybook: it runs on sample data (see data.ts), so nothing here needs a BrasOS host.
import { Settings } from "./main";

export default { title: "Apps/Settings", parameters: { layout: "fullscreen" } };
export const Default = () => <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}><Settings /></div>;
