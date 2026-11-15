import { createRoot } from "react-dom/client";
import "@brasos/ui/ui.css";
import "./shell.css";
import "./user.css"; // last on purpose: user overrides win
import { Shell } from "./shell";

createRoot(document.getElementById("root")!).render(<Shell />);
