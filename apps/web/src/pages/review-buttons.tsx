/** The buttons every kind of Tarkistettavat choice is made of, and the user mark an answer stores. */
import { useState } from "react";
import { api } from "../api.ts";
import { Button } from "../components/ui/Button.tsx";
import { t } from "../text.ts";
import type { Choice } from "./review-items.ts";

/** One large button. It carries the wait while its own answer is on its way; the others are only held. */
export function ChoiceButton({ primary = false, className = "review-choice", busy, label, onClick, children }: { primary?: boolean; className?: string; busy: boolean; label?: string; onClick: () => void; children: React.ReactNode }) {
  const [pressed, setPressed] = useState(false);
  if (pressed && !busy) setPressed(false);
  return (
    <Button
      className={`${className}${primary ? " is-guess" : ""}`}
      disabled={busy}
      aria-busy={(busy && pressed) || undefined}
      aria-label={label}
      onClick={() => {
        setPressed(true);
        onClick();
      }}
    >
      {children}
    </Button>
  );
}

/** The large buttons, the guess first and marked. */
export function Buttons<T>({ choices, busy, label, onPick }: { choices: Choice<T>[]; busy: boolean; label: (c: Choice<T>) => string; onPick: (value: T) => void }) {
  return (
    <div className="review-choices">
      {choices.map((c) => (
        <ChoiceButton key={c.label} primary={c.guess} busy={busy} label={label(c)} onClick={() => onPick(c.value)}>
          <span>{c.label}</span> {c.guess && <span className="review-guess">{t("set.rc.suggestion")}</span>}
        </ChoiceButton>
      ))}
    </div>
  );
}

export const plain = <T,>(label: string, value: T): Choice<T> => ({ value, label, guess: false });

/** A user mark, as each source's own answer stores it. */
export const mark = (subject: string, value: string) => () => api("/api/marks", { method: "PUT", body: { subject, mark: value } });
