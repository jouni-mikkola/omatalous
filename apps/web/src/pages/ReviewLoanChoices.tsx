/**
 * Täydennä lainat: every debt that lacks a balance or a payment, one row each, the largest payments first. A row writes
 * what is known of its debt in its heading and asks one thing: a loan the rows show, what it owes now (the rest of its
 * terms are edited at the loan); a card, whether it is paid in full each month, and its rate if not; a saved loan, the
 * payment fact its plan lacks. Each answer goes through its source's route. A saved row closes into its result line and the queue is read again, so the
 * figures at the top are the server's. When every row is answered the list shows what was saved and Seuraava moves on.
 */
import { type Fixings, type Loan, type LoanKind, loanTermsDismissible, type LoanTermsMissing, loanTermsResult, loanUnknownSubject, planSubject } from "@banking/core";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { api, loanCalls } from "../api.ts";
import { LoanEditor, LoanLinks } from "../components/loans/LoanEditor.tsx";
import { formOfCard, formOfLoan, formOfProposal, LOAN_LINK_PARAM, type LoanBody, type LoanForm, readForm } from "../components/loans/form.ts";
import { KIND_LABEL, type LoanFieldKey } from "../components/loans/labels.ts";
import { Button } from "../components/ui/Button.tsx";
import { Notice } from "../components/ui/Notice.tsx";
import { date, money, monthYear, percent } from "../format.ts";
import { useApi } from "../hooks.ts";
import { SETTINGS_ANCHOR, settingsCardHash, settingsHash } from "../routes.ts";
import { t } from "../text.ts";
import type { LoansAnswer, Meta } from "../types.ts";
import { ChoiceButton, mark } from "./review-buttons.tsx";
import { creditKindChoices } from "./review-items.ts";
import type { LoanTermsDebt, LoanTermsListItem } from "./review-loan-items.ts";
import { PlanChoices } from "./ReviewPlanChoices.tsx";

/**
 * The fields of the loan form that give the facts of a saved loan's plan the review asks. Its rate, reference rate,
 * margin and review day and its way of paying back are not asked here: they are edited at the loan.
 */
const ASKED_FOR: Partial<Record<LoanTermsMissing, LoanFieldKey[]>> = {
  interval: ["intervalMonths"],
  payment: ["paymentCents"],
  end_date: ["endDate"],
  fee: ["paymentFeeCents"],
};

const askedFor = (gaps: readonly LoanTermsMissing[]): LoanFieldKey[] => [...new Set(gaps.flatMap((gap) => ASKED_FOR[gap] ?? []))];

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

/**
 * What is known of a debt, written in its row's heading after the name. A loan the rows show has the kind they guess (a
 * credit of unknown kind has none yet) and its monthly payment: its one question is the balance.
 */
function factsOf(debt: LoanTermsDebt): string[] {
  const proposed = debt.source === "proposal";
  const due = debt.terms?.dueDate ?? debt.lastDate;
  const kindKnown = proposed ? debt.kindUnknown !== true : debt.placed && debt.source !== "card_bill";
  return [
    kindKnown && KIND_LABEL[debt.kind] !== debt.name ? KIND_LABEL[debt.kind] : null,
    debt.monthlyCents === null ? null : t("rpt.ln_per_month", { amount: money(debt.monthlyCents) }),
    due === null || proposed ? null : t("set.rc.lt_due_day", { day: Number(due.slice(8, 10)) }),
    debt.owedCents === null ? null : `${t("set.loans.remaining")} ${money(debt.owedCents)}`,
  ].filter((fact) => fact !== null);
}

/**
 * Links a loan saved with no link to the series of its payments: the loan counts as that card or credit, so its debt is
 * not saved twice and the series is no longer asked about. The loan goes back whole, as the loan form saves it.
 */
async function linkSavedLoan(loanId: string, seriesKey: string, gone: string): Promise<Loan> {
  const { loans, fixings } = await api<LoansAnswer>("/api/loans");
  const loan = loans.find((l) => l.id === loanId);
  if (!loan) throw new Error(gone);
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
      // a card's only gap is its rate, asked as whether it is paid in full each month
      return props.debt.gaps.includes("rate") ? <CardRow {...props} /> : <SavedRow {...props} />;
    case "proposal":
      return <ProposalRow {...props} />;
    case "plan":
      return <PlanChoices lastDate={props.debt.lastDate ?? props.meta.today} busy={props.busy} onEnd={(end) => props.onSend(() => mark(planSubject(end, props.debt.key ?? ""), "in_use")().then(() => (end === null ? t("set.rc.i_don_t_know") : t("set.rc.lt_ends", { date: monthYear(end) }))))} />;
    case "card_bill":
      return <CardBillRow {...props} />;
  }
}

/**
 * The one field a row asks, typed into `form` whose other fields stay as the rows gave them. Tallenna saves the loan;
 * `children` are the row's other answers, beside it.
 */
function FieldForm({ form, field, label, fixings, busy, onSave, children }: { form: LoanForm; field: "balanceCents" | "rateBp"; label: string; fixings: Fixings; busy: boolean; onSave: (body: LoanBody) => Promise<void>; children?: React.ReactNode }) {
  const id = useId();
  const [text, setText] = useState(form.values[field]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const { body, errors } = readForm({ ...form, values: { ...form.values, [field]: text } }, fixings);
    if (!body) {
      setError(errors[field] ?? Object.values(errors)[0] ?? "");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };
  return (
    <form className="review-field" onSubmit={(e) => void submit(e)} noValidate>
      <div className="loan-field">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        <input id={id} type="text" inputMode="decimal" autoComplete="off" value={text} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} onChange={(e) => setText(e.target.value)} />
        {error && (
          <span id={`${id}-error`} className="field-error" role="alert">
            {error}
          </span>
        )}
      </div>
      <div className="review-choices">
        <Button className="review-choice" variant="primary" type="submit" busy={saving} disabled={busy}>
          {t("set.rc.save")}
        </Button>
        {children}
      </div>
    </form>
  );
}

/** The loan form in a row, asking `ask` of `initial`. */
function RowForm({ initial, ask, answer, meta, onSave, onCancel, cancelLabel }: { initial: LoanForm; ask: LoanFieldKey[]; answer: LoansAnswer; meta: Meta; onSave: (body: Omit<Loan, "id">) => Promise<void>; onCancel: () => void; cancelLabel: string }) {
  return (
    <LoanLinks.Provider value={{ accounts: meta.accounts, loans: answer.loans, fixings: answer.fixings }}>
      <div className="review-loan">
        <LoanEditor initial={initial} today={meta.today} cancelLabel={cancelLabel} ask={ask} onSave={onSave} onCancel={onCancel} />
      </div>
    </LoanLinks.Provider>
  );
}

/**
 * A saved loan that lacks a fact of its plan: the loan's own form asks it. Älä muistuta tästä enää sets a loan aside,
 * except while its payment is missing, which keeps asking.
 */
function SavedRow({ debt, meta, answer, busy, onSend, onSaved }: RowProps) {
  const [key, setKey] = useState(0);
  const loan = debt.loanId === null ? undefined : answer.loans.find((l) => l.id === debt.loanId);
  const initial = loan ? formOfLoan(loan) : null;
  // the loan was deleted since the queue was read: the read after the next save leaves it out
  if (!loan || !initial) return null;
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
        onSave={async (body) => onSaved((await loanCalls.replace(loan.id, body)).loan)}
        // Peruuta empties what was typed: the row asks the same again
        onCancel={() => setKey((k) => k + 1)}
      />
      {debt.gaps.includes("fee") && (
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

/**
 * A card whose rate is unknown, connected or saved by hand: is it paid in full each month? Yes saves a rate of 0, which
 * costs no interest; no asks the rate, and nothing else of its terms. A card with no saved loan is saved as a new loan
 * linked to it, with the bank's balance and limit.
 */
function CardRow({ debt, meta, answer, busy, onSend, onSaved }: RowProps) {
  const [asking, setAsking] = useState(false);
  const loan = debt.loanId === null ? undefined : answer.loans.find((l) => l.id === debt.loanId);
  const card = meta.accounts.find((a) => a.id === debt.accountId);
  const initial = loan ? formOfLoan(loan) : card ? formOfCard(card, meta.today) : null;
  // the loan was deleted, or the card unlinked, since the queue was read: the read after the next save leaves it out
  if (!initial) return null;
  const save = (body: LoanBody) => (loan ? loanCalls.replace(loan.id, body) : loanCalls.add(body));
  const inFull = () =>
    onSend(async () => {
      const { body, errors } = readForm({ ...initial, values: { ...initial.values, rateBp: "0" } }, answer.fixings);
      if (!body) throw new Error(Object.values(errors)[0]);
      return resultLine((await save(body)).loan, answer.fixings, meta.today);
    });
  if (asking) {
    return (
      <FieldForm form={initial} field="rateBp" label={t("set.rc.lt_rate_pct")} fixings={answer.fixings} busy={busy} onSave={async (body) => onSaved((await save(body)).loan)}>
        <ChoiceButton busy={busy} onClick={() => setAsking(false)}>
          <span>{t("set.rc.cancel")}</span>
        </ChoiceButton>
      </FieldForm>
    );
  }
  return (
    <>
      <p className="review-debt-ask">{t("set.rc.lt_card_in_full")}</p>
      <div className="review-choices">
        <ChoiceButton busy={busy} onClick={inFull}>
          <span>{t("set.rc.lt_yes")}</span>
        </ChoiceButton>
        <ChoiceButton busy={busy} onClick={() => setAsking(true)}>
          <span>{t("set.rc.lt_no")}</span>
        </ChoiceButton>
      </div>
    </>
  );
}

/** The form of a loan filled from a debt's rows and linked to its series. */
function rowsForm(debt: LoanTermsDebt, kind: LoanKind, meta: Meta, answer: LoansAnswer, ownsAccount: boolean): LoanForm {
  const proposed = formOfProposal({ key: debt.key ?? "", payee: debt.name, paymentCents: debt.latestCents ?? 0, kind }, meta.today, ownsAccount ? meta.accounts : [], answer.loans, debt.terms);
  // a lender's few payments tell no monthly payment, and it is never saved as 0
  return debt.latestCents === null ? { ...proposed, values: { ...proposed.values, paymentCents: "" } } : proposed;
}

/**
 * A loan the rows show and nobody saved, with the kind the rows guess (changed at the loan's own form). Its one question
 * is what it owes now; the form saves it linked to its series, with what the rows tell of its terms. En tiedä puts the
 * loan away until its monthly payment changes, and Ei ole velan maksu keeps the series from being asked again. A credit
 * whose kind the rows do not tell picks the kind first, or the household tells it as a card or credit saved already with
 * no link.
 */
function ProposalRow({ debt, meta, answer, busy, onSend, onSaved, ownsAccount }: RowProps) {
  const [kind, setKind] = useState<LoanKind | null>(debt.kindUnknown ? null : debt.kind);
  const unknown = (
    <ChoiceButton busy={busy} onClick={() => onSend(() => mark(loanUnknownSubject(debt.monthlyCents, debt.key ?? ""), "in_use")().then(() => t("set.rc.i_don_t_know")))}>
      <span>{t("set.rc.i_don_t_know")}</span>
    </ChoiceButton>
  );
  const notLoan = (
    <ChoiceButton busy={busy} onClick={() => onSend(() => loanCalls.notLoan(debt.key ?? "").then(() => t("set.rc.not_a_loan")))}>
      <span>{t("set.rc.not_a_loan")}</span>
    </ChoiceButton>
  );
  return (
    <>
      {debt.kindUnknown && (
        <div className="review-choices" role="group" aria-label={t("set.rc.lt_kind")}>
          {creditKindChoices().map((c) => (
            <Button key={c.value} className={`review-choice${c.value === kind ? " is-guess" : ""}`} aria-pressed={c.value === kind} disabled={busy} onClick={() => setKind(c.value)}>
              <span>{c.label}</span>
            </Button>
          ))}
        </div>
      )}
      {debt.kindUnknown && debt.savedCards.length > 0 && (
        <div className="review-choices">
          <SavedLoanChoice debt={debt} answer={answer} meta={meta} busy={busy} onSend={onSend} already={t("set.rc.credit_already_saved")} open={t("set.rc.open_the_saved_credit")} gone={t("set.rc.saved_credit_gone")} />
        </div>
      )}
      {kind === null ? (
        <div className="review-choices">
          {unknown}
          {notLoan}
        </div>
      ) : (
        <FieldForm key={kind} form={rowsForm(debt, kind, meta, answer, ownsAccount)} field="balanceCents" label={t("set.rc.lt_left_now")} fixings={answer.fixings} busy={busy} onSave={async (body) => onSaved((await loanCalls.add(body)).loan)}>
          {unknown}
          {notLoan}
        </FieldForm>
      )}
    </>
  );
}

/**
 * The loans saved with no link that a debt may be (`savedCards`): the household tells which one by linking it to the
 * series, so its debt is not saved twice. With one such loan the choice links it and a link opens it; with several the
 * household picks one.
 */
function SavedLoanChoice({ debt, answer, meta, busy, onSend, already, open, gone }: Pick<RowProps, "debt" | "answer" | "meta" | "busy" | "onSend"> & { already: string; open: string; gone: string }) {
  const [picking, setPicking] = useState(false);
  const link = (id: string) => onSend(async () => resultLine(await linkSavedLoan(id, debt.key ?? "", gone), answer.fixings, meta.today));
  const [only] = debt.savedCards.length === 1 ? debt.savedCards : [];
  return (
    <>
      <ChoiceButton busy={busy} onClick={() => (only ? link(only.id) : setPicking(true))}>
        {already}
      </ChoiceButton>
      {picking &&
        debt.savedCards.map((loan) => (
          <ChoiceButton key={loan.id} busy={busy} onClick={() => link(loan.id)}>
            {loan.name}
          </ChoiceButton>
        ))}
      {only && (
        <Button className="review-choice" href={settingsCardHash(SETTINGS_ANCHOR.loans, new URLSearchParams({ [LOAN_LINK_PARAM.loan]: only.id }))}>
          {open}
        </Button>
      )}
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
  if (saving) {
    return (
      <FieldForm form={rowsForm(debt, "card", meta, answer, ownsAccount)} field="balanceCents" label={t("set.rc.lt_left_now")} fixings={answer.fixings} busy={busy} onSave={async (body) => onSaved((await loanCalls.add(body)).loan)}>
        <ChoiceButton busy={busy} onClick={() => setSaving(false)}>
          <span>{t("set.rc.cancel")}</span>
        </ChoiceButton>
      </FieldForm>
    );
  }
  return (
    <div className="review-choices">
      <Button className="review-choice" href={settingsHash("banks")}>
        {t("set.rc.connect_the_card")}
      </Button>
      <ChoiceButton busy={busy} onClick={() => setSaving(true)}>
        {t("set.rc.enter_the_card_debt")}
      </ChoiceButton>
      {debt.savedCards.length > 0 && <SavedLoanChoice debt={debt} answer={answer} meta={meta} busy={busy} onSend={onSend} already={t("set.rc.card_already_saved")} open={t("set.rc.open_the_saved_card")} gone={t("set.rc.saved_card_gone")} />}
    </div>
  );
}
