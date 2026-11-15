import "../../styles/ops.css";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { S } from "./ops-strings.ts";
import { Button } from "../ui/Button.tsx";
import { useModal } from "../useModal.ts";
import { Notice } from "../ui/Notice.tsx";
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
  const ref = useModal();
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        <label className="field field-block">
          <span className="field-label">{S.password}</span>
          <input name="password" type="password" autoComplete="current-password" required autoFocus className="input-block" />
        </label>
        {confirmWord && (
          <label className="field field-block">
            <span className="field-label">{S.rollbackConfirm(confirmWord)}</span>
            <input name="confirm" type="text" autoComplete="off" required pattern={confirmWord} className="input-block" />
          </label>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="form-row">
          <Button onClick={onCancel}>
            {S.cancel}
          </Button>
          <Button variant="primary" danger={danger} type="submit" busy={busy}>
            {busy ? S.working : submitLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
