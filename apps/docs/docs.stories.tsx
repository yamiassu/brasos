// The Docs app in Storybook: the guides come from the polyfill set in .storybook/preview.tsx (crudely rendered).
import { Docs } from "./main";

export default { title: "Apps/Docs", parameters: { layout: "fullscreen" } };
export const Default = () => <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}><Docs /></div>;
