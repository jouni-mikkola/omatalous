/**
 * Täydennä lainat, the balances of the loans the rows show in one form: a field for what each owes now, an optional one
 * for its rate and one Tallenna. Each filled loan is saved as it is alone (POST /api/loans, linked to its series, with
 * what the rows tell of its terms); a loan left empty stays in the queue. The saved ones close into their result line.
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [finished, setFinished] = useState(false);
  const answer = loans.data;
  const of = (debt: LoanTermsDebt) => typed[debt.id] ?? EMPTY;
  const set = (debt: LoanTermsDebt, change: Partial<Typed>) => setTyped({ ...typed, [debt.id]: { ...of(debt), ...change } });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || !answer) return;
    const filled = item.debts.filter((d) => of(d).balance.trim() !== "");
    if (filled.length === 0) {
      setProblem(t("set.loans.loan_need_balance"));
      return;
    }
    const found: Record<string, string> = {};
    const bodies = filled.flatMap((debt) => {
      const form = rowsForm(debt, debt.kind, meta, answer, false);
      const { balance, rate } = of(debt);
      const read = readForm({ ...form, values: { ...form.values, balanceCents: balance, ...(rate.trim() === "" ? {} : { rateBp: rate }) } }, answer.fixings);
      if (!read.body) found[debt.id] = read.errors.balanceCents ?? read.errors.rateBp ?? Object.values(read.errors)[0] ?? "";
      return read.body ? [{ debt, body: read.body }] : [];
    });
    setErrors(found);
    setProblem(null);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    onHold();
    const lines: Record<string, string> = {};
    try {
      for (const { debt, body } of bodies) {
        const { loan } = await loanCalls.add(body);
        lines[debt.id] = resultLine(loan, answer.fixings, meta.today);
        setSaved((s) => ({ ...s, [debt.id]: lines[debt.id]! }));
      }
      setFinished(true);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
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
          {item.debts.map((debt) => (
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
                    <Field label={t("set.rc.lt_left_now")} value={of(debt).balance} error={errors[debt.id]} onChange={(balance) => set(debt, { balance })} />
                    <Field label={t("set.rc.lt_rate_if_known")} value={of(debt).rate} onChange={(rate) => set(debt, { rate })} />
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
