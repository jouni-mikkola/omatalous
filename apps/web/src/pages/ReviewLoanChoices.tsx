/**
 * Täydennä lainat: every debt that lacks a balance, a rate or a payment, one row each, the largest payments first. A row
 * writes what is known of its debt in its heading and asks only the rest, with the form Asetukset > Lainat opens; each
 * answer goes through its source's route. A saved row closes into its result line and the queue is read again, so the
 * figures at the top are the server's. When every row is answered the list shows what was saved and Seuraava moves on.
 */
import { type Fixings, type Loan, type LoanKind, loanTermsDismissible, type LoanTermsMissing, loanTermsResult, planSubject } from "@banking/core";
import { useEffect, useRef, useState } from "react";
import { api, loanCalls } from "../api.ts";
import { LoanEditor, LoanLinks } from "../components/loans/LoanEditor.tsx";
import { formOfCard, formOfLoan, formOfProposal, isCredit, LOAN_LINK_PARAM, type LoanForm, readForm, shownFields } from "../components/loans/form.ts";
import { KIND_LABEL, type LoanFieldKey } from "../components/loans/labels.ts";
import { Button } from "../components/ui/Button.tsx";
import { Notice } from "../components/ui/Notice.tsx";
import { date, money, monthYear, percent } from "../format.ts";
import { useApi } from "../hooks.ts";
import { SETTINGS_ANCHOR, settingsCardHash, settingsHash } from "../routes.ts";
import { t } from "../text.ts";
import type { LoansAnswer, Meta } from "../types.ts";
import { ChoiceButton, mark } from "./review-buttons.tsx";
import { loanKindChoices } from "./review-items.ts";
import type { LoanTermsDebt, LoanTermsListItem } from "./review-loan-items.ts";
import { PlanChoices } from "./ReviewPlanChoices.tsx";

/** The fields of the loan form that give the facts a saved loan or a card lacks: the row asks these, and "Näytä kaikki kentät" opens the rest. */
const ASKED_FOR: Record<LoanTermsMissing, LoanFieldKey[]> = {
  repayment: ["repayment"],
  interval: ["intervalMonths"],
  payment: ["paymentCents"],
  rate: ["rateBp", "reference", "marginBp"],
  end_date: ["endDate"],
  margin: ["marginBp"],
  review_date: ["rateReviewDate"],
  fee: ["paymentFeeCents"],
};

const askedFor = (gaps: readonly LoanTermsMissing[]): LoanFieldKey[] => [...new Set(gaps.flatMap((gap) => ASKED_FOR[gap]))];

/**
 * What a debt of the rows still asks: the rate, the way of paying back and the amount granted (the limit of a card or
 * credit line), the balance only where no connected loan account told it, and the payment where the rows told none a
 * month. The rows gave the rest. A loan's rate is asked with its reference rate and, on a euribor, its review day (filled
 * from the cycle the payments step at, when they show one), as the rate in force is counted from that day's fixing; the
 * margin then stands in for the rate (`LoanEditor`).
 */
function proposalAsk(form: LoanForm, noMonthly: boolean): LoanFieldKey[] {
  const own = shownFields(form).filter((key) => key === "grantedCents" || key === "limitCents" || key === "rateBp" || key === "repayment" || ((key === "reference" || key === "rateReviewDate") && !isCredit(form.kind)) || (key === "paymentCents" && noMonthly));
  return form.values.balanceCents === "" ? ["balanceCents", ...own] : own;
}

/** The line a saved loan's row closes into: what it owes, its rate now, its last instalment and the interest left, as core counts them. */
function resultLine(loan: Loan, fixings: Fixings, today: string): string {
  const r = loanTermsResult(loan, fixings, today);
  return [
    `${t("set.loans.remaining")} ${money(r.owedCents)}`,
    r.rateMilli === null ? null : t("set.rc.lt_rate", { rate: percent(r.rateMilli / 100_000, 2) }),
    r.endDate === null ? null : t("set.rc.lt_ends", { date: date(r.endDate, today) }),
    r.interestLeftCents === null ? null : t("set.rc.lt_interest", { amount: money(r.interestLeftCents) }),
    r.feeCents === null ? null : t("set.rc.lt_fee", { amount: money(r.feeCents) }),
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/** What is known of a debt, written in its row's heading after the name. */
function factsOf(debt: LoanTermsDebt): string[] {
  const due = debt.terms?.dueDate ?? debt.lastDate;
  return [
    debt.placed && debt.source !== "card_bill" && KIND_LABEL[debt.kind] !== debt.name ? KIND_LABEL[debt.kind] : null,
    debt.monthlyCents === null ? null : t("rpt.ln_per_month", { amount: money(debt.monthlyCents) }),
    due === null ? null : t("set.rc.lt_due_day", { day: Number(due.slice(8, 10)) }),
    debt.owedCents === null ? null : `${t("set.loans.remaining")} ${money(debt.owedCents)}`,
  ].filter((fact) => fact !== null);
}

/**
 * Links a card loan saved with no link to the series of the card's bills: the loan counts as that card, so its debt is
 * not saved twice and the series is no longer asked about. The loan goes back whole, as the loan form saves it.
 */
async function linkSavedCard(loanId: string, seriesKey: string): Promise<Loan> {
  const { loans, fixings } = await api<LoansAnswer>("/api/loans");
  const loan = loans.find((l) => l.id === loanId);
  if (!loan) throw new Error(t("set.rc.saved_card_gone"));
  const { body, errors } = readForm({ ...formOfLoan(loan), seriesKey }, fixings);
  if (!body) throw new Error(Object.values(errors)[0]);
  return (await loanCalls.replace(loanId, body)).loan;
}

interface Closed {
  id: string;
  name: string;
  line: string;
}

interface RowProps {
  debt: LoanTermsDebt;
  meta: Meta;
  answer: LoansAnswer;
  /** Another row's answer is on its way, or the page's. */
  busy: boolean;
  /** Sends a row's answer that is not the form's; it resolves to the line the row closes into. */
  onSend: (send: () => Promise<string>) => void;
  /** A loan the row's form saved. */
  onSaved: (loan: Loan) => void;
  /** The row's form may take the one connected loan account with no loan: only when no other row of the list could take it too. */
  ownsAccount: boolean;
}

export function LoanTermsChoices({ item, meta, busy, onAnswer, onHold, onReload }: { item: LoanTermsListItem; meta: Meta; busy: boolean; onAnswer: (send: () => Promise<unknown>) => void; onHold: () => void; onReload: () => void }) {
  const loans = useApi<LoansAnswer>("/api/loans");
  const [closed, setClosed] = useState<Closed[]>([]);
  // the rows keep the place they had when the list opened; a debt the queue read again no longer lists, unanswered here, is gone
  const [order, setOrder] = useState<string[]>(() => item.debts.map((d) => d.id));
  const [sending, setSending] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; message: string } | null>(null);
  const lastClosed = useRef<HTMLParagraphElement>(null);
  const next = useRef<HTMLDivElement>(null);
  const fresh = item.debts.filter((d) => !order.includes(d.id));
  if (fresh.length > 0) setOrder([...order, ...fresh.map((d) => d.id)]);
  const open = item.debts.filter((d) => !closed.some((c) => c.id === d.id));
  const done = open.length === 0;
  // forms filled from rows share the connected loan accounts: with two of them in the list, neither takes one by itself
  const fromRows = (debts: readonly LoanTermsDebt[]) => debts.filter((d) => d.source === "proposal" || d.source === "card_bill").length;
  const [oneAtOpen] = useState(() => fromRows(item.debts) <= 1);
  const ownsAccount = oneAtOpen && fromRows(open) <= 1;

  // the form that had the focus is gone: the focus goes to the line it closed into, or to Seuraava at the end
  useEffect(() => {
    if (closed.length === 0) return;
    if (done) next.current?.querySelector<HTMLElement>("button")?.focus();
    else lastClosed.current?.focus();
  }, [closed.length, done]);

  const close = (debt: LoanTermsDebt, line: string) => {
    // the item stays shown though the queue read again may lack it, until Seuraava
    onHold();
    setClosed((c) => [...c, { id: debt.id, name: debt.name, line }]);
    loans.reload();
    onReload();
  };
  const send = (debt: LoanTermsDebt) => (call: () => Promise<string>) => {
    if (sending) return;
    setSending(debt.id);
    setProblem(null);
    call().then(
      (line) => close(debt, line),
      (err: Error) => setProblem({ id: debt.id, message: err.message }),
    ).finally(() => setSending(null));
  };

  return (
    <div className="review-debts">
      <p className="review-debt-totals" aria-live="polite">
        {!done && (
          <span>
            {t(item.noBalance > 0 ? "holdings.debts_known" : "holdings.debts_total")} {item.debtsCents === null ? "–" : money(item.debtsCents)}
          </span>
        )}
        <span>{t("set.rc.lt_no_balance", { count: done ? 0 : item.noBalance })}</span>
      </p>
      {loans.error && !loans.data && (
        <Notice tone="error" className="review-error" as="p">
          {loans.error}
        </Notice>
      )}
      <ul className="review-debt-list">
        {order.map((id) => {
          const shut = closed.find((c) => c.id === id);
          if (shut) {
            return (
              <li key={id} className="review-debt is-done">
                <h3 className="review-debt-name">{shut.name}</h3>
                <p className="review-debt-result" tabIndex={-1} ref={closed.at(-1)?.id === id ? lastClosed : undefined}>
                  {shut.line}
                </p>
              </li>
            );
          }
          const debt = open.find((d) => d.id === id);
          if (!debt) return null;
          const facts = factsOf(debt);
          return (
            <li key={id} className="review-debt">
              <h3 className="review-debt-name">
                {debt.name}
                {facts.length > 0 && <span className="review-debt-facts"> · {facts.join(" · ")}</span>}
              </h3>
              {loans.data && <DebtRow debt={debt} meta={meta} answer={loans.data} ownsAccount={ownsAccount} busy={busy || sending !== null} onSend={send(debt)} onSaved={(loan) => close(debt, resultLine(loan, loans.data?.fixings ?? {}, meta.today))} />}
              {problem?.id === id && (
                <Notice tone="error" className="review-error" as="p">
                  {problem.message}
                </Notice>
              )}
            </li>
          );
        })}
      </ul>
      {done && (
        <div className="review-choices" ref={next}>
          <ChoiceButton busy={busy} onClick={() => onAnswer(async () => undefined)}>
            <span>{t("set.rc.next")}</span>
          </ChoiceButton>
        </div>
      )}
    </div>
  );
}

/** One debt's inputs, by where it comes from. */
function DebtRow(props: RowProps) {
  switch (props.debt.source) {
    case "loan":
    case "card":
      return <SavedRow {...props} />;
    case "proposal":
      return <ProposalRow {...props} />;
    case "plan":
      return <PlanChoices lastDate={props.debt.lastDate ?? props.meta.today} busy={props.busy} onEnd={(end) => props.onSend(() => mark(planSubject(end, props.debt.key ?? ""), "in_use")().then(() => (end === null ? t("set.rc.i_don_t_know") : t("set.rc.lt_ends", { date: monthYear(end) }))))} />;
    case "card_bill":
      return <CardBillRow {...props} />;
  }
}

/** The loan form in a row, asking `ask` of `initial`; the label of an asked balance names the day it is of. */
function RowForm({ initial, ask, answer, meta, onSave, onCancel, cancelLabel }: { initial: LoanForm; ask: LoanFieldKey[]; answer: LoansAnswer; meta: Meta; onSave: (body: Omit<Loan, "id">) => Promise<void>; onCancel: () => void; cancelLabel: string }) {
  return (
    <LoanLinks.Provider value={{ accounts: meta.accounts, loans: answer.loans, fixings: answer.fixings }}>
      <div className="review-loan">
        <LoanEditor initial={initial} today={meta.today} cancelLabel={cancelLabel} ask={ask} balanceOn onSave={onSave} onCancel={onCancel} />
      </div>
    </LoanLinks.Provider>
  );
}

/**
 * A saved loan that lacks a fact, or a connected card whose rate is unknown. The loan's own form asks the facts; a card
 * with no saved loan gets the form of a new loan linked to it, filled with the bank's balance and limit. Älä muistuta
 * tästä enää sets a loan aside, except while its rate or payment is missing, which keep asking.
 */
function SavedRow({ debt, meta, answer, busy, onSend, onSaved }: RowProps) {
  const [key, setKey] = useState(0);
  const loan = debt.loanId === null ? undefined : answer.loans.find((l) => l.id === debt.loanId);
  const card = meta.accounts.find((a) => a.id === debt.accountId);
  const initial = loan ? formOfLoan(loan) : card ? formOfCard(card, meta.today) : null;
  // the loan was deleted, or the card unlinked, since the queue was read: the read after the next save leaves it out
  if (!initial) return null;
  const dismissible = debt.subject !== null && debt.gaps.every(loanTermsDismissible);
  // a plan at 0 % with no fee told: "0 €" saves the loan with a fee of nothing, as typing 0 does
  const noFee = (saved: Loan) =>
    onSend(async () => {
      const { body, errors } = readForm({ ...initial, values: { ...initial.values, paymentFeeCents: "0" } }, answer.fixings);
      if (!body) throw new Error(Object.values(errors)[0]);
      return resultLine((await loanCalls.replace(saved.id, body)).loan, answer.fixings, meta.today);
    });
  return (
    <>
      <RowForm
        key={key}
        initial={initial}
        ask={askedFor(debt.gaps)}
        answer={answer}
        meta={meta}
        cancelLabel={t("set.rc.cancel")}
        onSave={async (body) => onSaved((await (loan ? loanCalls.replace(loan.id, body) : loanCalls.add(body))).loan)}
        // Peruuta empties what was typed: the row asks the same again
        onCancel={() => setKey((k) => k + 1)}
      />
      {loan && debt.gaps.includes("fee") && (
        <div className="review-choices">
          <ChoiceButton busy={busy} onClick={() => noFee(loan)}>
            <span>{money(0, false)}</span>
          </ChoiceButton>
        </div>
      )}
      {dismissible && (
        <div className="review-choices">
          <ChoiceButton busy={busy} onClick={() => onSend(() => mark(debt.subject!, "dismissed")().then(() => t("set.rc.lt_set_aside")))}>
            <span>{t("set.rc.do_not_remind_of_this")}</span>
          </ChoiceButton>
        </div>
      )}
    </>
  );
}

/** The form of a loan filled from a debt's rows and linked to its series. */
function rowsForm(debt: LoanTermsDebt, kind: LoanKind, meta: Meta, answer: LoansAnswer, ownsAccount: boolean): { initial: LoanForm; ask: LoanFieldKey[] } {
  const noMonthly = debt.latestCents === null;
  const proposed = formOfProposal({ key: debt.key ?? "", payee: debt.name, paymentCents: debt.latestCents ?? 0, kind }, meta.today, ownsAccount ? meta.accounts : [], answer.loans, debt.terms);
  // a lender's few payments tell no monthly payment: the household types that
  const initial = noMonthly ? { ...proposed, values: { ...proposed.values, paymentCents: "" } } : proposed;
  return { initial, ask: proposalAsk(initial, noMonthly) };
}

/**
 * A loan the rows show and nobody saved. A kind the rows only suggest is asked first, the guess picked; the form follows
 * with that kind and saves the loan linked to its series. Ei ole laina keeps the series from being asked again.
 */
function ProposalRow({ debt, meta, answer, busy, onSend, onSaved, ownsAccount }: RowProps) {
  const [kind, setKind] = useState<LoanKind>(debt.kind);
  const [key, setKey] = useState(0);
  const { initial, ask } = rowsForm(debt, kind, meta, answer, ownsAccount);
  const notLoan = (
    <ChoiceButton busy={busy} onClick={() => onSend(() => loanCalls.notLoan(debt.key ?? "").then(() => t("set.rc.not_a_loan")))}>
      <span>{t("set.rc.not_a_loan")}</span>
    </ChoiceButton>
  );
  return (
    <>
      {!debt.placed && (
        <div className="review-choices" role="group" aria-label={t("set.rc.lt_kind")}>
          {loanKindChoices(debt).map((c) => (
            <Button key={c.value} className={`review-choice${c.value === kind ? " is-guess" : ""}`} aria-pressed={c.value === kind} disabled={busy} onClick={() => setKind(c.value)}>
              <span>{c.label}</span> {c.guess && <span className="review-guess">{t("set.rc.suggestion")}</span>}
            </Button>
          ))}
          {notLoan}
        </div>
      )}
      <RowForm key={`${kind}:${key}`} initial={initial} ask={ask} answer={answer} meta={meta} cancelLabel={t("set.rc.cancel")} onSave={async (body) => onSaved((await loanCalls.add(body)).loan)} onCancel={() => setKey((k) => k + 1)} />
      {debt.placed && <div className="review-choices">{notLoan}</div>}
    </>
  );
}

/**
 * A card the household pays and has not connected: connect it where the connections are, or save what it owes as a loan
 * of kind card, linked to its bills. A card already saved under Lainat with no link is told by linking that loan to the
 * series, so its debt is not saved twice; with several such loans the household says which one it is.
 */
function CardBillRow({ debt, meta, answer, busy, onSend, onSaved, ownsAccount }: RowProps) {
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  if (saving) {
    const { initial, ask } = rowsForm(debt, "card", meta, answer, ownsAccount);
    return <RowForm initial={initial} ask={ask} answer={answer} meta={meta} cancelLabel={t("set.rc.cancel")} onSave={async (body) => onSaved((await loanCalls.add(body)).loan)} onCancel={() => setSaving(false)} />;
  }
  const link = (id: string) => onSend(async () => resultLine(await linkSavedCard(id, debt.key ?? ""), answer.fixings, meta.today));
  const [only] = debt.savedCards.length === 1 ? debt.savedCards : [];
  return (
    <div className="review-choices">
      <Button className="review-choice" href={settingsHash("banks")}>
        {t("set.rc.connect_the_card")}
      </Button>
      <ChoiceButton busy={busy} onClick={() => setSaving(true)}>
        {t("set.rc.enter_the_card_debt")}
      </ChoiceButton>
      {debt.savedCards.length > 0 && (
        <ChoiceButton busy={busy} onClick={() => (only ? link(only.id) : setPicking(true))}>
          {t("set.rc.card_already_saved")}
        </ChoiceButton>
      )}
      {picking &&
        debt.savedCards.map((card) => (
          <ChoiceButton key={card.id} busy={busy} onClick={() => link(card.id)}>
            {card.name}
          </ChoiceButton>
        ))}
      {only && (
        <Button className="review-choice" href={settingsCardHash(SETTINGS_ANCHOR.loans, new URLSearchParams({ [LOAN_LINK_PARAM.loan]: only.id }))}>
          {t("set.rc.open_the_saved_card")}
        </Button>
      )}
    </div>
  );
}
