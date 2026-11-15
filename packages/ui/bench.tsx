import { renderToStaticMarkup } from "react-dom/server";
import type { Bench } from "../../tools/bench-types";
import { IconTile, List } from "./src";

// Cost of rendering a big list and a desktop-sized grid (server render: no DOM, so this is the React + component cost).
const bench: Bench = async ({ repeat }) => {
  const items = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), name: `file-${i}.txt` }));
  const list = () => renderToStaticMarkup(<List items={items} selected={items[500]} onSelect={() => {}} render={(i) => i.name} getKey={(i) => i.id} label="Files" />);
  const grid = () => renderToStaticMarkup(<div>{items.slice(0, 200).map((i) => <IconTile key={i.id} icon="📝" label={i.name} />)}</div>);
  list();
  return [
    { name: "ui.render_list_1000", unit: "ms", samples: await repeat(30, async () => list()) },
    { name: "ui.render_tiles_200", unit: "ms", samples: await repeat(30, async () => grid()) },
  ];
};
export default bench;
