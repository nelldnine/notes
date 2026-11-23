import type { KeyboardEvent } from 'react';
import { groupLabel, listDate } from '../lib/dates.ts';
import { previewOf, titleOf, type Note } from '../lib/notes.ts';

interface Props {
  notes: Note[]; // already sorted and filtered
  /** Current time, refreshed by the parent so "Today" and times stay correct. */
  now: number;
  currentId: string | null;
  searching: boolean;
  onOpen: (id: string) => void;
  /** Arrow keys move the selection on desktop; on phones they only move focus. */
  arrowsOpen: boolean;
}

export function NoteList({ notes, now: nowMs, currentId, searching, onOpen, arrowsOpen }: Props) {
  const now = new Date(nowMs);
  const groups: { label: string; items: Note[] }[] = [];
  for (const n of notes) {
    const label = n.pinned ? 'Pinned' : groupLabel(n.updated, now);
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
    groups.at(-1)!.items.push(n);
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.note')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = i >= 0 ? items[i + (e.key === 'ArrowDown' ? 1 : -1)] : undefined;
    if (!next) return;
    e.preventDefault();
    next.focus();
    if (arrowsOpen) onOpen(next.dataset.id!);
  };

  return (
    <nav className="list" aria-label="All notes" onKeyDown={onKeyDown}>
      {groups.length === 0 && <p className="list-empty">{searching ? 'No Results' : 'No Notes'}</p>}
      {groups.map((g) => (
        <section className="group" key={g.label}>
          <h2>{g.label}</h2>
          <ul>
            {g.items.map((n) => (
              <li key={n.id}>
                <button
                  className="note"
                  data-id={n.id}
                  aria-current={n.id === currentId ? 'true' : undefined}
                  // Safari doesn't focus buttons on click; the highlight colour depends on focus.
                  onClick={(e) => { e.currentTarget.focus(); onOpen(n.id); }}
                >
                  <span className="note-title">{titleOf(n)}</span>
                  <span className="note-meta">
                    <time dateTime={new Date(n.updated).toISOString()}>{listDate(n.updated, now)}</time>
                    <span className="note-preview">{previewOf(n)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
