import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Alert, type Ask, type AlertRequest } from './components/Alert.tsx';
import { Editor } from './components/Editor.tsx';
import { Icon } from './components/Icon.tsx';
import { MoreMenu } from './components/Menu.tsx';
import { NoteList } from './components/NoteList.tsx';
import { Toast, type ToastMessage } from './components/Toast.tsx';
import { longDate } from './lib/dates.ts';
import {
  LAST_BACKUP_KEY, LAST_OPEN_KEY, STORAGE_KEY, loadNotes, local, makeBackup, mergeNotes, parseBackup,
  saveNotes, sortNotes, uid, type Note,
} from './lib/notes.ts';

const NARROW = '(max-width: 759px)';
type View = 'list' | 'editor';

const newNote = (): Note => {
  const now = Date.now();
  return { id: uid(), body: '', created: now, updated: now, pinned: false };
};

/** Notes with nothing in them disappear when you leave them, as in Apple Notes. */
const dropEmpty = (notes: Note[], id: string | null) =>
  id ? notes.filter((n) => n.id !== id || n.body.trim()) : notes;

function defaultNoteId(notes: Note[]) {
  const last = local.get(LAST_OPEN_KEY);
  return notes.some((n) => n.id === last) ? last : (sortNotes(notes)[0]?.id ?? null);
}

// Worked out once, outside React, so StrictMode's double render can't repeat the history calls.
const initial = (() => {
  const notes = loadNotes();
  const narrow = matchMedia(NARROW).matches;
  // After a reload the editor starts closed, so drop a leftover "note open" history entry.
  if (history.state?.note) history.replaceState(null, '');

  if (new URLSearchParams(location.search).has('new')) {
    history.replaceState(null, '', location.pathname);
    const n = newNote();
    if (narrow) history.pushState({ note: n.id }, '');
    return { notes: [...notes, n], currentId: n.id, view: (narrow ? 'editor' : 'list') as View, focus: true };
  }
  return { notes, currentId: narrow ? null : defaultNoteId(notes), view: 'list' as View, focus: false };
})();

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>(initial.notes);
  const [currentId, setCurrentId] = useState<string | null>(initial.currentId);
  const [view, setView] = useState<View>(initial.view);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [alert, setAlert] = useState<AlertRequest | null>(null);
  const [lastBackup, setLastBackup] = useState(() => Number(local.get(LAST_BACKUP_KEY)) || null);
  const [now, setNow] = useState(() => Date.now());
  const narrow = useMediaQuery(NARROW);

  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef(notes);

  const current = notes.find((n) => n.id === currentId) ?? null;
  const q = query.trim().toLowerCase();
  const visible = sortNotes(notes).filter((n) => !q || n.body.toLowerCase().includes(q));

  const showToast = useCallback((text: string, action?: ToastMessage['action']) => {
    setToast({ id: Date.now(), text, action });
  }, []);
  const clearToast = useCallback(() => setToast(null), []);

  const ask = useCallback<Ask>((options) =>
    new Promise((resolve) => {
      setAlert({ ...options, resolve: resolve as AlertRequest['resolve'] });
    }), []);

  /* ---------- persistence ---------- */

  const persist = useCallback(() => {
    if (!saveNotes(notesRef.current)) showToast('Couldn’t save. Storage may be full or blocked.');
  }, [showToast]);

  useEffect(() => {
    notesRef.current = notes;
    const t = setTimeout(persist, 300);
    return () => clearTimeout(t);
  }, [notes, persist]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') persist(); };
    addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', onHide);
    navigator.storage?.persist?.().catch(() => {});
    return () => {
      removeEventListener('pagehide', persist);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [persist]);

  // Keep several open tabs in step.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) setNotes(loadNotes()); };
    addEventListener('storage', onStorage);
    return () => removeEventListener('storage', onStorage);
  }, []);

  // Refresh relative dates ("Today", times) every minute.
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (currentId) local.set(LAST_OPEN_KEY, currentId);
  }, [currentId]);

  useEffect(() => {
    if (initial.focus) editorRef.current?.focus();
  }, []);

  /* ---------- navigation ---------- */

  const showEditor = (id: string) => {
    if (narrow && view !== 'editor') {
      history.pushState({ note: id }, '');
      setView('editor');
    }
  };

  const openNote = (id: string) => {
    if (id !== currentId) setNotes((ns) => dropEmpty(ns, currentId));
    setCurrentId(id);
    showEditor(id);
  };

  const closeEditor = () => {
    editorRef.current?.blur();
    setNotes((ns) => dropEmpty(ns, currentId));
    setView('list');
  };

  const goBack = () => {
    if (history.state?.note) history.back();
    else closeEditor();
  };

  useEffect(() => {
    const onPop = () => { if (narrow && view === 'editor' && !history.state?.note) closeEditor(); };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  });

  // Moving between phone and desktop layouts (adjusted during render, per React's guidance).
  const [prevNarrow, setPrevNarrow] = useState(narrow);
  if (narrow !== prevNarrow) {
    setPrevNarrow(narrow);
    if (narrow) {
      if (currentId) setView('editor');
    } else {
      setView('list');
      if (!currentId) setCurrentId(defaultNoteId(notes));
    }
  }

  /* ---------- note actions ---------- */

  const createNote = () => {
    const n = newNote();
    setQuery('');
    // Render synchronously so the editor can take focus inside the tap,
    // which is what makes the iOS keyboard appear.
    flushSync(() => {
      setNotes((ns) => [...dropEmpty(ns, currentId), n]);
      setCurrentId(n.id);
      showEditor(n.id);
    });
    editorRef.current?.focus();
  };

  const updateBody = (body: string) => {
    if (!currentId) return;
    setNotes((ns) => ns.map((n) => (n.id === currentId ? { ...n, body, updated: Date.now() } : n)));
  };

  const togglePin = () => {
    if (!currentId) return;
    setNotes((ns) => ns.map((n) => (n.id === currentId ? { ...n, pinned: !n.pinned } : n)));
  };

  const deleteCurrent = () => {
    if (!current) return;
    const order = sortNotes(notes);
    const idx = order.findIndex((n) => n.id === current.id);
    const next = order[idx + 1] ?? order[idx - 1];
    const removed = current;
    setNotes((ns) => ns.filter((n) => n.id !== removed.id));

    if (narrow) {
      setCurrentId(null);
      goBack();
    } else {
      setCurrentId(next?.id ?? null);
    }

    if (removed.body.trim()) {
      showToast('Note deleted', {
        label: 'Undo',
        run: () => {
          setNotes((ns) => [...ns, removed]);
          if (!narrow) setCurrentId(removed.id);
        },
      });
    }
  };

  /* ---------- backup & restore ---------- */

  const backup = async () => {
    persist();
    const { blob, name } = makeBackup(notesRef.current);
    const count = notesRef.current.length;
    const done = () => {
      const now = Date.now();
      local.set(LAST_BACKUP_KEY, String(now));
      setLastBackup(now);
      showToast(`Backed up ${count} ${count === 1 ? 'note' : 'notes'}`);
    };

    // On phones the share sheet is the dependable way to save into Files or Drive.
    const file = new File([blob], name, { type: 'application/json' });
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Notes backup' });
        done();
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }

    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    done();
  };

  const restore = async (file: File) => {
    let data;
    try {
      data = parseBackup(await file.text());
    } catch (err) {
      await ask({ title: 'Can’t Restore', message: (err as Error).message, buttons: [{ label: 'OK', value: null, primary: true }] });
      return;
    }

    const count = data.notes.length;
    const plural = count === 1 ? 'note' : 'notes';
    const from = data.exportedAt ? ` from ${longDate(data.exportedAt)}` : '';
    const { value: choice } = await ask({
      title: 'Restore Backup?',
      message: `This backup${from} has ${count} ${plural}. Merge keeps your current notes and adds or updates notes from the backup. Replace deletes your current notes first.`,
      buttons: [
        { label: 'Merge', value: 'merge', primary: true },
        { label: 'Replace All Notes', value: 'replace', destructive: true },
        { label: 'Cancel', value: null },
      ],
    });
    if (!choice) return;

    let next: Note[];
    let summary: string;
    if (choice === 'replace') {
      next = data.notes;
      summary = `Restored ${count} ${plural}`;
    } else {
      const merged = mergeNotes(notesRef.current, data.notes);
      next = merged.notes;
      summary = merged.added || merged.updated
        ? [merged.added && `${merged.added} added`, merged.updated && `${merged.updated} updated`].filter(Boolean).join(', ')
        : 'Already up to date';
    }

    setNotes(next);
    if (!next.some((n) => n.id === currentId)) {
      if (narrow) { setCurrentId(null); if (view === 'editor') goBack(); } else setCurrentId(defaultNoteId(next));
    }
    showToast(summary);
  };

  /* ---------- render ---------- */

  const count = notes.length;
  return (
    <div className="app" data-view={view}>
      <aside className="sidebar" aria-label="Notes" inert={narrow && view === 'editor'}>
        <header className="sidebar-head">
          <h1 className="large-title">Notes</h1>
          <div className="head-actions">
            <MoreMenu lastBackup={lastBackup} onBackup={backup} onRestore={() => fileRef.current?.click()} />
            <button className="icon-btn desktop-only" aria-label="New note" title="New note" onClick={createNote}>
              <Icon name="compose" />
            </button>
          </div>
        </header>

        <label className="search">
          <Icon name="search" />
          <input
            type="search"
            placeholder="Search"
            aria-label="Search notes"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } }}
          />
        </label>

        <NoteList
          notes={visible}
          now={now}
          currentId={narrow ? null : currentId}
          searching={!!q}
          onOpen={openNote}
          arrowsOpen={!narrow}
        />

        <footer className="sidebar-foot">
          <span className="count">{q ? `${visible.length} Found` : `${count} ${count === 1 ? 'Note' : 'Notes'}`}</span>
          <button className="icon-btn tint" aria-label="New note" onClick={createNote}>
            <Icon name="compose" />
          </button>
        </footer>
      </aside>

      <Editor
        note={current}
        editorRef={editorRef}
        onChange={updateBody}
        ask={ask}
        onTogglePin={togglePin}
        onDelete={deleteCurrent}
        onBack={goBack}
        inert={narrow && view === 'list'}
      />

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) restore(f);
        }}
      />
      <Alert request={alert} onClose={() => setAlert(null)} />
      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}
