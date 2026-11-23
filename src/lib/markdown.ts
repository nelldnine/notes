// Notes are stored as Markdown (the GitHub-comment subset) and edited as rich
// text. toHtml renders Markdown into the editor's HTML; toMarkdown reads any
// DOM (the editor, or pasted HTML) back into Markdown.
//
// The editor works line by line, like the plain-text version did: every line
// of Markdown is one block (paragraph, heading, quote line, list item), and a
// blank line is an empty paragraph, so notes round-trip line for line.
//
// Inline code is <font face="monospace"> rather than <code>, because that is
// what the browser's own fontName command produces: it then toggles with the
// caret like bold does and stays on the browser's undo stack.

export const CODE_FONT = 'monospace';

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** http(s), mailto and tel links only; a bare "example.com/x" gets https://. */
export function safeUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url || /\s/.test(url)) return null;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(url)) return url;
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) return null;
  if (/^[\w-]+(\.[\w-]+)+([/?#:]|$)/.test(url)) return `https://${url}`;
  return null;
}

/* ---------- Markdown → HTML ---------- */

const PUNCT = /[!-/:-@[-`{-~]/;
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const AUTOLINK = /^https?:\/\/[^\s<>]*[^\s<>.,:;"'!?)\]]/i;

type Delim = '**' | '__' | '~~' | '*' | '_';
const DELIMS: Delim[] = ['**', '__', '~~', '*', '_'];
const TAG: Record<Delim, string> = { '**': 'b', __: 'b', '~~': 's', '*': 'i', _: 'i' };

function opens(s: string, i: number, d: Delim) {
  if (isSpace(s[i + d.length])) return false;
  return d[0] !== '_' || !isWord(s[i - 1]);
}
function closes(s: string, i: number, d: Delim) {
  if (isSpace(s[i - 1])) return false;
  return d[0] !== '_' || !isWord(s[i + d.length]);
}

class InlineParser {
  private failed = new Set<string>();
  private s: string;
  constructor(s: string) { this.s = s; }

  /** Parses from `start` until `closer` (or the end when closer is null). */
  span(start: number, closer: Delim | null, inLink: boolean): { html: string; end: number } | null {
    const s = this.s;
    let html = '';
    let i = start;
    while (i < s.length) {
      if (closer && s.startsWith(closer, i) && i > start && closes(s, i, closer)) return { html, end: i + closer.length };
      const c = s[i];

      if (c === '\\' && PUNCT.test(s[i + 1] ?? '')) { html += esc(s[i + 1]); i += 2; continue; }

      if (c === '`') {
        const run = /^`+/.exec(s.slice(i))![0];
        const close = new RegExp(`(?<!\`)${run}(?!\`)`, 'g');
        close.lastIndex = i + run.length;
        const m = close.exec(s);
        if (m) {
          let code = s.slice(i + run.length, m.index);
          if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
          html += `<font face="${CODE_FONT}">${esc(code)}</font>`;
          i = m.index + run.length;
          continue;
        }
        html += run;
        i += run.length;
        continue;
      }

      if (c === '[' && !inLink) {
        const link = this.link(i);
        if (link) { html += link.html; i = link.end; continue; }
      }

      if (!inLink && (c === 'h' || c === 'H') && !isWord(s[i - 1])) {
        const m = AUTOLINK.exec(s.slice(i));
        if (m) { html += `<a href="${esc(m[0])}">${esc(m[0])}</a>`; i += m[0].length; continue; }
      }

      const d = DELIMS.find((x) => s.startsWith(x, i));
      if (d) {
        const key = `${d}@${i}`;
        if (opens(s, i, d) && !this.failed.has(key)) {
          const inner = this.span(i + d.length, d, inLink);
          if (inner && inner.html) {
            html += `<${TAG[d]}>${inner.html}</${TAG[d]}>`;
            i = inner.end;
            continue;
          }
          this.failed.add(key);
        }
        html += d;
        i += d.length;
        continue;
      }

      html += esc(c);
      i++;
    }
    return closer ? null : { html, end: i };
  }

  /** [text](url) starting at `i`, or null. */
  private link(i: number): { html: string; end: number } | null {
    const s = this.s;
    let depth = 0;
    let j = i;
    for (; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s[j] === '[') depth++;
      else if (s[j] === ']' && --depth === 0) break;
    }
    if (j >= s.length || s[j + 1] !== '(') return null;
    let k = j + 2;
    let parens = 0;
    for (; k < s.length; k++) {
      if (s[k] === '(') parens++;
      else if (s[k] === ')') { if (parens === 0) break; parens--; }
      else if (/\s/.test(s[k])) return null;
    }
    if (k >= s.length) return null;
    const href = safeUrl(s.slice(j + 2, k));
    if (!href) return null;
    const text = new InlineParser(s.slice(i + 1, j)).span(0, null, true)!.html;
    return { html: `<a href="${esc(href)}">${text || esc(href)}</a>`, end: k + 1 };
  }
}

const inlineHtml = (s: string) => new InlineParser(s).span(0, null, false)!.html;

const HEADING_RE = /^(#{1,6})(?:[ \t]+(.*?)(?:[ \t]+#+)?)?[ \t]*$/;
const QUOTE_RE = /^ {0,3}> ?(.*)$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HR_RE = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const ITEM_RE = /^(\s*)(?:([-*+])|(\d{1,9})[.)])(?: |$)(?:\[([ xX])\](?: |$))?(.*)$/;

interface OpenList { indent: number; kind: string; tag: 'ul' | 'ol'; blockInLi: boolean }

export function toHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let out = '';
  const lists: OpenList[] = [];
  const closeList = () => { out += `</li></${lists.pop()!.tag}>`; };
  const closeLists = (above = -1) => { while (lists.length && lists.at(-1)!.indent > above) closeList(); };

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];

    const fence = FENCE_RE.exec(line);
    if (fence) {
      closeLists();
      const body: string[] = [];
      const end = new RegExp(`^ {0,3}${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);
      while (++n < lines.length && !end.test(lines[n])) body.push(lines[n]);
      let html = body.map(esc).join('<br>');
      if (!body.length || body.at(-1) === '') html += '<br>';
      out += `<pre${fence[2] ? ` data-lang="${esc(fence[2])}"` : ''}>${html}</pre>`;
      continue;
    }

    if (HR_RE.test(line)) { closeLists(); out += '<hr>'; continue; }

    const item = ITEM_RE.exec(line);
    if (item) {
      const indent = item[1].replace(/\t/g, '    ').length;
      const ordered = item[3] !== undefined;
      const task = !ordered && item[4] !== undefined;
      const kind = ordered ? 'ol' : task ? 'task' : 'ul';
      closeLists(indent);
      const top = lists.at(-1);
      if (top && top.indent === indent && top.kind !== kind) closeList();
      const cur = lists.at(-1);
      if (cur && cur.indent === indent) {
        out += '</li>';
        cur.blockInLi = false;
      } else {
        const tag = ordered ? 'ol' : 'ul';
        const start = ordered && Number(item[3]) !== 1 ? ` start="${Number(item[3])}"` : '';
        out += `<${tag}${task ? ' class="tasks"' : ''}${start}>`;
        if (cur) cur.blockInLi = true;
        lists.push({ indent, kind, tag, blockInLi: false });
      }
      const checked = task ? ` data-checked="${item[4] !== ' '}"` : '';
      out += `<li${checked}>${inlineHtml(item[5]) || '<br>'}`;
      continue;
    }

    // An indented line straight after a list item continues it.
    const cont = /^(\s+)(\S.*)$/.exec(line);
    if (cont && lists.length && cont[1].length > lists[0].indent) {
      const indent = cont[1].replace(/\t/g, '    ').length;
      while (lists.length > 1 && lists.at(-1)!.indent >= indent) closeList();
      const top = lists.at(-1)!;
      out += top.blockInLi ? `<div>${inlineHtml(cont[2])}</div>` : `<br>${inlineHtml(cont[2])}`;
      continue;
    }

    closeLists();

    const h = HEADING_RE.exec(line);
    if (h) { out += `<h${h[1].length}>${inlineHtml(h[2] ?? '') || '<br>'}</h${h[1].length}>`; continue; }

    const q = QUOTE_RE.exec(line);
    if (q) { out += `<blockquote>${inlineHtml(q[1]) || '<br>'}</blockquote>`; continue; }

    out += `<p>${inlineHtml(line) || '<br>'}</p>`;
  }
  closeLists();
  return out;
}

/* ---------- DOM → Markdown ---------- */

interface Fmt { b?: boolean; i?: boolean; s?: boolean; code?: boolean; href?: string }
type Run = { text: string; fmt: Fmt } | { br: true };

const BLOCK = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'LI', 'HR',
  'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'FIGURE', 'FIGCAPTION', 'ADDRESS',
  'DL', 'DT', 'DD', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'DETAILS', 'SUMMARY',
  'CENTER', 'FORM', 'FIELDSET',
]);
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IMG', 'SVG', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'CANVAS', 'HEAD', 'TITLE', 'META', 'LINK', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA']);
const isBlock = (n: Node): n is HTMLElement => n.nodeType === 1 && BLOCK.has((n as Element).tagName);
const isList = (n: Node): n is HTMLElement => n.nodeType === 1 && /^(UL|OL)$/.test((n as Element).tagName);

export interface MarkdownOptions {
  /** Collapse whitespace as HTML does (pasted HTML). The editor uses
   * white-space: pre-wrap, so its whitespace is kept as typed. */
  collapse?: boolean;
}

function formatOf(el: HTMLElement, fmt: Fmt): Fmt {
  const f = { ...fmt };
  const tag = el.tagName;
  if (tag === 'B' || tag === 'STRONG') f.b = true;
  if (tag === 'I' || tag === 'EM') f.i = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') f.s = true;
  if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT') f.code = true;
  if (tag === 'A') {
    const href = safeUrl(el.getAttribute('href') ?? '');
    if (href) f.href = href;
  }
  const face = tag === 'FONT' ? el.getAttribute('face') : null;
  const st = el.style;
  const family = st?.fontFamily || face;
  if (family) f.code = /monospace|courier|consolas|menlo|monaco/i.test(family);
  const weight = st?.fontWeight;
  if (weight) f.b = weight === 'bold' || weight === 'bolder' || Number(weight) >= 600;
  if (st?.fontStyle) f.i = st.fontStyle === 'italic' || st.fontStyle === 'oblique';
  const deco = st?.textDecorationLine || st?.textDecoration;
  if (deco) f.s = deco.includes('line-through');
  return f;
}

function collectRuns(nodes: Iterable<Node>, fmt: Fmt, runs: Run[], opts: MarkdownOptions) {
  for (const child of nodes) {
    if (child.nodeType === 3) {
      let text = (child.nodeValue ?? '').replace(/​/g, '').replace(/ /g, ' ');
      if (opts.collapse) text = text.replace(/[ \t\r\n\f]+/g, ' ');
      if (text) runs.push({ text, fmt });
    } else if (child.nodeType === 1) {
      const el = child as HTMLElement;
      if (SKIP.has(el.tagName)) continue;
      if (el.tagName === 'BR') runs.push({ br: true });
      else collectRuns(el.childNodes, formatOf(el, fmt), runs, opts);
    }
  }
}

const sameFmt = (a: Fmt, b: Fmt) => !!a.b === !!b.b && !!a.i === !!b.i && !!a.s === !!b.s && !!a.code === !!b.code && a.href === b.href;
const commonFmt = (a: Fmt | undefined, b: Fmt | undefined): Fmt => {
  if (!a || !b) return {};
  const f: Fmt = {};
  if (a.b && b.b) f.b = true;
  if (a.i && b.i) f.i = true;
  if (a.s && b.s) f.s = true;
  if (a.code && b.code) f.code = true;
  if (a.href && a.href === b.href) f.href = a.href;
  return f;
};

/** Escapes Markdown characters in plain text, leaving web addresses as they
 * are (the parser links them, so a backslash would end up in the address). */
function escText(t: string): string {
  const url = /(?<![\p{L}\p{N}])https?:\/\//giu;
  let out = '';
  let last = 0;
  for (let m; (m = url.exec(t)); ) {
    const found = AUTOLINK.exec(t.slice(m.index));
    if (!found) continue;
    out += escChars(t.slice(last, m.index)) + found[0];
    last = m.index + found[0].length;
    url.lastIndex = last;
  }
  return out + escChars(t.slice(last));
}

function escChars(t: string) {
  return t
    .replace(/\\(?=[!-/:-@[-`{-~]|$)/g, '\\\\')
    .replace(/`|\*(?!\s)|(?<!\s)\*|^\*|\*$/g, '\\$&')
    .replace(/~(?=~)|(?<=~)~/g, '\\~')
    .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, '\\_')
    .replace(/\[(?=[^\]]*\]\()/g, '\\[');
}

function codeSpan(t: string) {
  const longest = Math.max(0, ...(t.match(/`+/g) ?? []).map((r) => r.length));
  const fence = '`'.repeat(longest + 1);
  const pad = t.startsWith('`') || t.endsWith('`') || (t.startsWith(' ') && t.endsWith(' ') && t.trim()) ? ' ' : '';
  return fence + pad + t + pad + fence;
}

type Key = 'href' | 'b' | 'i' | 's' | 'code';
const ORDER: Key[] = ['href', 'b', 'i', 's', 'code'];
const MARK: Record<Exclude<Key, 'href' | 'code'>, string> = { b: '**', i: '*', s: '~~' };

/** One line's worth of formatted runs as Markdown. */
function inlineMarkdown(runs: { text: string; fmt: Fmt }[]): string {
  // Split leading/trailing whitespace off each run; whitespace keeps only the
  // formats shared by its neighbours, so "**word** next" not "**word **next".
  type Piece = { text: string; fmt: Fmt; ws: boolean };
  const pieces: Piece[] = [];
  for (const r of runs) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.text)!;
    if (m[1]) pieces.push({ text: m[1], fmt: r.fmt, ws: true });
    if (m[2]) pieces.push({ text: m[2], fmt: r.fmt, ws: false });
    if (m[3]) pieces.push({ text: m[3], fmt: r.fmt, ws: true });
  }
  for (let k = 0; k < pieces.length; k++) {
    if (!pieces[k].ws) continue;
    const prev = pieces.slice(0, k).reverse().find((p) => !p.ws);
    const next = pieces.slice(k + 1).find((p) => !p.ws);
    pieces[k].fmt = commonFmt(prev?.fmt, next?.fmt);
  }
  const merged: Piece[] = [];
  for (const p of pieces) {
    const last = merged.at(-1);
    if (last && sameFmt(last.fmt, p.fmt)) last.text += p.text;
    else merged.push({ ...p });
  }

  let out = '';
  const stack: { key: Key; href?: string }[] = [];
  const close = (to: number) => {
    while (stack.length > to) {
      const top = stack.pop()!;
      if (top.key === 'href') out += `](${top.href})`;
      else if (top.key !== 'code') out += MARK[top.key];
    }
  };
  for (let k = 0; k < merged.length; k++) {
    const { fmt, text } = merged[k];
    const want = ORDER.filter((key) => (key === 'href' ? fmt.href : fmt[key]));
    let keep = 0;
    while (keep < stack.length && keep < want.length && stack[keep].key === want[keep]
      && (want[keep] !== 'href' || stack[keep].href === fmt.href)) keep++;
    close(keep);

    let piece = text;
    for (const key of want.slice(keep)) {
      if (key === 'href') {
        // A link whose text is its own address is written as a bare URL.
        let j = k;
        let linkText = '';
        let plain = true;
        while (j < merged.length && merged[j].fmt.href === fmt.href) {
          const f = merged[j].fmt;
          if (f.b || f.i || f.s || f.code) plain = false;
          linkText += merged[j].text;
          j++;
        }
        if (plain && stack.length === 0 && linkText === fmt.href && AUTOLINK.exec(linkText)?.[0] === linkText) {
          out += linkText;
          k = j - 1;
          piece = '';
          break;
        }
        out += '[';
        stack.push({ key, href: fmt.href });
      } else if (key === 'code') {
        stack.push({ key });
      } else {
        out += MARK[key];
        stack.push({ key });
      }
    }
    if (piece) out += fmt.code ? codeSpan(piece) : escText(piece);
  }
  close(0);
  return out;
}

/** Splits runs into lines at <br> and newlines. A trailing break ends the
 * block rather than starting a new line, as it renders. */
function runsToLines(runs: Run[]): string[] {
  const lines: { text: string; fmt: Fmt }[][] = [[]];
  for (const r of runs) {
    if ('br' in r) { lines.push([]); continue; }
    const parts = r.text.split('\n');
    parts.forEach((part, idx) => {
      if (idx > 0) lines.push([]);
      if (part) lines.at(-1)!.push({ text: part, fmt: r.fmt });
    });
  }
  if (lines.length > 1 && lines.at(-1)!.length === 0) lines.pop();
  return lines.map(inlineMarkdown);
}

/** Backslash-escapes what would otherwise start a block at the beginning of a paragraph line. */
function escapeLineStart(line: string) {
  return line
    .replace(/^(\s*)(?=#{1,6}(\s|$)|>|[-+](\s|$)|`{3}|~{3}|\[[ xX]\](\s|$))/, '$1\\')
    .replace(/^(\s*\d{1,9})([.)])(?=\s|$)/, '$1\\$2')
    .replace(/^( {0,3})([-_])(?=(?: *\2){2,} *$)/, '$1\\$2');
}

function inlineLines(nodes: Node[], opts: MarkdownOptions): string[] {
  const runs: Run[] = [];
  collectRuns(nodes, {}, runs, opts);
  let lines = runsToLines(runs);
  if (opts.collapse) {
    lines = lines.map((l) => l.replace(/ {2,}/g, ' ').trim());
    if (lines.every((l) => !l)) return [];
  }
  return lines;
}

function preText(el: Node): string {
  let s = '';
  for (const c of el.childNodes) {
    if (c.nodeType === 3) s += c.nodeValue;
    else if ((c as Element).tagName === 'BR') s += '\n';
    else if (c.nodeType === 1) {
      if (isBlock(c) && s && !s.endsWith('\n')) s += '\n';
      s += preText(c);
    }
  }
  return s.replace(/​/g, '').replace(/ /g, ' ');
}

function blockLines(container: Node, out: string[], opts: MarkdownOptions) {
  let inline: Node[] = [];
  const flush = () => {
    if (inline.length) out.push(...inlineLines(inline, opts).map(escapeLineStart));
    inline = [];
  };
  for (const child of container.childNodes) {
    if (child.nodeType === 1 && SKIP.has((child as Element).tagName)) continue;
    if (!isBlock(child)) {
      if (child.nodeType === 3 || child.nodeType === 1) inline.push(child);
      continue;
    }
    flush();
    const el = child;
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) {
      const hashes = '#'.repeat(Number(tag[1]));
      for (const l of inlineLines([...el.childNodes], opts)) out.push(l ? `${hashes} ${l}` : hashes);
    } else if (tag === 'BLOCKQUOTE') {
      const sub: string[] = [];
      blockLines(el, sub, opts);
      for (const l of sub.length ? sub : ['']) out.push(l ? `> ${l}` : '>');
    } else if (tag === 'UL' || tag === 'OL') {
      listLines(el, '', out, opts);
    } else if (tag === 'LI') {
      itemLines(el, '- ', '', out, opts);
    } else if (tag === 'PRE') {
      let text = preText(el);
      if (text.endsWith('\n')) text = text.slice(0, -1);
      const longest = Math.max(2, ...(text.match(/^`{3,}/gm) ?? []).map((r) => r.length));
      const fence = '`'.repeat(longest + 1);
      out.push(fence + (el.dataset.lang ?? ''), ...text.split('\n'), fence);
    } else if (tag === 'HR') {
      out.push('---');
    } else {
      blockLines(el, out, opts);
    }
  }
  flush();
}

function itemLines(li: HTMLElement, marker: string, indent: string, out: string[], opts: MarkdownOptions) {
  const sub: string[] = [];
  blockLines(li, sub, opts);
  const pad = ' '.repeat(marker.length);
  out.push(`${indent}${marker}${sub[0] ?? ''}`);
  for (const l of sub.slice(1)) out.push(l ? `${indent}${pad}${l}` : '');
}

function listLines(list: HTMLElement, indent: string, out: string[], opts: MarkdownOptions) {
  const ordered = list.tagName === 'OL';
  const tasks = !ordered && list.classList.contains('tasks');
  let n = ordered ? Number(list.getAttribute('start')) || 1 : 1;
  let lastMarker = ordered ? '1. ' : '- ';
  let loose: Node[] = [];
  const item = (li: HTMLElement) => {
    const marker = ordered ? `${n++}. ` : tasks ? `- [${li.dataset.checked === 'true' ? 'x' : ' '}] ` : '- ';
    lastMarker = marker;
    itemLines(li, marker, indent, out, opts);
  };
  const flushLoose = () => {
    if (loose.some((n) => n.nodeType === 1 || n.nodeValue?.trim())) {
      const li = document.createElement('li');
      li.append(...loose.map((n) => n.cloneNode(true)));
      item(li);
    }
    loose = [];
  };
  for (const child of list.childNodes) {
    if (isList(child)) {
      // Browsers nest lists directly in lists when indenting.
      flushLoose();
      listLines(child, indent + ' '.repeat(lastMarker.length), out, opts);
    } else if (child.nodeType === 1 && (child as Element).tagName === 'LI') {
      flushLoose();
      item(child as HTMLElement);
    } else {
      loose.push(child);
    }
  }
  flushLoose();
}

export function toMarkdown(root: Node, opts: MarkdownOptions = {}): string {
  const out: string[] = [];
  blockLines(root, out, opts);
  if (opts.collapse) {
    // Pasted HTML: blank lines between blocks carry no meaning, keep at most one.
    return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
  }
  return out.join('\n');
}

/* ---------- plain text ---------- */

/** A line with its Markdown stripped, for titles and previews in the note list. */
export function plain(line: string): string {
  return line
    .replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d{1,9}[.)]\s+)*/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*\\])[*_]([^*_]+)[*_](?![\w*])/g, '$1$2')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .trim();
}
