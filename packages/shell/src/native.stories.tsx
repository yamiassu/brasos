// Native app windows drawn by the shell: the frame is real, the content area is transparent (the compositor draws the app there).
import { NativeWindows } from "./native";

export default { title: "Shell/Native windows", parameters: { layout: "fullscreen" } };
export const TwoWindows = () => (
  <div style={{ position: "absolute", inset: 0, background: "var(--bg)" }}>
    <NativeWindows
      natives={[
        { id: 1, title: "Steam", app: "steam", focused: false, w: 520, h: 360, ssd: true },
        { id: 2, title: "brasos@brasos: /", app: "foot", focused: true, w: 480, h: 280, ssd: true },
      ]}
    />
  </div>
);
