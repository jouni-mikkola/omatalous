import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { S } from "./ops-strings.ts";

/**
 * Asks for the password again before a request that changes the installation. The value is read from the
 * field when the form is sent and is not kept in state. A typed confirmation word is optional.
 */
export function PasswordDialog({ title, children, submitLabel, confirmWord, danger, onSubmit, onCancel }: {
  title: string;
  children: ReactNode;
  submitLabel: string;
  confirmWord?: string;
  danger?: boolean;
  onSubmit: (password: string, confirm: string) => Promise<void>;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(form.current!);
    const password = String(data.get("password") ?? "");
    const confirm = String(data.get("confirm") ?? "");
    setBusy(true);
    setError(null);
    try {
      await onSubmit(password, confirm);
    } catch (err) {
      setError((err as Error).message);
      form.current?.reset();
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="confirm" aria-labelledby="ops-dialog-title" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <form ref={form} onSubmit={(e) => void send(e)} autoComplete="off">
        <h2 id="ops-dialog-title">{title}</h2>
        {children}
        <label className="field" style={{ display: "block", margin: "12px 0" }}>
          <span className="field-label">{S.password}</span>
          <input name="password" type="password" autoComplete="current-password" required autoFocus style={{ display: "block", width: "100%" }} />
        </label>
        {confirmWord && (
          <label className="field" style={{ display: "block", margin: "12px 0" }}>
            <span className="field-label">{S.rollbackConfirm(confirmWord)}</span>
            <input name="confirm" type="text" autoComplete="off" required pattern={confirmWord} style={{ display: "block", width: "100%" }} />
          </label>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="form-row">
          <button className="btn" type="button" onClick={onCancel}>
            {S.cancel}
          </button>
          <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} type="submit" disabled={busy} aria-busy={busy || undefined}>
            {busy ? S.working : submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
