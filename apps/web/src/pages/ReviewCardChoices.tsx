/**
 * The answers of a card's row in Täydennä lainat: a card the household pays and has not connected (`card_bill`), and a
 * card whose purchases are missing (`card_gap`). One that is not connected is connected, saved as a loan of kind card or
 * has its statement added; a connected one has its statement added, since its debt is the account's. En tiedä sets the
 * card aside until its monthly bill, or the sum of its missing bills, rises (core `cardUnknownAsked`).
 */
import { loanUnknownSubject } from "@banking/core";
import { Button } from "../components/ui/Button.tsx";
import { date, money } from "../format.ts";
import { CONNECT_BANK_HASH, SETTINGS_ANCHOR, settingsCardHash } from "../routes.ts";
import { t } from "../text.ts";
import { ChoiceButton, mark } from "./review-buttons.tsx";
import type { LoanTermsDebt } from "./review-loan-items.ts";

/** What a card whose purchases are missing writes in its row's heading: the sum of the bills that pay them and the day its rows begin, each only when known. */
export function cardGapFacts(debt: LoanTermsDebt): string[] {
  if (!debt.missing) return [];
  const { cents, since } = debt.missing;
  return [cents === null ? null : t("set.rc.card_bills_year", { amount: money(cents) }), since === null ? null : t("set.rc.card_rows_from", { date: date(since) })].filter((fact) => fact !== null);
}

/** The card's answers; `onDebt` opens the form of its debt and `children` are the row's other answers. */
export function CardChoices({ debt, busy, onSend, onDebt, children }: { debt: LoanTermsDebt; busy: boolean; onSend: (send: () => Promise<string>) => void; onDebt: () => void; children?: React.ReactNode }) {
  const connected = debt.accountId !== null;
  // the figure En tiedä is said at: the card's monthly bill, or the sum of its missing bills
  const cents = debt.missing ? debt.missing.cents : debt.monthlyCents;
  return (
    <div className="review-choices">
      {!connected && (
        <Button className="review-choice" href={CONNECT_BANK_HASH}>
          {t("set.rc.connect_the_card")}
        </Button>
      )}
      {!connected && (
        <ChoiceButton busy={busy} onClick={onDebt}>
          {t("set.rc.add_the_card_debt")}
        </ChoiceButton>
      )}
      <Button className="review-choice" href={settingsCardHash(SETTINGS_ANCHOR.statement)}>
        {t("set.rc.add_the_statement")}
      </Button>
      <ChoiceButton busy={busy} onClick={() => onSend(() => mark(loanUnknownSubject(cents, debt.key ?? ""), "in_use")().then(() => t("set.rc.i_don_t_know")))}>
        <span>{t("set.rc.i_don_t_know")}</span>
      </ChoiceButton>
      {children}
    </div>
  );
}
