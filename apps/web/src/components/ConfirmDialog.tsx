import { type ReactNode, useId } from "react";
import { t } from "../text.ts";
import { Button } from "./ui/Button.tsx";
import { useModal } from "./useModal.ts";

/**
 * The one way to ask before something that is hard to take back: a title that asks ("Poistetaanko X?"), a sentence on
 * what follows and two buttons, the confirm named for the act ("Poista X"). Escape or "Peruuta" cancels and the focus
 * goes back to the button that opened it; it starts on "Peruuta".
 */
export function ConfirmDialog({ title, children, confirmLabel, busy, onConfirm, onCancel }: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useModal();
  const titleId = useId();
  return (
    <dialog ref={ref} className="confirm" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <h2 id={titleId}>{title}</h2>
      {children}
      <div className="form-row">
        <Button autoFocus onClick={onCancel}>
          {t("form.cancel")}
        </Button>
        <Button variant="primary" danger busy={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
