import { creditPaidSubject } from "@banking/core";
import { type ReactNode, useState } from "react";
import { loanCalls } from "../api.ts";
import { date } from "../format.ts";
import { t } from "../text.ts";
import type { Meta } from "../types.ts";
import { ChoiceButton, mark } from "./review-buttons.tsx";
import type { LoanTermsDebt } from "./review-loan-items.ts";

/**
 * Payments to a lender that stopped (`ended`): were they a credit that is paid off, a card or credit still owed, or no
 * debt payment. Maksettu pois stops the question for good. A credit still owed shows `owed`, the form of a credit of
 * unknown kind.
 */
export function EndedChoices({ debt, meta, busy, onSend, owed }: { debt: LoanTermsDebt; meta: Meta; busy: boolean; onSend: (send: () => Promise<string>) => void; owed: ReactNode }) {
  const [stillOwed, setStillOwed] = useState(false);
  if (stillOwed) return owed;
  return (
    <>
      <p className="review-debt-ask">{t("set.rc.lt_ended", { name: debt.name, date: date(debt.lastDate ?? meta.today, meta.today) })}</p>
      <div className="review-choices">
        <ChoiceButton busy={busy} onClick={() => onSend(() => mark(creditPaidSubject(debt.key ?? ""), "in_use")().then(() => t("set.rc.lt_paid_off")))}>
          <span>{t("set.rc.lt_paid_off")}</span>
        </ChoiceButton>
        <ChoiceButton busy={busy} onClick={() => setStillOwed(true)}>
          <span>{t("set.rc.lt_still_owed")}</span>
        </ChoiceButton>
        <ChoiceButton busy={busy} onClick={() => onSend(() => loanCalls.notLoan(debt.key ?? "").then(() => t("set.rc.not_a_loan")))}>
          <span>{t("set.rc.not_a_loan")}</span>
        </ChoiceButton>
      </div>
    </>
  );
}
