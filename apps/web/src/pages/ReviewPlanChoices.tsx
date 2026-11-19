import { monthOf } from "@banking/core";
import { useState } from "react";
import { Button } from "../components/ui/Button.tsx";
import { t } from "../text.ts";
import { ChoiceButton } from "./review-buttons.tsx";
import { MAX_PLAN_PAYMENTS, planEnd } from "./review-items.ts";

/**
 * A plan's end: the payments left after the latest one (`lastDate`), or the month of the last one, or "En tiedä" (null).
 * The balance is never assumed.
 */
export function PlanChoices({ lastDate, busy, onEnd }: { lastDate: string; busy: boolean; onEnd: (endMonth: string | null) => void }) {
  const [left, setLeft] = useState("");
  const [month, setMonth] = useState("");
  // which save is on its way: only its button shows the wait
  const [sent, setSent] = useState<"count" | "month" | null>(null);
  const store = (endMonth: string | null, from: "count" | "month" | null = null) => {
    setSent(from);
    onEnd(endMonth);
  };
  const end = planEnd({ lastDate }, left);
  return (
    <div className="review-plan">
      <form
        className="review-plan-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (end) store(end, "count");
        }}
      >
        <label className="review-plan-field">
          <span>{t("set.rc.payments_left")}</span>
          <input type="number" min={1} max={MAX_PLAN_PAYMENTS} inputMode="numeric" value={left} disabled={busy} onChange={(e) => setLeft(e.target.value)} />
        </label>
        <Button className="review-choice" type="submit" disabled={busy || end === null} aria-busy={busy && sent === "count" ? true : undefined}>
          {t("set.rc.save")}
        </Button>
      </form>
      <form
        className="review-plan-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (month) store(month, "month");
        }}
      >
        <label className="review-plan-field">
          <span>{t("set.rc.last_month")}</span>
          <input type="month" min={monthOf(lastDate)} value={month} disabled={busy} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <Button className="review-choice" type="submit" disabled={busy || !month} aria-busy={busy && sent === "month" ? true : undefined}>
          {t("set.rc.save_month")}
        </Button>
      </form>
      <div className="review-choices">
        <ChoiceButton busy={busy} onClick={() => store(null)}>
          {t("set.rc.i_don_t_know")}
        </ChoiceButton>
      </div>
    </div>
  );
}
