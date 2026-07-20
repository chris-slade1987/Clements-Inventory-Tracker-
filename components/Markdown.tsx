import React from "react";

// Minimal, SAFE Markdown renderer for the document center. It parses a trusted
// but large Markdown string into React elements — NEVER via dangerouslySetInnerHTML,
// so there is no raw-HTML injection surface. Supports what the handbook / manual
// use: headings (with slug ids for anchor links), paragraphs, bold, italics,
// inline code, links (only #, http(s), mailto), nested bullet lists, ordered
// lists, blockquotes (portal callouts), and horizontal rules.

// GitHub-ish slugger. A fresh instance per document keeps heading ids stable and
// unique in document order, so a table of contents built from the same body
// resolves to the same anchors.
export class Slugger {
  private seen: Record<string, number> = {};
  slug(text: string): string {
    const base = text
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9 -]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
    const n = this.seen[base] ?? 0;
    this.seen[base] = n + 1;
    return n === 0 ? base : `${base}-${n}`;
  }
}

export type Heading = { level: number; text: string; slug: string };

/** Extract headings (levels 2-4 by default) for a table-of-contents sidebar. */
export function extractHeadings(md: string, levels: number[] = [2]): Heading[] {
  const slugger = new Slugger();
  const out: Heading[] = [];
  for (const raw of md.split("\n")) {
    const m = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (!m) continue;
    const level = m[1].length;
    const text = m[2].trim();
    const slug = slugger.slug(text); // advance for every heading to match body ids
    if (levels.includes(level)) out.push({ level, text, slug });
  }
  return out;
}

// ---- inline ---------------------------------------------------------------

function safeHref(href: string): string | null {
  const h = href.trim();
  if (h.startsWith("#") || h.startsWith("/") || /^https?:\/\//i.test(h) || h.startsWith("mailto:")) return h;
  return null;
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  // Tokenize on: **bold**, *italic*, `code`, [label](href)
  const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (tok.startsWith("**")) {
      nodes.push(<strong key={key} className="font-semibold text-ink">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      nodes.push(<em key={key}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith("`")) {
      nodes.push(<code key={key} className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em] text-slate-800">{tok.slice(1, -1)}</code>);
    } else {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      const href = safeHref(lm[2]);
      if (href) {
        nodes.push(
          <a key={key} href={href} className="text-emerald-700 underline underline-offset-2 hover:text-emerald-800">{lm[1]}</a>,
        );
      } else {
        nodes.push(lm[1]);
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// ---- block ----------------------------------------------------------------

type ListNode = { ordered: boolean; items: { content: string; children: ListNode | null }[] };

function parseList(lines: string[], start: number): [ListNode, number] {
  // Parse a contiguous list starting at `start`. Nesting by 2-space indent.
  const itemRe = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
  const baseIndent = (itemRe.exec(lines[start])![1] ?? "").length;
  const ordered = /^\s*\d+\./.test(lines[start]);
  const node: ListNode = { ordered, items: [] };
  let i = start;
  while (i < lines.length) {
    const m = itemRe.exec(lines[i]);
    if (!m) break;
    const indent = m[1].length;
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      // nested list under the previous item
      const [child, next] = parseList(lines, i);
      if (node.items.length) node.items[node.items.length - 1].children = child;
      i = next;
      continue;
    }
    node.items.push({ content: m[3], children: null });
    i++;
  }
  return [node, i];
}

function renderList(node: ListNode, key: string): React.ReactNode {
  const cls = node.ordered
    ? "list-decimal space-y-1.5 pl-6 my-3 text-slate-700"
    : "list-disc space-y-1.5 pl-6 my-3 text-slate-700";
  const Tag = node.ordered ? "ol" : "ul";
  return (
    <Tag key={key} className={cls}>
      {node.items.map((it, idx) => (
        <li key={idx}>
          {renderInline(it.content, `${key}-${idx}`)}
          {it.children ? renderList(it.children, `${key}-${idx}-c`) : null}
        </li>
      ))}
    </Tag>
  );
}

export default function Markdown({ children, className = "" }: { children: string; className?: string }) {
  const slugger = new Slugger();
  const lines = children.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  const itemRe = /^(\s*)([-*]|\d+\.)\s+/;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      const id = slugger.slug(text);
      const inner = renderInline(text, `h${key}`);
      const common = "scroll-mt-24 font-semibold text-ink";
      if (level === 1) blocks.push(<h1 key={key++} id={id} className="scroll-mt-24 text-2xl md:text-3xl font-light tracking-tight text-ink mt-2 mb-3">{inner}</h1>);
      else if (level === 2) blocks.push(<h2 key={key++} id={id} className={`${common} text-xl mt-8 mb-2 border-b border-line pb-1`}>{inner}</h2>);
      else if (level === 3) blocks.push(<h3 key={key++} id={id} className={`${common} text-lg mt-5 mb-1.5`}>{inner}</h3>);
      else blocks.push(<h4 key={key++} id={id} className={`${common} text-base mt-4 mb-1`}>{inner}</h4>);
      i++;
      continue;
    }

    // horizontal rule
    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={key++} className="my-6 border-line" />);
      i++;
      continue;
    }

    // blockquote (portal callouts)
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      const paras = quote.join("\n").split(/\n{2,}/).filter((p) => p.trim());
      blocks.push(
        <blockquote key={key++} className="my-4 rounded-r-lg border-l-4 border-emerald-500 bg-emerald-50/60 px-4 py-3 text-sm text-slate-700">
          {paras.map((p, pi) => (
            <p key={pi} className={pi ? "mt-2" : ""}>{renderInline(p.replace(/\n/g, " "), `bq${key}-${pi}`)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    // list
    if (itemRe.test(line)) {
      const [node, next] = parseList(lines, i);
      blocks.push(renderList(node, `l${key++}`));
      i = next;
      continue;
    }

    // paragraph — gather consecutive non-blank, non-special lines
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === "" || /^(#{1,6})\s+/.test(l) || /^\s*>/.test(l) || itemRe.test(l) || /^---+$/.test(l.trim())) break;
      para.push(l.trim());
      i++;
    }
    blocks.push(<p key={key++} className="my-3 leading-relaxed text-slate-700">{renderInline(para.join(" "), `p${key}`)}</p>);
  }

  return <div className={className}>{blocks}</div>;
}
