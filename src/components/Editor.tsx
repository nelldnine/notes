import {
  useEffect, useLayoutEffect, useRef, useState,
  type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type RefObject,
} from 'react';
import { longDate } from '../lib/dates.ts';
import { CODE_FONT, safeUrl, toHtml, toMarkdown } from '../lib/markdown.ts';
import type { Note } from '../lib/notes.ts';
import type { Ask } from './Alert.tsx';
import { Icon, type IconName } from './Icon.tsx';

type Command = 'heading' | 'bold' | 'italic' | 'quote' | 'code' | 'link' | 'ordered' | 'bullet' | 'task';
type Active = Partial<Record<Command, boolean>>;

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl+';
const SHIFT = isMac ? '⌘⇧' : 'Ctrl+Shift+';

const TOOLS: ({ cmd: Command; icon: IconName; label: string; keys?: string } | 'sep')[] = [
  { cmd: 'heading', icon: 'heading', label: 'Heading' },
  { cmd: 'bold', icon: 'bold', label: 'Bold', keys: `${MOD}B` },
  { cmd: 'italic', icon: 'italic', label: 'Italic', keys: `${MOD}I` },
  'sep',
  { cmd: 'quote', icon: 'quote', label: 'Quote', keys: `${SHIFT}.` },
  { cmd: 'code', icon: 'code', label: 'Code', keys: `${MOD}E` },
  { cmd: 'link', icon: 'link', label: 'Link', keys: `${MOD}K` },
  'sep',
  { cmd: 'ordered', icon: 'ordered', label: 'Numbered list', keys: `${SHIFT}7` },
  { cmd: 'bullet', icon: 'bullet', label: 'Bulleted list', keys: `${SHIFT}8` },
  { cmd: 'task', icon: 'task', label: 'Checklist', keys: `${SHIFT}L` },
];

const SHORTCUTS: Record<string, Command> = { b: 'bold', i: 'italic', e: 'code', k: 'link' };
const SHIFT_SHORTCUTS: Record<string, Command> = { Period: 'quote', Digit7: 'ordered', Digit8: 'bullet', KeyL: 'task' };

const exec = (cmd: string, value?: string) => document.execCommand(cmd, false, value);

/** Typing these at the start of a line turns it into that kind of block. */
const BLOCK_SHORTCUTS: [RegExp, (m: RegExpMatchArray) => void][] = [
  [/^[-*+]$/, () => exec('insertUnorderedList')],
  [/^\d{1,9}[.)]$/, () => exec('insertOrderedList')],
  [/^#{1,6}$/, (m) => exec('formatBlock', `h${Math.min(m[0].length, 3)}`)],
  [/^>$/, () => exec('formatBlock', 'blockquote')],
];

/** Typing a closing marker formats what it encloses, as in many Markdown editors. */
const INLINE_SHORTCUTS: [RegExp, string, number][] = [
  [/(?:^|[^*\\])\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, 'bold', 2],
  [/(?:^|[^\w_\\])__([^_\s](?:[^_]*[^_\s])?)__$/, 'bold', 2],
  [/(?:^|[^*\\])\*([^*\s](?:[^*]*[^*\s])?)\*$/, 'italic', 1],
  [/(?:^|[^\w_\\])_([^_\s](?:[^_]*[^_\s])?)_$/, 'italic', 1],
  [/(?:^|[^~\\])~~([^~\s](?:[^~]*[^~\s])?)~~$/, 'strikeThrough', 2],
  [/(?:^|[^`\\])`([^`]+)`$/, 'code', 1],
];

interface Props {
  note: Note | null;
  editorRef: RefObject<HTMLDivElement | null>;
  onChange: (body: string) => void;
  onTogglePin: () => void;
  onDelete: () => void;
  onBack: () => void;
  ask: Ask;
  inert: boolean;
}

export function Editor({ note, editorRef, onChange, onTogglePin, onDelete, onBack, ask, inert }: Props) {
  const [typing, setTyping] = useState(false);
  const [active, setActive] = useState<Active>({});
  const shown = useRef<{ id: string | null; body: string | null }>({ id: null, body: null });
  const lastRange = useRef<Range | null>(null);
  const draggingInside = useRef(false);

  /* ---------- keeping the DOM and the Markdown in step ---------- */

  const markEmpty = (el: HTMLElement, md: string) => {
    if (md.trim()) delete el.dataset.empty;
    else el.dataset.empty = '';
  };

  // Render the note when another note is opened, or when its text changes
  // from outside the editor (another tab, a restore). Typing doesn't re-render.
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const id = note?.id ?? null;
    const body = note?.body ?? null;
    if (id === shown.current.id && body === shown.current.body) return;
    const opened = id !== shown.current.id;
    shown.current = { id, body };
    el.innerHTML = body === null ? '' : toHtml(body);
    markEmpty(el, body ?? '');
    if (opened) el.scrollTop = 0;
  }, [note?.id, note?.body, editorRef]);

  const sync = () => {
    const el = editorRef.current;
    if (!el || !note) return;
    const md = toMarkdown(el);
    markEmpty(el, md);
    if (md === shown.current.body) return;
    shown.current = { id: note.id, body: md };
    onChange(md);
  };

  /* ---------- selection ---------- */

  const selectionRange = (): Range | null => {
    const el = editorRef.current;
    const sel = getSelection();
    if (!el || !sel?.rangeCount) return null;
    const r = sel.getRangeAt(0);
    return el.contains(r.commonAncestorContainer) ? r : null;
  };

  const select = (r: Range) => {
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  };

  /** Puts focus and the caret back in the note before a command runs. */
  const ensureFocus = () => {
    const el = editorRef.current!;
    if (document.activeElement === el && selectionRange()) return;
    const saved = lastRange.current;
    el.focus({ preventScroll: true });
    if (saved && el.contains(saved.commonAncestorContainer)) select(saved);
    else if (!selectionRange()) {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      select(r);
    }
  };

  const closestIn = (node: Node | null, selector: string): HTMLElement | null => {
    const el = editorRef.current;
    const start = node?.nodeType === 3 ? node.parentElement : (node as HTMLElement | null);
    const found = start?.closest<HTMLElement>(selector) ?? null;
    return found && el?.contains(found) && found !== el ? found : null;
  };

  const readActive = (): Active => {
    const r = selectionRange();
    if (!r) return {};
    const at = r.startContainer;
    const list = closestIn(at, 'li')?.parentElement;
    // The browser reports the font in effect, including the typing style after
    // toggling with a collapsed caret, so "monospace" anywhere in it means code.
    let code = !!closestIn(at, 'pre');
    try { code ||= document.queryCommandValue('fontName').includes(CODE_FONT); } catch { /* unsupported */ }
    return {
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      heading: !!closestIn(at, 'h1, h2, h3, h4, h5, h6'),
      quote: !!closestIn(at, 'blockquote'),
      code,
      link: !!closestIn(at, 'a'),
      ordered: list?.tagName === 'OL',
      bullet: list?.tagName === 'UL' && !list.classList.contains('tasks'),
      task: !!list?.classList.contains('tasks'),
    };
  };

  const refreshActive = () => {
    const next = readActive();
    setActive((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  };

  useEffect(() => {
    document.execCommand('defaultParagraphSeparator', false, 'p');
    const onSelection = () => {
      const r = selectionRange();
      if (r) lastRange.current = r.cloneRange();
      refreshActive();
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  });

  /* ---------- commands ---------- */

  const baseFont = () => getComputedStyle(editorRef.current!).fontFamily;

  /** The list items the selection touches. */
  const selectedItems = (): HTMLElement[] => {
    const r = selectionRange();
    if (!r) return [];
    const items: HTMLElement[] = [...editorRef.current!.querySelectorAll('li')].filter((li) => r.intersectsNode(li));
    const own = closestIn(r.startContainer, 'li');
    return own && !items.includes(own) ? [own, ...items] : items;
  };

  const makeTasks = (on: boolean) => {
    for (const li of selectedItems()) {
      const list = li.parentElement!;
      if (list.tagName !== 'UL') continue;
      list.classList.toggle('tasks', on);
      if (!list.classList.length) list.removeAttribute('class');
      for (const item of list.children) {
        if (on) (item as HTMLElement).dataset.checked ??= 'false';
        else delete (item as HTMLElement).dataset.checked;
      }
    }
  };

  const inBoldBlock = () => {
    const r = selectionRange();
    const el = editorRef.current;
    if (!r || !el) return false;
    const title = el.firstElementChild;
    const inTitle = (n: Node) => !!title && /^(P|DIV)$/.test(title.tagName) && title.contains(n);
    const inHeading = (n: Node) => !!closestIn(n, 'h1, h2, h3, h4, h5, h6');
    return (inTitle(r.startContainer) && inTitle(r.endContainer)) || (inHeading(r.startContainer) && inHeading(r.endContainer));
  };

  const spansBlocks = (r: Range) => {
    const block = (n: Node) => closestIn(n, 'p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre');
    return block(r.startContainer) !== block(r.endContainer);
  };

  const leaveList = () => {
    const a = readActive();
    if (a.ordered) exec('insertOrderedList');
    else if (a.bullet || a.task) exec('insertUnorderedList');
  };

  const toggleCode = () => {
    const r = selectionRange();
    if (!r) return;
    const a = readActive();
    if (closestIn(r.startContainer, 'pre')) { exec('formatBlock', 'p'); return; }
    if (!r.collapsed && spansBlocks(r)) { leaveList(); exec('formatBlock', 'pre'); return; }
    exec('fontName', a.code ? baseFont() : CODE_FONT);
  };

  const editLink = async () => {
    const r = selectionRange();
    if (!r) return;
    const range = r.cloneRange();
    const anchor = closestIn(r.startContainer, 'a') ?? closestIn(r.endContainer, 'a');
    const restore = (to: Range) => { editorRef.current!.focus({ preventScroll: true }); select(to); };

    if (anchor) {
      const href = anchor.getAttribute('href') ?? '';
      const { value, text } = await ask({
        title: 'Edit Link',
        message: '',
        field: { value: href, placeholder: 'https://', label: 'Link address' },
        buttons: [
          { label: 'Save', value: 'save', primary: true },
          { label: 'Open Link', value: 'open' },
          { label: 'Remove Link', value: 'remove', destructive: true },
          { label: 'Cancel', value: null },
        ],
      });
      const whole = document.createRange();
      whole.selectNodeContents(anchor);
      if (value === 'open') { window.open(href, '_blank', 'noopener'); restore(range); return; }
      if (!value) { restore(range); return; }
      restore(whole);
      if (value === 'remove') exec('unlink');
      else { const url = safeUrl(text); if (url) exec('createLink', url); }
      getSelection()?.collapseToEnd();
      sync();
      return;
    }

    const selected = range.toString().trim();
    const { value, text } = await ask({
      title: 'Add Link',
      message: selected ? `Add a link to “${selected.length > 40 ? `${selected.slice(0, 40)}…` : selected}”.` : 'Enter the address to link to.',
      field: { value: '', placeholder: 'https://', label: 'Link address' },
      buttons: [{ label: 'Cancel', value: null }, { label: 'Add', value: 'add', primary: true }],
    });
    restore(range);
    const url = value && safeUrl(text);
    if (!url) return;
    if (range.collapsed) {
      exec('insertText', text.trim());
      const sel = getSelection()!;
      const end = sel.getRangeAt(0);
      const r2 = document.createRange();
      r2.setStart(end.endContainer, end.endOffset - text.trim().length);
      r2.setEnd(end.endContainer, end.endOffset);
      select(r2);
    }
    exec('createLink', url);
    getSelection()?.collapseToEnd();
    sync();
  };

  const run = (cmd: Command) => {
    if (!note) return;
    ensureFocus();
    const a = readActive();
    switch (cmd) {
      case 'bold':
        // The title and headings are bold already; "unbolding" them would not be saved.
        if (!inBoldBlock()) exec('bold');
        break;
      case 'italic': exec('italic'); break;
      case 'heading':
        if (!a.heading) leaveList();
        exec('formatBlock', a.heading ? 'p' : 'h2');
        break;
      case 'quote':
        if (!a.quote) leaveList();
        exec('formatBlock', a.quote ? 'p' : 'blockquote');
        break;
      case 'code': toggleCode(); break;
      case 'link': void editLink(); return;
      case 'bullet':
        if (a.task) makeTasks(false);
        else exec('insertUnorderedList');
        break;
      case 'ordered': exec('insertOrderedList'); break;
      case 'task':
        if (a.task) exec('insertUnorderedList');
        else {
          if (!a.bullet) exec('insertUnorderedList');
          makeTasks(true);
        }
        break;
    }
    sync();
    refreshActive();
  };

  /* ---------- typing ---------- */

  /** A plain paragraph (browsers sometimes nest these in each other). */
  const isParagraph = (block: HTMLElement) =>
    /^(P|DIV)$/.test(block.tagName) && !closestIn(block, 'li, blockquote, pre, h1, h2, h3, h4, h5, h6');

  /** Text from the start of the caret's block up to the caret. */
  const textBeforeCaret = (block: HTMLElement, r: Range) => {
    const before = document.createRange();
    before.setStart(block, 0);
    before.setEnd(r.endContainer, r.endOffset);
    return before.toString();
  };

  /** Whether the caret sits on an empty line at the end of a code block. */
  const onEmptyLastLine = (pre: HTMLElement, r: Range) => {
    const after = document.createRange();
    after.setStart(r.endContainer, r.endOffset);
    after.setEnd(pre, pre.childNodes.length);
    const rest = after.cloneContents();
    if (rest.textContent || rest.querySelectorAll('br').length > 1) return false;
    const upTo = document.createRange();
    upTo.setStart(pre, 0);
    upTo.setEnd(r.endContainer, r.endOffset);
    const head = upTo.cloneContents();
    let last: Node | null = head.lastChild;
    while (last && last.nodeType === 1 && last.nodeName !== 'BR' && last.lastChild) last = last.lastChild;
    return last?.nodeName === 'BR' || !!last?.nodeValue?.endsWith('\n');
  };

  const selectBack = (r: Range, length: number) => {
    // Walk back through text nodes to select the last `length` characters.
    const node = r.endContainer;
    if (node.nodeType !== 3 || r.endOffset < length) return false;
    const s = document.createRange();
    s.setStart(node, r.endOffset - length);
    s.setEnd(node, r.endOffset);
    select(s);
    return true;
  };

  const autoFormat = (data: string | null) => {
    const r = selectionRange();
    if (!r || !r.collapsed || !data) return;
    if (closestIn(r.startContainer, 'pre')) return;
    const block = closestIn(r.startContainer, 'p, div, li, h1, h2, h3, h4, h5, h6, blockquote');
    if (!block) return;
    const before = textBeforeCaret(block, r);

    if (data === ' ') {
      // "- " at the start of a paragraph and friends.
      const prefix = before.slice(0, -1);
      if (isParagraph(block)) {
        for (const [re, apply] of BLOCK_SHORTCUTS) {
          const m = prefix.match(re);
          if (m && selectBack(r, before.length)) { exec('delete'); apply(m); return; }
        }
      }
      // "[ ] " at the start of a bulleted item makes it a checklist item.
      if (block.tagName === 'LI' && /^\[[ xX]?\]$/.test(prefix) && block.parentElement?.tagName === 'UL') {
        if (selectBack(r, before.length)) {
          exec('delete');
          makeTasks(true);
          if (/x/i.test(prefix)) block.dataset.checked = 'true';
          return;
        }
      }
      // A web address followed by a space becomes a link.
      const url = /(?:^|\s)(https?:\/\/\S+[^\s.,:;"'!?)\]])\s$/i.exec(before);
      if (url && !closestIn(r.startContainer, 'a') && selectBack(r, url[1].length + 1)) {
        const s = getSelection()!.getRangeAt(0);
        s.setEnd(s.endContainer, s.endOffset - 1);
        select(s);
        exec('createLink', url[1]);
        getSelection()!.collapseToEnd();
        getSelection()!.modify('move', 'forward', 'character');
        return;
      }
    }

    for (const [re, command, marker] of INLINE_SHORTCUTS) {
      const m = re.exec(before);
      if (!m) continue;
      if (!selectBack(r, m[1].length + marker * 2)) return;
      exec('insertText', m[1]);
      const done = getSelection()!.getRangeAt(0);
      if (!selectBack(done, m[1].length)) return;
      if (command === 'code') exec('fontName', CODE_FONT);
      else exec(command);
      getSelection()!.collapseToEnd();
      // Carry on typing unformatted.
      if (command === 'code') exec('fontName', baseFont());
      else exec(command);
      return;
    }
  };

  const onBeforeInput = (e: FormEvent<HTMLDivElement>) => {
    const type = (e.nativeEvent as InputEvent).inputType;
    // Underline, colours and the like have no Markdown, so they would vanish on save.
    if (type?.startsWith('format') && !/^format(Bold|Italic|StrikeThrough)$/.test(type)) e.preventDefault();
  };

  const onInput = (e: FormEvent<HTMLDivElement>) => {
    const ev = e.nativeEvent as InputEvent;
    if (ev.isComposing) { sync(); return; }
    if (ev.inputType === 'insertParagraph') {
      // A new checklist item starts unticked.
      const li = closestIn(selectionRange()?.startContainer ?? null, 'li');
      if (li?.dataset.checked) li.dataset.checked = 'false';
    }
    if (ev.inputType === 'insertText') autoFormat(ev.data);
    sync();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const mod = e.metaKey || e.ctrlKey;
    const r = selectionRange();

    if (e.key === 'Enter' && !mod && !e.altKey && r) {
      const pre = closestIn(r.startContainer, 'pre');
      const block = closestIn(r.startContainer, 'p, div, h1, h2, h3, h4, h5, h6, blockquote, li');
      if (pre) {
        e.preventDefault();
        if (!pre.textContent) exec('formatBlock', 'p');
        else if (onEmptyLastLine(pre, r)) {
          // Return on an empty last line leaves the code block.
          exec('delete');
          const p = document.createElement('p');
          p.append(document.createElement('br'));
          pre.after(p);
          const to = document.createRange();
          to.setStart(p, 0);
          select(to);
        } else exec('insertLineBreak');
        sync();
        return;
      }
      if (block && !e.shiftKey) {
        const before = textBeforeCaret(block, r);
        // An empty quote line ends the quote.
        if (block.tagName === 'BLOCKQUOTE' && !block.textContent) { e.preventDefault(); exec('formatBlock', 'p'); sync(); return; }
        // ``` starts a code block, --- draws a line.
        if (isParagraph(block)) {
          const fence = /^```(\w*)$/.exec(before);
          if (fence && before === block.textContent && selectBack(r, before.length)) {
            e.preventDefault();
            exec('delete');
            exec('formatBlock', 'pre');
            const pre2 = closestIn(selectionRange()?.startContainer ?? null, 'pre');
            if (pre2 && fence[1]) pre2.dataset.lang = fence[1];
            sync();
            return;
          }
          if (/^(-{3,}|\*{3,}|_{3,})$/.test(before) && before === block.textContent && selectBack(r, before.length)) {
            e.preventDefault();
            exec('delete');
            exec('insertHorizontalRule');
            sync();
            return;
          }
        }
      }
      return;
    }

    if (e.key === 'Tab' && !mod && !e.altKey && r && closestIn(r.startContainer, 'li')) {
      e.preventDefault();
      exec(e.shiftKey ? 'outdent' : 'indent');
      sync();
      return;
    }

    if (!mod || e.altKey) return;
    if (!e.shiftKey && e.key.toLowerCase() === 'u') { e.preventDefault(); return; }
    const cmd = e.shiftKey ? SHIFT_SHORTCUTS[e.code] : SHORTCUTS[e.key.toLowerCase()];
    if (cmd) { e.preventDefault(); run(cmd); }
  };

  /* ---------- clipboard and dropping ---------- */

  const insertMarkdown = (md: string) => {
    const html = toHtml(md);
    // A single line goes in as inline content so it joins the current line.
    const single = !md.includes('\n') && html.startsWith('<p>') ? html.slice(3, -4) : html;
    exec('insertHTML', single);
  };

  const clipboardMarkdown = (data: DataTransfer): string | null => {
    const html = data.getData('text/html');
    if (html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return toMarkdown(doc.body, { collapse: true });
    }
    const text = data.getData('text/plain');
    return text ? text.replace(/\r\n?/g, '\n') : null;
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const r = selectionRange();
    if (!r) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (closestIn(r.startContainer, 'pre')) { exec('insertText', text); sync(); return; }

    // Pasting a web address over selected text links it.
    const url = /^https?:\/\/\S+$/i.test(text.trim()) ? safeUrl(text) : null;
    if (url && !r.collapsed && !spansBlocks(r)) { exec('createLink', url); getSelection()?.collapseToEnd(); sync(); return; }

    const md = clipboardMarkdown(e.clipboardData);
    if (md !== null) insertMarkdown(md);
    sync();
  };

  const onCopy = (e: ClipboardEvent<HTMLDivElement>, cut = false) => {
    const r = selectionRange();
    if (!r || r.collapsed) return;
    e.preventDefault();
    // Keep the list a copied item belongs to, so it pastes as the same kind of list.
    let holder: Node = document.createElement('div');
    const anc = r.commonAncestorContainer;
    if (anc.nodeType === 1 && /^(UL|OL)$/.test((anc as Element).tagName)) holder = anc.cloneNode(false);
    holder.appendChild(r.cloneContents());
    const wrap = document.createElement('div');
    wrap.append(holder);
    const md = toMarkdown(wrap);
    e.clipboardData.setData('text/plain', md);
    e.clipboardData.setData('text/html', toHtml(md));
    if (cut) { exec('delete'); sync(); }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (draggingInside.current) return; // moving text within the note
    e.preventDefault();
    const md = clipboardMarkdown(e.dataTransfer);
    if (md === null) return;
    const to = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    editorRef.current!.focus({ preventScroll: true });
    if (to) select(to);
    insertMarkdown(md);
    sync();
  };

  /* ---------- checklists and links ---------- */

  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('ul.tasks > li');
    if (!li || !note) return;
    // The tick box is drawn to the left of the item's text.
    if (e.clientX >= li.getBoundingClientRect().left) return;
    e.preventDefault();
    li.dataset.checked = li.dataset.checked === 'true' ? 'false' : 'true';
    sync();
  };

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    if (a && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      window.open(a.href, '_blank', 'noopener');
    }
  };

  return (
    <main className={`editor${note ? ' has-note' : ''}${typing ? ' typing' : ''}`} inert={inert}>
      <header className="editor-nav">
        <button className="back-btn" onClick={onBack}>
          <Icon name="back" /><span>Notes</span>
        </button>

        <div
          className="toolbar"
          role="toolbar"
          aria-label="Formatting"
          // Keep the caret (and the on-screen keyboard) in the note while tapping buttons.
          onMouseDown={(e) => { if ((e.target as Element).closest('button')) e.preventDefault(); }}
        >
          {TOOLS.map((tool, i) =>
            tool === 'sep' ? (
              <span className="sep" aria-hidden="true" key={i} />
            ) : (
              <button
                key={tool.cmd}
                aria-label={tool.label}
                aria-pressed={!!active[tool.cmd]}
                title={tool.keys ? `${tool.label} (${tool.keys})` : tool.label}
                onClick={() => run(tool.cmd)}
              >
                <Icon name={tool.icon} />
              </button>
            ),
          )}
        </div>

        <div className="nav-actions">
          <button
            className="icon-btn"
            aria-label={note?.pinned ? 'Unpin note' : 'Pin note'}
            title={note?.pinned ? 'Unpin note' : 'Pin note'}
            aria-pressed={!!note?.pinned}
            onClick={onTogglePin}
          >
            <Icon name="pin" />
          </button>
          <button className="icon-btn" aria-label="Delete note" title="Delete note" onClick={onDelete}>
            <Icon name="trash" />
          </button>
          <button className="done-btn" onClick={() => editorRef.current?.blur()}>Done</button>
        </div>
      </header>

      <div className="editor-body">
        {note && <time className="note-date" dateTime={new Date(note.updated).toISOString()}>{longDate(note.updated)}</time>}
        <div
          ref={editorRef}
          className="rich"
          role="textbox"
          aria-multiline="true"
          aria-label="Note"
          data-placeholder="Start writing…"
          contentEditable={!!note}
          suppressContentEditableWarning
          spellCheck
          onBeforeInput={onBeforeInput}
          onInput={onInput}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onCopy={(e) => onCopy(e)}
          onCut={(e) => onCopy(e, true)}
          onDragStart={() => { draggingInside.current = true; }}
          onDragEnd={() => { draggingInside.current = false; }}
          onDrop={onDrop}
          onMouseDown={onMouseDown}
          onClick={onClick}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
        />
      </div>

      <div className="editor-empty"><p>No Note Selected</p></div>
    </main>
  );
}
