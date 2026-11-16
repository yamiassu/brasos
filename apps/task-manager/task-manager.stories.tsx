// The Task Manager in Storybook: it runs on sample data (see data.ts), so nothing here needs a BrasOS host.
import { TaskManager } from "./main";

export default { title: "Apps/Task Manager", parameters: { layout: "fullscreen" } };
export const Default = () => <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}><TaskManager /></div>;
