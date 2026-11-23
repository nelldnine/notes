import { useEffect, useRef } from 'react';

export interface AlertButton<T> {
  label: string;
  value: T;
  primary?: boolean;
  destructive?: boolean;
}

export interface AlertOptions<T> {
  title: string;
  message: string;
  buttons: AlertButton<T>[];
  /** An optional text field; its text comes back with the chosen button. */
  field?: { value: string; placeholder?: string; label: string };
}

export interface AlertResult<T> {
  value: T | null;
  text: string;
}

export type Ask = <T>(options: AlertOptions<T>) => Promise<AlertResult<T>>;

export interface AlertRequest extends AlertOptions<unknown> {
  resolve: (result: AlertResult<unknown>) => void;
}

/** An iOS-style alert built on <dialog>. Escape resolves with null. */
export function Alert({ request, onClose }: { request: AlertRequest | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (request && !d.open) {
      d.showModal();
      if (fieldRef.current) fieldRef.current.select();
      else d.querySelector<HTMLButtonElement>('.primary')?.focus();
    }
    if (!request && d.open) d.close();
  }, [request]);

  const finish = (value: unknown) => {
    const text = fieldRef.current?.value ?? '';
    // Close first, so whoever asked can move focus back out of the dialog.
    ref.current?.close();
    request?.resolve({ value, text });
    onClose();
  };

  const primary = request?.buttons.find((b) => b.primary);

  return (
    <dialog
      ref={ref}
      className="alert"
      aria-labelledby="alert-title"
      aria-describedby="alert-msg"
      onCancel={(e) => { e.preventDefault(); finish(null); }}
    >
      {request && (
        <>
          <div className="alert-text">
            <h2 id="alert-title">{request.title}</h2>
            {request.message && <p id="alert-msg">{request.message}</p>}
            {request.field && (
              <input
                ref={fieldRef}
                className="alert-field"
                type="url"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label={request.field.label}
                placeholder={request.field.placeholder}
                defaultValue={request.field.value}
                onKeyDown={(e) => { if (e.key === 'Enter' && primary) { e.preventDefault(); finish(primary.value); } }}
              />
            )}
          </div>
          <div className={`alert-buttons${request.buttons.length > 2 ? ' stacked' : ''}`}>
            {request.buttons.map((b) => (
              <button
                key={b.label}
                type="button"
                className={[b.primary && 'primary', b.destructive && 'destructive'].filter(Boolean).join(' ')}
                onClick={() => finish(b.value)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </>
      )}
    </dialog>
  );
}
