import { useEffect, useRef, useState } from 'react';
import { relativeDate } from '../lib/dates.ts';
import { Icon } from './Icon.tsx';

interface Props {
  lastBackup: number | null;
  onBackup: () => void;
  onRestore: () => void;
}

export function MoreMenu({ lastBackup, onBackup, onRestore }: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector('button')?.focus();
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (action: () => void) => () => { setOpen(false); action(); };

  return (
    <>
      <button
        ref={buttonRef}
        className="icon-btn"
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu" role="menu" ref={menuRef}>
          <button role="menuitem" onClick={choose(onBackup)}>
            <Icon name="download" /><span>Back Up Notes</span>
          </button>
          <button role="menuitem" onClick={choose(onRestore)}>
            <Icon name="upload" /><span>Restore from Backup…</span>
          </button>
          <p className="menu-note">
            {lastBackup ? `Last backed up ${relativeDate(lastBackup)}` : 'Not backed up yet'}
          </p>
        </div>
      )}
    </>
  );
}
