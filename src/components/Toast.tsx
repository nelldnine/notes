import { useEffect, useState } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export function Toast({ toast, onDone }: { toast: ToastMessage | null; onDone: () => void }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const raf = requestAnimationFrame(() => setShown(true));
    const hide = setTimeout(() => setShown(false), toast.action ? 6000 : 2800);
    return () => { cancelAnimationFrame(raf); clearTimeout(hide); };
  }, [toast]);

  // Unmount once the fade-out finishes.
  useEffect(() => {
    if (shown || !toast) return;
    const t = setTimeout(onDone, 250);
    return () => clearTimeout(t);
  }, [shown, toast, onDone]);

  if (!toast) return null;
  return (
    <div className={`toast${shown ? ' show' : ''}`} role="status" aria-live="polite">
      <span>{toast.text}</span>
      {toast.action && (
        <button onClick={() => { setShown(false); toast.action!.run(); }}>{toast.action.label}</button>
      )}
    </div>
  );
}
