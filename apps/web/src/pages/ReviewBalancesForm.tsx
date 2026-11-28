/**
 * Täydennä lainat, the balances of the loans the rows show in one form: a field for what each owes now, an optional one
 * for its rate and one Tallenna. Each filled loan is saved as it is alone (POST /api/loans, linked to its series, with
 * what the rows tell of its terms); a loan left empty stays in the queue and in the form. The saved ones close into their result line, and the form is done when every loan is saved.
 */
import { type FormEvent, useId, useState } from "react";
import { loanCalls } from "../api.ts";
import { readForm } from "../components/loans/form.ts";
import { Button } from "../components/ui/Button.tsx";
import { Notice } from "../components/ui/Notice.tsx";
import { money } from "../format.ts";
import { useApi } from "../hooks.ts";
import { t } from "../text.ts";
import type { LoansAnswer, Meta } from "../types.ts";
import { ChoiceButton } from "./review-buttons.tsx";
import type { LoanTermsDebt, LoanTermsListItem } from "./review-loan-items.ts";
import { resultLine, rowsForm } from "./ReviewLoanChoices.tsx";

interface Typed {
  balance: string;
  rate: string;
}

const EMPTY: Typed = { balance: "", rate: "" };

/** What is wrong with a loan's fields; `other` is a message of the form or the server with no field of its own, shown at the balance. */
interface FieldErrors {
  balance?: string;
  rate?: string;
  other?: string;
}

function Field({ label, value, error, onChange }: { label: string; value: string; error?: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="loan-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input id={id} type="text" inputMode="decimal" autoComplete="off" value={value} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} onChange={(e) => onChange(e.target.value)} />
      {error && (
        <span id={`${id}-error`} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function BalancesForm({ item, meta, busy, onAnswer, onHold, onReload }: { item: LoanTermsListItem; meta: Meta; busy: boolean; onAnswer: (send: () => Promise<unknown>) => void; onHold: () => void; onReload: () => void }) {
  const loans = useApi<LoansAnswer>("/api/loans");
  const [typed, setTyped] = useState<Record<string, Typed>>({});
  const [errors, setErrors] = useState<Record<string, FieldErrors>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // the debts of the form as it opened: after a save the queue may bring the item again without the saved ones, and their result lines stay
  const [shown, setShown] = useState<LoanTermsDebt[]>(item.debts);
  const fresh = item.debts.filter((d) => !shown.some((s) => s.id === d.id));
  if (fresh.length > 0) setShown([...shown, ...fresh]);
  const finished = shown.every((d) => saved[d.id]);
  const answer = loans.data;
  const of = (debt: LoanTermsDebt) => typed[debt.id] ?? EMPTY;
  const set = (debt: LoanTermsDebt, change: Partial<Typed>) => setTyped({ ...typed, [debt.id]: { ...of(debt), ...change } });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || !answer) return;
    // a loan saved by an earlier press is never sent again
    const filled = shown.filter((d) => !saved[d.id] && (of(d).balance.trim() !== "" || of(d).rate.trim() !== ""));
    if (filled.length === 0) {
      setProblem(t("set.loans.loan_need_balance"));
      return;
    }
    const found: Record<string, FieldErrors> = {};
    const bodies = filled.flatMap((debt) => {
      const form = rowsForm(debt, debt.kind, meta, answer, false);
      const { balance, rate } = of(debt);
      // a rate typed with no balance is asked for the balance, never dropped
      if (balance.trim() === "") {
        found[debt.id] = { balance: t("set.loans.loan_need_balance") };
        return [];
      }
      const read = readForm({ ...form, values: { ...form.values, balanceCents: balance, ...(rate.trim() === "" ? {} : { rateBp: rate }) } }, answer.fixings);
      if (!read.body) found[debt.id] = { balance: read.errors.balanceCents, rate: read.errors.rateBp, other: read.errors.balanceCents || read.errors.rateBp ? undefined : Object.values(read.errors)[0] };
      return read.body ? [{ debt, body: read.body }] : [];
    });
    setErrors(found);
    setProblem(null);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    onHold();
    let current: LoanTermsDebt | null = null;
    try {
      for (const { debt, body } of bodies) {
        current = debt;
        const { loan } = await loanCalls.add(body);
        const line = resultLine(loan, answer.fixings, meta.today);
        setSaved((s) => ({ ...s, [debt.id]: line }));
      }
    } catch (err) {
      // the loan that failed shows the error at its field; the ones saved before it stay closed
      const message = err instanceof Error ? err.message : String(err);
      if (current) setErrors({ [current.id]: { other: message } });
      else setProblem(message);
    } finally {
      setSaving(false);
      loans.reload();
      onReload();
    }
  };

  return (
    <div className="review-debts">
      {loans.error && !loans.data && (
        <Notice tone="error" className="review-error" as="p">
          {loans.error}
        </Notice>
      )}
      <form className="review-field" onSubmit={(e) => void submit(e)} noValidate>
        <ul className="review-debt-list">
          {shown.map((debt) => (
            <li key={debt.id} className={`review-debt${saved[debt.id] ? " is-done" : ""}`}>
              <h3 className="review-debt-name">
                {debt.name}
                {debt.monthlyCents !== null && <span className="review-debt-facts"> · {t("rpt.ln_per_month", { amount: money(debt.monthlyCents) })}</span>}
              </h3>
              {saved[debt.id] ? (
                <p className="review-debt-result">{saved[debt.id]}</p>
              ) : (
                !finished && (
                  <>
                    <Field label={t("set.rc.lt_left_now")} value={of(debt).balance} error={errors[debt.id]?.balance ?? errors[debt.id]?.other} onChange={(balance) => set(debt, { balance })} />
                    <Field label={t("set.rc.lt_rate_if_known")} value={of(debt).rate} error={errors[debt.id]?.rate} onChange={(rate) => set(debt, { rate })} />
                  </>
                )
              )}
            </li>
          ))}
        </ul>
        {problem && (
          <Notice tone="error" className="review-error" as="p">
            {problem}
          </Notice>
        )}
        <div className="review-choices">
          {finished ? (
            <ChoiceButton busy={busy} onClick={() => onAnswer(async () => undefined)}>
              <span>{t("set.rc.next")}</span>
            </ChoiceButton>
          ) : (
            <Button className="review-choice" variant="primary" type="submit" busy={saving} disabled={busy || !answer}>
              {t("set.rc.save")}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
