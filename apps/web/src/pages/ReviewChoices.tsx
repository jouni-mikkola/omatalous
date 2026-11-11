/**
 * The choices of a Tarkistettavat item, one kind each: large buttons with the guess first and framed, a payee's
 * categories with the sheet of all of them, a plan's end, a loan's form. Each answer goes through its source's route.
 */
import { LOAN_KIND_ANSWERS, type LoanKind, loanKindSubject, monthOf, MORTGAGE_QUESTION, planSubject } from "@banking/core";
import type { Loan } from "@banking/core";
import { useState } from "react";
import { api, loanCalls, payerCalls } from "../api.ts";
import { LoanEditor, LoanLinks } from "../components/loans/LoanEditor.tsx";
import { formOfProposal, type LoanForm, shownFields } from "../components/loans/form.ts";
import type { LoanFieldKey } from "../components/loans/labels.ts";
import { editorHelp } from "../components/loans/proposal-words.ts";
import { useApi } from "../hooks.ts";
import { SETTINGS_ANCHOR, settingsCardHash, settingsHash } from "../routes.ts";
import type { Category, Meta } from "../types.ts";
import { answerCall, answerLabel, ownerOf, ownersOf } from "./settings/account-use.ts";
import { type Choice, groupCategories, loanKindChoices, MAX_PLAN_PAYMENTS, offeredCategories, payerChoices, planEnd, type ReviewItem } from "./review-items.ts";
import { Button } from "../components/ui/Button.tsx";
import { t } from "../text.ts";
import { useModal } from "../components/useModal.ts";
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
function Buttons<T>({ choices, busy, label, onPick }: { choices: Choice<T>[]; busy: boolean; label: (c: Choice<T>) => string; onPick: (value: T) => void }) {
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

const plain = <T,>(label: string, value: T): Choice<T> => ({ value, label, guess: false });

/** A user mark, as each source's own answer stores it. */
const mark = (subject: string, value: string) => () => api("/api/marks", { method: "PUT", body: { subject, mark: value } });

export function Choices({ item, meta, busy, onAnswer }: { item: ReviewItem; meta: Meta; busy: boolean; onAnswer: (send: () => Promise<unknown>) => void }) {
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
    case "loan":
      return <LoanChoices item={item} meta={meta} busy={busy} onAnswer={onAnswer} />;
    case "plan":
      return <PlanChoices item={item} busy={busy} onAnswer={onAnswer} />;
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
      // a bill that still comes is passed with Ohita: it goes when its charge does come
      return <Buttons choices={[plain(t("set.rc.ended"), "cancelled")]} busy={busy} label={named} onPick={(value) => onAnswer(mark(item.subject, value))} />;
    case "consent":
      // the bank is connected again where the connections are; the item goes when the new consent is there
      return (
        <div className="review-choices">
          <Button className="review-choice" href={settingsHash("banks")}>
            {t("set.rc.connect_the_bank_again")}
          </Button>
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
    case "mortgage":
      // adding the loan is done on its own page; the question goes once the loan is saved
      return (
        <div className="review-choices">
          <Button className="review-choice" href={settingsCardHash(SETTINGS_ANCHOR.loans)}>
            {t("set.rc.add_a_home_loan")}
          </Button>
          <ChoiceButton busy={busy} onClick={() => onAnswer(mark(MORTGAGE_QUESTION, "dismissed"))}>
            <span>{t("set.rc.no_home_loan")}</span>
          </ChoiceButton>
        </div>
      );
  }
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

/** A plan's end: the payments left after the latest one, or the month of the last one, or "En tiedä". The balance is never assumed. */
function PlanChoices({ item, busy, onAnswer }: { item: Extract<ReviewItem, { kind: "plan" }>; busy: boolean; onAnswer: (send: () => Promise<unknown>) => void }) {
  const [left, setLeft] = useState("");
  const [month, setMonth] = useState("");
  // which save is on its way: only its button shows the wait
  const [sent, setSent] = useState<"count" | "month" | null>(null);
  const store = (endMonth: string | null, from: "count" | "month" | null = null) => {
    setSent(from);
    onAnswer(() => api("/api/marks", { method: "PUT", body: { subject: planSubject(endMonth, item.key), mark: "in_use" } }));
  };
  const end = planEnd(item, left);
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
          <input type="month" min={monthOf(item.lastDate)} value={month} disabled={busy} onChange={(e) => setMonth(e.target.value)} />
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

/**
 * What a proposal still asks: the rate, the way of paying back and the amount granted (the limit of a card or credit
 * line), and the balance only where no connected loan account told it. The rows gave the rest.
 */
function proposalAsk(form: LoanForm): LoanFieldKey[] {
  const own = shownFields(form).filter((key) => key === "grantedCents" || key === "limitCents" || key === "rateBp" || key === "repayment");
  return form.values.balanceCents === "" ? ["balanceCents", ...own] : own;
}

/**
 * Every loan is asked one way: its kinds, the one its rows suggest first, and "Ei ole laina". A loan the app can place is
 * saved with the form Asetukset > Lainat opens, filled from the rows with the kind picked; one it cannot place stores
 * the kind as the household's answer.
 */
function LoanChoices({ item, meta, busy, onAnswer }: { item: Extract<ReviewItem, { kind: "loan" }>; meta: Meta; busy: boolean; onAnswer: (send: () => Promise<unknown>) => void }) {
  const [kind, setKind] = useState<LoanKind | null>(null);
  const loans = useApi<{ loans: Loan[] }>(kind ? "/api/loans" : null);
  // the name is the text the button shows, the badge included, so a voice command that reads it finds the button
  const named = (c: { label: string; guess: boolean }) => (c.guess ? `${c.label} ${t("set.rc.suggestion")}` : c.label);
  if (kind && loans.data) {
    const row = { key: item.key, payee: item.payee, paymentCents: item.paymentCents, months: item.months, firstDate: item.firstDate, lastDate: item.lastDate, kind };
    const initial = formOfProposal(row, meta.today, meta.accounts, loans.data.loans);
    return (
      <LoanLinks.Provider value={{ accounts: meta.accounts, loans: loans.data.loans }}>
        <div className="review-loan">
          <p className="review-note">{editorHelp(initial)}</p>
          <LoanEditor
            initial={initial}
            today={meta.today}
            cancelLabel={t("set.rc.cancel")}
            ask={proposalAsk(initial)}
            onSave={async (body) => {
              // the editor shows its own error; the page moves on only after the loan is saved
              await loanCalls.add(body);
              onAnswer(async () => undefined);
            }}
            onCancel={() => setKind(null)}
          />
        </div>
      </LoanLinks.Provider>
    );
  }
  const answers = LOAN_KIND_ANSWERS as readonly LoanKind[];
  return (
    <Buttons
      choices={[...loanKindChoices(item), plain<LoanKind | null>(t("set.rc.not_a_loan"), null)]}
      busy={busy || kind !== null}
      label={named}
      onPick={(picked) => {
        if (picked === null) onAnswer(() => loanCalls.notLoan(item.key));
        else if (item.placed) setKind(picked);
        else if (answers.includes(picked)) onAnswer(mark(loanKindSubject(picked as (typeof LOAN_KIND_ANSWERS)[number], item.key), "in_use"));
      }}
    />
  );
}
