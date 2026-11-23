import { plain } from './markdown.ts';

export interface Note {
  id: string;
  body: string;
  created: number;
  updated: number;
  pinned: boolean;
}

const KEY = 'notes:v1';
export const LAST_BACKUP_KEY = 'notes:lastBackup';
export const LAST_OPEN_KEY = 'notes:lastOpen';
export const STORAGE_KEY = KEY;

/** localStorage that never throws (private mode, blocked storage). */
export const local = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string): boolean {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  },
};

export const uid = (): string =>
  crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

function toTime(v: unknown, fallback: number): number;
function toTime(v: unknown, fallback: null): number | null;
function toTime(v: unknown, fallback: number | null) {
  const t = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : fallback;
}

/** Turns loosely shaped notes (from storage or a backup file) into clean ones. */
export function normalize(raw: unknown): Note[] {
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  const seen = new Set<string>();
  const out: Note[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const n = item as Record<string, unknown>;
    const body = typeof n.body === 'string' ? n.body : typeof n.text === 'string' ? n.text : null;
    if (body === null) continue;
    let id = typeof n.id === 'string' && n.id ? n.id : uid();
    if (seen.has(id)) id = uid();
    seen.add(id);
    const updated = toTime(n.updated, now);
    out.push({ id, body, created: toTime(n.created, updated), updated, pinned: !!n.pinned });
  }
  return out;
}

export function loadNotes(): Note[] {
  const raw = local.get(KEY);
  if (raw === null) return [welcomeNote()];
  try { return normalize(JSON.parse(raw)); } catch { return []; }
}

export function saveNotes(notes: Note[]): boolean {
  return local.set(KEY, JSON.stringify(notes));
}

export const sortNotes = (notes: Note[]) =>
  [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated);

function meaningfulLines(body: string) {
  return body.split('\n').map(plain).filter((l) => l && !/^(`{3,}|-{3,}|\*{3,})/.test(l));
}
export const titleOf = (n: Note) => meaningfulLines(n.body)[0] || 'New Note';
export const previewOf = (n: Note) => meaningfulLines(n.body)[1] || 'No additional text';

/* ---------- backups ---------- */

export interface Backup {
  notes: Note[];
  exportedAt: number | null;
}

export function makeBackup(notes: Note[]): { blob: Blob; name: string } {
  const stamp = new Date();
  const data = { app: 'notes', version: 1, exportedAt: stamp.toISOString(), notes };
  return {
    blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    name: `notes-backup-${stamp.toISOString().slice(0, 10)}.json`,
  };
}

export function parseBackup(text: string): Backup {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('This file isn’t a Notes backup.'); }
  const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const notes = normalize(Array.isArray(data) ? data : obj.notes);
  if (!notes.length) throw new Error('This backup doesn’t contain any notes.');
  return { notes, exportedAt: toTime(obj.exportedAt, null) };
}

/** Merge keeps the newer copy of each note, matched by id. */
export function mergeNotes(mine: Note[], incoming: Note[]) {
  const byId = new Map(mine.map((n) => [n.id, n]));
  let added = 0;
  let updated = 0;
  for (const n of incoming) {
    const existing = byId.get(n.id);
    if (!existing) { byId.set(n.id, n); added++; } else if (n.updated > existing.updated) { byId.set(n.id, n); updated++; }
  }
  return { notes: [...byId.values()], added, updated };
}

export function welcomeNote(): Note {
  const now = Date.now();
  return {
    id: uid(),
    created: now,
    updated: now,
    pinned: false,
    body: `Welcome to Notes
Notes save on this device as you type. The first line is the title.

### Formatting
Select text and use the toolbar, or press a toolbar button and keep typing:

**Bold**, *italic*, \`code\` and [links](https://example.com)

> Quotes look like this

- Bulleted lists
1. Numbered lists
- [ ] Checklists: click the circle to tick an item
- [x] Press Return to continue a list, Tab to indent it

### Shortcuts
⌘B bold · ⌘I italic · ⌘E code · ⌘K link
⌘⇧. quote · ⌘⇧7 numbered · ⌘⇧8 bullets · ⌘⇧L checklist
(Use Ctrl on Windows and Linux.)

Markdown works too: start a line with \`- \`, \`1. \`, \`[ ] \`, \`## \` or \`> \`, or type \`**bold**\`, \`*italic*\` or a backticked \`code\` span, and it formats as you go.

### Backups
Your notes stay in this browser and nowhere else. Open the ••• menu and choose Back Up Notes to save a copy. Restore from Backup brings it back.`,
  };
}
