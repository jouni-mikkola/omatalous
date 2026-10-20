/**
 * The choices of a Tarkistettavat item, one kind each: large buttons with the guess first and framed, a payee's
 * categories with the sheet of all of them, a plan's end, a loan's form. Each answer goes through its source's route.
 */
import { LOAN_KIND_ANSWERS, type LoanKind, loanKindSubject, monthOf, MORTGAGE_QUESTION, planSubject } from "@banking/core";
import type { Loan } from "@banking/core";
import { useEffect, useRef, useState } from "react";
import { api, loanCalls, payerCalls } from "../api.ts";
import { LoanEditor, LoanLinks } from "../components/loans/LoanEditor.tsx";
import { formOfProposal } from "../components/loans/form.ts";
import { editorHelp } from "../components/loans/proposal-words.ts";
import { InputForm } from "../components/optimise/Inputs.tsx";
import { useApi } from "../hooks.ts";
import { SETTINGS_ANCHOR } from "../routes.ts";
import type { Category, Meta } from "../types.ts";
import { answerCall, answerLabel, ownerOf, ownersOf } from "./settings/account-use.ts";
import { type Choice, extensionChoices, groupCategories, loanKindChoices, MAX_PLAN_PAYMENTS, offeredCategories, payerChoices, planEnd, type ReviewItem } from "./review-items.ts";

/** One large button. It carries the wait while its own answer is on its way; the others are only held. */
export function ChoiceButton({ primary = false, className = "btn review-choice", busy, label, onClick, children }: { primary?: boolean; className?: string; busy: boolean; label?: string; onClick: () => void; children: React.ReactNode }) {
  const [pressed, setPressed] = useState(false);
  if (pressed && !busy) setPressed(false);
  return (
    <button
      className={`${className}${primary ? " is-guess" : ""}`}
      type="button"
      disabled={busy}
      aria-busy={(busy && pressed) || undefined}
      aria-label={label}
      onClick={() => {
        setPressed(true);
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/** The large buttons, the guess first and marked. */
function Buttons<T>({ choices, busy, label, onPick }: { choices: Choice<T>[]; busy: boolean; label: (c: Choice<T>) => string; onPick: (value: T) => void }) {
  return (
    <div className="review-choices">
      {choices.map((c) => (
        <ChoiceButton key={c.label} primary={c.guess} busy={busy} label={label(c)} onClick={() => onPick(c.value)}>
          <span>{c.label}</span> {c.guess && <span className="review-guess">Ehdotus</span>}
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
  const named = (c: { label: string; guess: boolean }) => (c.guess ? `${c.label} Ehdotus` : c.label);
  switch (item.kind) {
    case "payee_out":
    case "payee_in":
      return (
        <CategoryChoices item={item} categories={meta.categories} busy={busy} onPick={(category) => onAnswer(() => api("/api/rules", { method: "POST", body: { field: "merchant_exact", pattern: item.merchant, category } }))} />
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
      return <Buttons choices={[plain("Käytössä", "in_use"), plain("Lopetettu", "cancelled")]} busy={busy} label={named} onPick={(value) => onAnswer(mark(item.subject, value))} />;
    case "input":
      return <InputForm inputKey={item.key} today={meta.today} scope="own" answer={onAnswer} waiting={busy} />;
    case "mortgage":
      // adding the loan is done on its own page; the question goes once the loan is saved
      return (
        <div className="review-choices">
          <a className="btn review-choice" href={`#/settings#${SETTINGS_ANCHOR.loans}`}>
            Lisää asuntolaina
          </a>
          <ChoiceButton busy={busy} onClick={() => onAnswer(mark(MORTGAGE_QUESTION, "dismissed"))}>
            <span>Ei asuntolainaa</span>
          </ChoiceButton>
        </div>
      );
    case "extension":
      return <Buttons choices={extensionChoices(item)} busy={busy} label={named} onPick={(c) => onAnswer(() => api(c.answer.path, { method: c.answer.method, body: c.answer.body }))} />;
  }
}

/**
 * A payee's category as buttons: the guess first, framed, with its reason below, when the server has one; then the
 * household's most used categories on its side, unmarked; then "Muu kategoria…", which opens every category in a sheet.
 */
function CategoryChoices({ item, categories, busy, onPick }: { item: Extract<ReviewItem, { kind: "payee_out" | "payee_in" }>; categories: Category[]; busy: boolean; onPick: (category: string) => void }) {
  const [sheet, setSheet] = useState(false);
  const offered = offeredCategories(categories, item.kind === "payee_in");
  const picks = item.picks.flatMap((id) => offered.filter((c) => c.id === id));
  const guess = picks.some((c) => c.id === item.guess?.category) ? item.guess : undefined;
  const why = guess ? guess.reason.charAt(0).toLowerCase() + guess.reason.slice(1) : "";
  return (
    <>
      <div className="review-choices">
        {picks.map((c) => (
          <ChoiceButton key={c.id} primary={c.id === guess?.category} busy={busy} onClick={() => onPick(c.id)}>
            <span>{c.label}</span> {c.id === guess?.category && <span className="review-guess">Ehdotus</span>}
          </ChoiceButton>
        ))}
        <button className="btn review-choice" type="button" disabled={busy} aria-haspopup="dialog" onClick={() => setSheet(true)}>
          Muu kategoria…
        </button>
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
      {guess && <p className="review-note">Ehdotuksen peruste: {why}.</p>}
    </>
  );
}

/** Every category the payee may take, grouped as the reports group them, with a search over the names. */
function CategorySheet({ categories, onPick, onClose }: { categories: Category[]; onPick: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
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
        <h2 id="review-sheet-h">Valitse kategoria</h2>
        <button className="review-skip" type="button" onClick={onClose}>
          Peruuta
        </button>
      </div>
      <label className="review-plan-field">
        <span>Hae kategoriaa</span>
        <input type="search" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <div className="review-sheet-list">
        {groups.map(([group, list]) => (
          <section key={group} aria-label={group}>
            <h3>{group}</h3>
            <div className="review-choices">
              {list.map((c) => (
                <button key={c.id} className="btn review-choice" type="button" onClick={() => onPick(c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
          </section>
        ))}
        {groups.length === 0 && <p className="review-note">Haulla ei löydy kategoriaa.</p>}
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
          <span>Maksuja jäljellä</span>
          <input type="number" min={1} max={MAX_PLAN_PAYMENTS} inputMode="numeric" value={left} disabled={busy} onChange={(e) => setLeft(e.target.value)} />
        </label>
        <button className="btn review-choice" type="submit" disabled={busy || end === null} aria-busy={busy && sent === "count" ? true : undefined}>
          Tallenna
        </button>
      </form>
      <form
        className="review-plan-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (month) store(month, "month");
        }}
      >
        <label className="review-plan-field">
          <span>Viimeinen kuukausi</span>
          <input type="month" min={monthOf(item.lastDate)} value={month} disabled={busy} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <button className="btn review-choice" type="submit" disabled={busy || !month} aria-busy={busy && sent === "month" ? true : undefined}>
          Tallenna kuukausi
        </button>
      </form>
      <div className="review-choices">
        <ChoiceButton busy={busy} onClick={() => store(null)}>
          En tiedä
        </ChoiceButton>
      </div>
    </div>
  );
}

/**
 * Every loan is asked one way: its kinds, the one its rows suggest first, and "Ei laina". A loan the app can place is
 * saved with the form Asetukset > Lainat opens, filled from the rows with the kind picked; one it cannot place stores
 * the kind as the household's answer.
 */
function LoanChoices({ item, meta, busy, onAnswer }: { item: Extract<ReviewItem, { kind: "loan" }>; meta: Meta; busy: boolean; onAnswer: (send: () => Promise<unknown>) => void }) {
  const [kind, setKind] = useState<LoanKind | null>(null);
  const loans = useApi<{ loans: Loan[] }>(kind ? "/api/loans" : null);
  // the name is the text the button shows, the badge included, so a voice command that reads it finds the button
  const named = (c: { label: string; guess: boolean }) => (c.guess ? `${c.label} Ehdotus` : c.label);
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
            cancelLabel="Peruuta"
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
      choices={[...loanKindChoices(item), plain<LoanKind | null>("Ei laina", null)]}
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
