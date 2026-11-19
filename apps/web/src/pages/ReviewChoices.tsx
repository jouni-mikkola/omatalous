/**
 * The choices of a Tarkistettavat item, one kind each: large buttons with the guess first and framed, a payee's
 * categories with the sheet of all of them, the list of debts, a loan's form. Each answer goes through its source's route.
 */
import { MORTGAGE_QUESTION } from "@banking/core";
import { useEffect, useRef, useState } from "react";
import { api, loanCalls, payerCalls } from "../api.ts";
import { AddLoan } from "../components/loans/AddLoan.tsx";
import { LoanEditor, LoanLinks } from "../components/loans/LoanEditor.tsx";
import { formOfLoan, type LoanForm } from "../components/loans/form.ts";
import { useApi } from "../hooks.ts";
import { eurosText } from "../format.ts";
import { SETTINGS_ANCHOR, settingsCardHash, settingsHash } from "../routes.ts";
import type { Category, LoansAnswer, Meta } from "../types.ts";
import { answerCall, answerLabel, ownerOf, ownersOf } from "./settings/account-use.ts";
import { groupCategories, offeredCategories, payerChoices, type ReviewItem } from "./review-items.ts";
import { Buttons, ChoiceButton, mark, plain } from "./review-buttons.tsx";
import { LoanTermsChoices } from "./ReviewLoanChoices.tsx";
import { Button } from "../components/ui/Button.tsx";
import { Notice } from "../components/ui/Notice.tsx";
import { t } from "../text.ts";
import { useModal } from "../components/useModal.ts";
/** The same user mark on several subjects, written in one request. */
const marksOn = (subjects: string[], value: string) => () => api("/api/marks", { method: "PUT", body: { subjects, mark: value } });

export function Choices({ item, meta, busy, onAnswer, onHold, onReload }: { item: ReviewItem; meta: Meta; busy: boolean; onAnswer: (send: () => Promise<unknown>) => void; onHold: () => void; onReload: () => void }) {
  // the name is the text the button shows, the badge included, so a voice command that reads it finds the button
  const named = (c: { label: string; guess: boolean }) => (c.guess ? `${c.label} ${t("set.rc.suggestion")}` : c.label);
  switch (item.kind) {
    case "payee_out":
    case "payee_in":
      return (
        <CategoryChoices item={item} income={item.kind === "payee_in"} categories={meta.categories} busy={busy} onPick={(category) => onAnswer(() => api("/api/rules", { method: "POST", body: { field: "merchant_exact", pattern: item.merchant, category } }))} />
      );
    case "payer":
      return <Buttons choices={payerChoices(item)} busy={busy} label={named} onPick={(role) => onAnswer(() => payerCalls.say(item.key, role))} />;
    case "loan_terms_list":
      return <LoanTermsChoices item={item} meta={meta} busy={busy} onAnswer={onAnswer} onHold={onHold} onReload={onReload} />;
    case "split": {
      const account = meta.accounts.find((a) => a.id === item.accountId);
      const owners = account ? ownersOf(account, meta) : [];
      const q = { kind: item.question, key: item.key };
      const choices = [...owners.map((o) => plain(o.label, ownerOf(o.userId))), ...(["all", "none"] as const).map((o) => plain(answerLabel(o, owners), o))];
      return (
        <Buttons
          choices={choices}
          busy={busy}
          label={named}
          onPick={(owner) => {
            const call = answerCall(item.accountId, q, owner);
            onAnswer(() => api(call.path, { method: call.method, body: call.body }));
          }}
        />
      );
    }
    case "subscription":
      return <Buttons choices={[plain(t("set.rc.in_use"), "in_use"), plain(t("set.rc.ended"), "cancelled")]} busy={busy} label={named} onPick={(value) => onAnswer(mark(item.subject, value))} />;
    case "row":
      return <CategoryChoices item={item} income={item.side === "in"} categories={meta.categories} busy={busy} onPick={(category) => onAnswer(() => api(`/api/transactions/${encodeURIComponent(item.rowId)}`, { method: "PATCH", body: { category } }))} />;
    case "bill":
      // Tulee vielä is said of this due day alone (`comingSubject`), so it says nothing of the series; Lopetettu ends the series
      return <Buttons choices={[plain(t("set.rc.still_coming"), "coming"), plain(t("set.rc.ended"), "ended")]} busy={busy} label={named} onPick={(value) => onAnswer(value === "coming" ? mark(item.comingSubject, "in_use") : mark(item.subject, "cancelled"))} />;
    case "consent":
      // the bank is connected again where the connections are; the item goes when the new consent is there
      return (
        <div className="review-choices">
          <Button className="review-choice" href={settingsHash("banks")}>
            {t("set.rc.connect_the_bank_again")}
          </Button>
        </div>
      );
    case "fetch":
      // the fetch is tried again where the connections are (Hae nyt is there); the item goes when a fetch succeeds
      return (
        <div className="review-choices">
          <Button className="review-choice" href={settingsHash("banks")}>
            {t("set.conn.fetch_now")}
          </Button>
        </div>
      );
    case "card_balance":
      // the balance comes with a fetch from the bank or is set on an imported account, both in the account's details
      return (
        <div className="review-choices">
          <Button className="review-choice" href={settingsCardHash(SETTINGS_ANCHOR.accounts)}>
            {t("set.rc.open_the_account")}
          </Button>
        </div>
      );
    case "unresolved":
      // the notice is set aside with a mark per card it names (core unresolved-answer.ts); a payer is seen once the account that pays the card is connected
      return (
        <div className="review-choices">
          <Button className="review-choice" href={settingsHash("banks")}>
            {t("set.rc.connect_the_paying_account")}
          </Button>
          <ChoiceButton busy={busy} onClick={() => onAnswer(marksOn(item.subjects, "dismissed"))}>
            <span>{t("set.rc.do_not_remind_of_this")}</span>
          </ChoiceButton>
        </div>
      );
    case "balance":
      // nothing here can make the rows add up: the account's own row tells the stretch, and a fetch or the bank's file brings the rows
      return (
        <div className="review-choices">
          <Button className="review-choice" href={settingsCardHash(SETTINGS_ANCHOR.accounts)}>
            {t("set.rc.open_the_account")}
          </Button>
        </div>
      );
    case "money_back":
      // the refund asked for is `in_use` on the alert; asked a second time, `cancelled` closes the item for good (core money-back.ts)
      return (
        <Buttons
          choices={[plain(t("set.rc.ask_for_a_refund"), item.askedOn ? "cancelled" : "in_use"), plain(t("set.rc.the_charge_is_right"), "dismissed")]}
          busy={busy}
          label={named}
          onPick={(value) => onAnswer(mark(item.subject, value))}
        />
      );
    case "loan_drift":
      return <LoanDriftChoices item={item} meta={meta} busy={busy} onAnswer={onAnswer} />;
    case "mortgage":
      return <MortgageChoices meta={meta} busy={busy} onAnswer={onAnswer} />;
  }
}

/**
 * A home loan the rows suggest: Lisää asuntolaina opens here the form Varat ja velat adds a loan with, on the kind of a
 * home loan. The question goes once the loan is saved.
 */
function MortgageChoices({ meta, busy, onAnswer }: { meta: Meta; busy: boolean; onAnswer: (send: () => Promise<unknown>) => void }) {
  const [adding, setAdding] = useState(false);
  const formBox = useRef<HTMLDivElement>(null);
  // the form opens at its first field, so the loan can be typed at once
  useEffect(() => {
    if (adding) formBox.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
  }, [adding]);
  if (adding)
    return (
      <div className="review-loan" ref={formBox}>
        <AddLoan meta={meta} kind="mortgage" onSaved={() => onAnswer(async () => undefined)} onClose={() => setAdding(false)} />
      </div>
    );
  return (
    <div className="review-choices">
      <ChoiceButton busy={busy} onClick={() => setAdding(true)}>
        <span>{t("set.rc.add_a_home_loan")}</span>
      </ChoiceButton>
      <ChoiceButton busy={busy} onClick={() => onAnswer(mark(MORTGAGE_QUESTION, "dismissed"))}>
        <span>{t("set.rc.no_home_loan")}</span>
      </ChoiceButton>
    </div>
  );
}

/** The loan's form with the payment the bank took, and the day it moved on when the loan has a reference rate. */
function withNewPayment(form: LoanForm, { newPaymentCents, reviewDate }: { newPaymentCents: number; reviewDate: string | null }): LoanForm {
  return { ...form, values: { ...form.values, paymentCents: eurosText(newPaymentCents), ...(reviewDate === null ? {} : { rateReviewDate: reviewDate }) } };
}

/**
 * A payment the plan did not expect: the saved loan's own form, as Varat ja velat edits it, opens with the new
 * payment filled in, and for a loan on a reference rate the day it moved on as the review day. The item goes once the
 * loan is saved.
 */
function LoanDriftChoices({ item, meta, busy, onAnswer }: { item: Extract<ReviewItem, { kind: "loan_drift" }>; meta: Meta; busy: boolean; onAnswer: (send: () => Promise<unknown>) => void }) {
  const [editing, setEditing] = useState(false);
  const loans = useApi<LoansAnswer>(editing ? "/api/loans" : null);
  const loan = loans.data?.loans.find((l) => l.id === item.loanId);
  const initial = loan ? withNewPayment(formOfLoan(loan), item) : null;
  const waiting = editing && !loans.data && !loans.error;
  const formShown = editing && loans.data !== null && initial !== null;
  const formBox = useRef<HTMLDivElement>(null);
  // the form opens at its first field, so the answer can be typed at once
  useEffect(() => {
    if (formShown) formBox.current?.querySelector<HTMLElement>("input, select")?.focus();
  }, [formShown]);
  // the loan was deleted since the queue was read: nothing is left to ask, so the item leaves with no error
  const gone = editing && loans.data !== null && initial === null;
  useEffect(() => {
    if (gone) onAnswer(async () => undefined);
  }, [gone]);
  if (gone) return null;
  if (editing && loans.data && loan && initial) {
    return (
      <LoanLinks.Provider value={{ accounts: meta.accounts, loans: loans.data.loans, fixings: loans.data.fixings }}>
        <div className="review-loan" ref={formBox}>
          <LoanEditor
            initial={initial}
            today={meta.today}
            cancelLabel={t("set.rc.cancel")}
            ask={item.reviewDate === null ? ["paymentCents"] : ["paymentCents", "rateReviewDate"]}
            onSave={async (body) => {
              // the editor shows its own error; the page moves on only after the loan is saved
              await loanCalls.replace(loan.id, body);
              onAnswer(async () => undefined);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      </LoanLinks.Provider>
    );
  }
  return (
    <>
      <div className="review-choices">
        <ChoiceButton
          busy={busy || waiting}
          onClick={() => {
            setEditing(true);
            // a list that failed is asked for again
            loans.reload();
          }}
        >
          <span>{t("set.rc.update_the_loan_payment")}</span>
        </ChoiceButton>
      </div>
      {loans.error && (
        <Notice tone="error" className="review-error" as="p">
          {loans.error}
        </Notice>
      )}
    </>
  );
}

/**
 * A payee's category as buttons: the guess first, framed, with its reason below, when the server has one; then the
 * household's most used categories on its side, unmarked; then "Muu kategoria…", which opens every category in a sheet.
 */
function CategoryChoices({ item, income, categories, busy, onPick }: { item: { picks: string[]; guess?: { category: string; reason: string } }; income: boolean; categories: Category[]; busy: boolean; onPick: (category: string) => void }) {
  const [sheet, setSheet] = useState(false);
  const offered = offeredCategories(categories, income);
  const picks = item.picks.flatMap((id) => offered.filter((c) => c.id === id));
  const guess = picks.some((c) => c.id === item.guess?.category) ? item.guess : undefined;
  const why = guess ? guess.reason.charAt(0).toLowerCase() + guess.reason.slice(1) : "";
  return (
    <>
      <div className="review-choices">
        {picks.map((c) => (
          <ChoiceButton key={c.id} primary={c.id === guess?.category} busy={busy} onClick={() => onPick(c.id)}>
            <span>{c.label}</span> {c.id === guess?.category && <span className="review-guess">{t("set.rc.suggestion")}</span>}
          </ChoiceButton>
        ))}
        <Button className="review-choice" disabled={busy} aria-haspopup="dialog" onClick={() => setSheet(true)}>
          {t("set.rc.other_category")}
        </Button>
        {sheet && (
          <CategorySheet
            categories={offered}
            onPick={(id) => {
              setSheet(false);
              onPick(id);
            }}
            onClose={() => setSheet(false)}
          />
        )}
      </div>
      {guess && <p className="review-note">{t("set.rc.why", { why })}</p>}
    </>
  );
}

/** Every category the payee may take, grouped as the reports group them, with a search over the names. */
function CategorySheet({ categories, onPick, onClose }: { categories: Category[]; onPick: (id: string) => void; onClose: () => void }) {
  const ref = useModal();
  const [search, setSearch] = useState("");
  const groups = groupCategories(categories, search);
  return (
    <dialog
      ref={ref}
      className="review-sheet"
      aria-labelledby="review-sheet-h"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="review-sheet-head">
        <h2 id="review-sheet-h">{t("set.rc.choose_a_category")}</h2>
        <button className="review-skip" type="button" onClick={onClose}>
          {t("set.rc.cancel")}
        </button>
      </div>
      <label className="review-plan-field">
        <span>{t("set.rc.search_categories")}</span>
        <input type="search" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <div className="review-sheet-list">
        {groups.map(([group, list]) => (
          <section key={group} aria-label={group}>
            <h3>{group}</h3>
            <div className="review-choices">
              {list.map((c) => (
                <Button key={c.id} className="review-choice" onClick={() => onPick(c.id)}>
                  {c.label}
                </Button>
              ))}
            </div>
          </section>
        ))}
        {groups.length === 0 && <p className="review-note">{t("set.rc.no_category_matches_the_search")}</p>}
      </div>
    </dialog>
  );
}

