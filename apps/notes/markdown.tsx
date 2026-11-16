// A small markdown renderer that builds React elements (never innerHTML, so note text can't inject markup).
// Covers headings, paragraphs, bold/italic/code/links, lists, quotes, fenced code and rules; not tables or nested lists.
import type { ReactNode } from "react";

const safeHref = (u: string) => (/^(https?:|mailto:|#|\/)/i.test(u) ? u : undefined);

export function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*(.+?)\*\*|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const k = out.length;
    if (m[1] !== undefined) out.push(<code key={k}>{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={k}>{inline(m[2])}</strong>);
    else if (m[3] !== undefined) out.push(<em key={k}>{inline(m[3])}</em>);
    else out.push(<a key={k} href={safeHref(m[5])} target="_blank" rel="noreferrer noopener">{inline(m[4])}</a>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  const startsBlock = (l: string) => /^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+\.)\s|\s*([-*_]\s*){3,}$)/.test(l);
  while (i < lines.length) {
    const l = lines[i];
    const k = out.length;
    let m: RegExpMatchArray | null;
    if (!l.trim()) i++;
    else if (l.startsWith("```")) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) code.push(lines[i]);
      i++;
      out.push(<pre key={k}><code>{code.join("\n")}</code></pre>);
    } else if ((m = l.match(/^(#{1,6})\s+(.*)$/))) {
      const H = `h${m[1].length}` as "h1";
      out.push(<H key={k}>{inline(m[2])}</H>);
      i++;
    } else if (/^\s*([-*_]\s*){3,}$/.test(l)) (out.push(<hr key={k} />), i++);
    else if (l.startsWith(">")) {
      const q: string[] = [];
      for (; i < lines.length && lines[i].startsWith(">"); i++) q.push(lines[i].replace(/^>\s?/, ""));
      out.push(<blockquote key={k}><Markdown text={q.join("\n")} /></blockquote>);
    } else if ((m = l.match(/^\s*([-*+]|\d+\.)\s+/))) {
      const ordered = /\d/.test(m[1]);
      const items: string[] = [];
      for (; i < lines.length && (m = lines[i].match(/^\s*([-*+]|\d+\.)\s+(.*)$/)) && /\d/.test(m[1]) === ordered; i++) items.push(m[2]);
      const L = ordered ? "ol" : "ul";
      out.push(<L key={k}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</L>);
    } else {
      const p: string[] = [];
      for (; i < lines.length && lines[i].trim() && (p.length === 0 || !startsBlock(lines[i])); i++) p.push(lines[i]);
      out.push(<p key={k}>{inline(p.join(" "))}</p>);
    }
  }
  return <>{out}</>;
}

/** the blocks of a note: runs of lines separated by blank lines (blank lines inside a code fence don't split) */
export function splitBlocks(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fence = false;
  for (const l of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (l.startsWith("```")) fence = !fence;
    if (!fence && !l.trim()) cur.length && (out.push(cur.join("\n")), (cur = []));
    else cur.push(l);
  }
  if (cur.length) out.push(cur.join("\n"));
  return out.length ? out : [""];
}
