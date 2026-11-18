/**
 * The choices of the questions about a debt: a loan's kind, and a card the household pays and has not connected. Each
 * answer goes through its source's route, and a loan is saved with the form Asetukset > Lainat opens.
 */
import { LOAN_KIND_ANSWERS, type Loan, type LoanKind, loanKindSubject } from "@banking/core";
import { useEffect, useRef, useState } from "react";
import { api, loanCalls } from "../api.ts";
import { LoanEditor, LoanLinks } from "../components/loans/LoanEditor.tsx";
import { formOfLoan, formOfProposal, isCredit, LOAN_LINK_PARAM, type LoanForm, readForm, shownFields } from "../components/loans/form.ts";
import type { LoanFieldKey } from "../components/loans/labels.ts";
import { KeyValue } from "../components/table/KeyValue.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Notice } from "../components/ui/Notice.tsx";
import { money, percent } from "../format.ts";
import { useApi } from "../hooks.ts";
import { SETTINGS_ANCHOR, settingsCardHash, settingsHash } from "../routes.ts";
import { t } from "../text.ts";
import type { LoanProposalRow, LoansAnswer, Meta } from "../types.ts";
import { Buttons, ChoiceButton, mark, plain } from "./review-buttons.tsx";
import { loanKindChoices, type ReviewItem } from "./review-items.ts";

/**
 * What a proposal still asks: the rate, the way of paying back and the amount granted (the limit of a card or credit
 * line), the balance only where no connected loan account told it, and the payment where the rows told none a month.
 * The rows gave the rest. A loan's rate is asked with its reference rate and, on a euribor, its review day (filled from
 * the cycle the payments step at, when they show one), as the rate in force is counted from that day's fixing; the
 * margin then stands in for the rate (`LoanEditor`).
 */
function proposalAsk(form: LoanForm, noMonthly: boolean): LoanFieldKey[] {
  const own = shownFields(form).filter((key) => key === "grantedCents" || key === "limitCents" || key === "rateBp" || key === "repayment" || ((key === "reference" || key === "rateReviewDate") && !isCredit(form.kind)) || (key === "paymentCents" && noMonthly));
  return form.values.balanceCents === "" ? ["balanceCents", ...own] : own;
}

/**
 * A loan just saved from a proposal, in the place of its form: the rate it counts at now (on a euribor the one counted
 * from the fixing and the margin) and its balance, as the server saved them. Seuraava moves on.
 */
function LoanSaved({ loan, busy, onNext }: { loan: Loan; busy: boolean; onNext: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  // the form that had the focus is gone: the focus goes to the one button left
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);
  return (
    <div className="review-loan" ref={box}>
      <KeyValue items={[...(loan.rateBp === null ? [] : [[t("set.rc.rate_now"), percent(loan.rateBp / 10_000, 2)] as const]), [t("set.loans.remaining"), money(loan.balanceCents)]]} />
      <div className="review-choices">
        <ChoiceButton busy={busy} onClick={onNext}>
          <span>{t("set.rc.next")}</span>
        </ChoiceButton>
      </div>
    </div>
  );
}

/**
 * The form of a loan filled from a proposal's rows and linked to its series. Once the loan is saved its figures show in
 * the place of the form until Seuraava; the item is held before the save, as the queue is read again once it lands.
 */
function ProposalForm({ item, kind, meta, answer, busy, onAnswer, onHold, onCancel }: { item: Extract<ReviewItem, { kind: "loan" | "card_bill" }>; kind: LoanKind; meta: Meta; answer: LoansAnswer; busy: boolean; onAnswer: (send: () => Promise<unknown>) => void; onHold: () => void; onCancel: () => void }) {
  const [saved, setSaved] = useState<Loan | null>(null);
  if (saved) return <LoanSaved loan={saved} busy={busy} onNext={() => onAnswer(async () => undefined)} />;
  // the item carries the proposal's own fields, so the row is the item with the kind picked
  const row: LoanProposalRow = { ...item, kind };
  const noMonthly = item.kind === "loan" && item.noMonthly === true;
  const proposed = formOfProposal(row, meta.today, meta.accounts, answer.loans, item.kind === "loan" ? item.terms : null);
  // the latest of a lender's few payments is no monthly payment: the household types that
  const initial = noMonthly ? { ...proposed, values: { ...proposed.values, paymentCents: "" } } : proposed;
  return (
    <LoanLinks.Provider value={{ accounts: meta.accounts, loans: answer.loans, fixings: answer.fixings }}>
      <div className="review-loan">
        <LoanEditor
          initial={initial}
          today={meta.today}
          cancelLabel={t("set.rc.cancel")}
          ask={proposalAsk(initial, noMonthly)}
          onSave={async (body) => {
            // the editor shows its own error; the page moves on only after the loan is saved
            onHold();
            setSaved((await loanCalls.add(body)).loan);
          }}
          onCancel={onCancel}
        />
      </div>
    </LoanLinks.Provider>
  );
}

/**
 * Links a card loan saved with no link to the series of the card's bills: the loan counts as that card, so its debt is
 * not saved twice and the series is no longer asked about. The loan goes back whole, as the loan form saves it.
 */
async function linkSavedCard(loanId: string, seriesKey: string): Promise<void> {
  const { loans, fixings } = await api<LoansAnswer>("/api/loans");
  const loan = loans.find((l) => l.id === loanId);
  if (!loan) throw new Error(t("set.rc.saved_card_gone"));
  const { body, errors } = readForm({ ...formOfLoan(loan), seriesKey }, fixings);
  if (!body) throw new Error(Object.values(errors)[0]);
  await loanCalls.replace(loanId, body);
}

/**
 * A card the household pays and has not connected: connect it where the connections are, or save what it owes as a loan
 * of kind card, linked to its bills. A card already saved under Lainat with no link is told by linking that loan to the
 * series, so its debt is not saved twice and the household's other cards stay asked; with several such loans the household
 * says which one it is. The item goes when any is done.
 */
export function CardBillChoices({ item, meta, busy, onAnswer, onHold }: { item: Extract<ReviewItem, { kind: "card_bill" }>; meta: Meta; busy: boolean; onAnswer: (send: () => Promise<unknown>) => void; onHold: () => void }) {
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const loans = useApi<LoansAnswer>(saving ? "/api/loans" : null);
  if (saving && loans.data) {
    return <ProposalForm item={item} kind="card" meta={meta} answer={loans.data} busy={busy} onAnswer={onAnswer} onHold={onHold} onCancel={() => setSaving(false)} />;
  }
  const [only] = item.savedCards.length === 1 ? item.savedCards : [];
  return (
    <div className="review-choices">
      <Button className="review-choice" href={settingsHash("banks")}>
        {t("set.rc.connect_the_card")}
      </Button>
      <ChoiceButton busy={busy || saving} onClick={() => setSaving(true)}>
        {t("set.rc.enter_the_card_debt")}
      </ChoiceButton>
      {item.savedCards.length > 0 && (
        <ChoiceButton busy={busy || saving} onClick={() => (only ? onAnswer(() => linkSavedCard(only.id, item.key)) : setPicking(true))}>
          {t("set.rc.card_already_saved")}
        </ChoiceButton>
      )}
      {picking &&
        item.savedCards.map((card) => (
          <ChoiceButton key={card.id} busy={busy || saving} onClick={() => onAnswer(() => linkSavedCard(card.id, item.key))}>
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

/**
 * Every loan is asked one way: its kinds, the one its rows suggest first, and "Ei ole laina". A loan the app can place is
 * saved with the form Asetukset > Lainat opens, filled from the rows with the kind picked; one it cannot place stores
 * the kind as the household's answer.
 */
export function LoanChoices({ item, meta, busy, onAnswer, onHold }: { item: Extract<ReviewItem, { kind: "loan" }>; meta: Meta; busy: boolean; onAnswer: (send: () => Promise<unknown>) => void; onHold: () => void }) {
  const [kind, setKind] = useState<LoanKind | null>(null);
  const [keeping, setKeeping] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const loans = useApi<LoansAnswer>(kind ? "/api/loans" : null);
  // the name is the text the button shows, the badge included, so a voice command that reads it finds the button
  const named = (c: { label: string; guess: boolean }) => (c.guess ? `${c.label} ${t("set.rc.suggestion")}` : c.label);
  if (kind && loans.data) {
    return <ProposalForm item={item} kind={kind} meta={meta} answer={loans.data} busy={busy} onAnswer={onAnswer} onHold={onHold} onCancel={() => setKind(null)} />;
  }
  const answers = LOAN_KIND_ANSWERS as readonly LoanKind[];
  return (
    <>
      <Buttons
        choices={[...loanKindChoices(item), plain<LoanKind | null>(t("set.rc.not_a_loan"), null)]}
        busy={busy || keeping || kind !== null}
        label={named}
        onPick={(picked) => {
          setProblem(null);
          if (picked === null) onAnswer(() => loanCalls.notLoan(item.key));
          else if (item.placed) setKind(picked);
          else if (answers.includes(picked)) {
            // the kind is kept, and the form that asks the balance follows once it is: the debt is not left with no figure
            setKeeping(true);
            mark(loanKindSubject(picked as (typeof LOAN_KIND_ANSWERS)[number], item.key), "in_use")().then(
              () => setKind(picked),
              (err: Error) => setProblem(err.message),
            ).finally(() => setKeeping(false));
          }
        }}
      />
      {problem && (
        <Notice tone="error" className="review-error" as="p">
          {problem}
        </Notice>
      )}
    </>
  );
}
