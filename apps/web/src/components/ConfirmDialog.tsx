import { type ReactNode, useEffect, useRef } from "react";

/** A modal question with two buttons. Escape or "Peruuta" cancels; focus starts on the cancel button. */
export function ConfirmDialog({ title, children, confirmLabel, busy, onConfirm, onCancel }: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} className="confirm" aria-labelledby="confirm-title" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <h2 id="confirm-title">{title}</h2>
      {children}
      <div className="form-row">
        <button className="btn" type="button" autoFocus onClick={onCancel}>
          Peruuta
        </button>
        <button className="btn btn-danger" type="button" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
