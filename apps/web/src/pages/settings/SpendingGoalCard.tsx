// Decision: how much the household lets itself spend in a month; the chart of Yhteenveto draws the line and the sentence under it
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../../api.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { eurosText, money, parseEuros } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { SETTINGS_ANCHOR } from "../../routes.ts";
import { t } from "../../text.ts";

/** Asetukset > Talous: the one monthly spending goal, set, changed and removed here. Dashboard reads it back on its next load. */
export function SpendingGoalCard({ onLoaded }: { onLoaded?: () => void }) {
  const stored = useApi<{ monthlyCents: number | null }>("/api/spending-goal");
  const loaded = stored.data !== null || stored.error !== null;
  useEffect(() => {
    if (loaded) onLoaded?.();
  }, [loaded, onLoaded]);
  const cents = stored.data?.monthlyCents ?? null;
  const [text, setText] = useState("");
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "warning"; text: string } | null>(null);
  useEffect(() => setText(cents === null ? "" : eurosText(cents)), [cents]);

  const run = async (call: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await call();
      setMessage({ tone: "good", text: done });
      stored.reload();
    } catch (e) {
      setMessage({ tone: "warning", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    const monthlyCents = parseEuros(text);
    if (monthlyCents === null || monthlyCents < 100) return setMessage({ tone: "warning", text: t("home.goal_enter") });
    void run(() => api("/api/spending-goal", { method: "PUT", body: { monthlyCents } }), t("home.goal_saved", { sum: money(monthlyCents, false) }));
  };
  const remove = () => {
    setRemoving(false);
    void run(() => api("/api/spending-goal", { method: "DELETE" }), t("home.goal_removed"));
  };

  return (
    <div className="card" id={SETTINGS_ANCHOR.goal}>
      <div className="card-head">
        <div>
          <h2>{t("home.goal_form")}</h2>
          <p className="muted">{t("home.goal_card_intro")}</p>
        </div>
      </div>
      {stored.error && <Notice tone="error">{stored.error}</Notice>}
      {message && (
        <Notice tone={message.tone} role="status">
          {message.text}
        </Notice>
      )}
      <form className="form-row" aria-label={t("home.goal_form")} onSubmit={save}>
        <label>
          <span className="field-label">{t("home.goal_field")}</span>{" "}
          <input type="text" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder="2 500" />
        </label>
        <Button variant="primary" type="submit" busy={busy}>
          {t("ui.save")}
        </Button>
        {cents !== null && (
          <Button variant="link" onClick={() => setRemoving(true)} busy={busy}>
            {t("home.goal_remove")}
          </Button>
        )}
      </form>
      {removing && (
        <ConfirmDialog title={t("home.goal_remove_q")} confirmLabel={t("home.goal_remove")} onConfirm={remove} onCancel={() => setRemoving(false)}>
          <p>{t("home.goal_remove_text")}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
