import { LOAN_KINDS, LOAN_REFERENCES, LOAN_REPAYMENTS, type Loan, type LoanKind } from "@banking/core";
import { createContext, type FormEvent, type ReactNode, useContext, useId, useState } from "react";
import { money, parseEuros } from "../../format.ts";
import { t } from "../../text.ts";
import type { Account } from "../../types.ts";
import { defaultName, isCredit, type FormErrors, interestOverPayment, type LoanBody, type LoanForm, linkChoices, readForm, setKind, setValue, shownFields } from "./form.ts";
import { FIELD_LABEL, INTERVALS, intervalLabel, KIND_LABEL, type LoanFieldKey, REFERENCE_LABEL, REPAYMENT_LABEL } from "./labels.ts";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
const UNIT: Partial<Record<LoanFieldKey, string>> = { balanceCents: "€", grantedCents: "€", limitCents: "€", paymentCents: "€", rateBp: "%", marginBp: "%" };

/**
 * What the select "Sama velka pankin tilillä" offers from: the household's accounts and its saved loans (an account
 * another loan holds is not offered). The loans card provides it to every form it holds, so the new loan and the
 * proposals need no props for it. Without a provider the select is not shown.
 */
export const LoanLinks = createContext<{ accounts: readonly Account[]; loans: readonly Loan[] }>({ accounts: [], loans: [] });

const LINK_HELP = () => t("set.loans.link_help");
/** Under the balance of a linked loan: the bank's balance counts while the bank tells one, and the typed one otherwise. */
const LINKED_BALANCE_HELP = () => t("set.loans.linked_balance_help");
const REVIEW_HELP = () => t("set.loans.review_help");

/** What the payment figure is, by the way the loan is paid back. */
function paymentHelp(form: LoanForm): string | null {
  if (form.values.repayment === "equal_principal") return t("set.loans.payment_principal_only");
  if (form.values.repayment === "annuity" || form.values.repayment === "fixed_instalment") return t("set.loans.payment_whole");
  return null;
}

/** The typed amount in the language's money form (as typed when it is not a figure yet). */
function moneyText(typed: string): string {
  const cents = parseEuros(typed.trim());
  return cents === null ? t("set.loans.typed_amount", { amount: typed }) : money(cents);
}

/** What a proposal's form filled from the bank's rows, in one line. */
function prefilledLine(form: LoanForm): string {
  const payment = !isCredit(form.kind) && form.values.paymentCents && `${moneyText(form.values.paymentCents)} ${intervalLabel(Number(form.values.intervalMonths) || 1).toLowerCase()}`;
  const parts = [form.values.lender, payment, form.accountId && form.values.balanceCents && t("set.loans.prefilled_balance", { amount: moneyText(form.values.balanceCents) })].filter(Boolean);
  return parts.length > 0 ? t("set.loans.prefilled", { parts: parts.join(", ") }) : t("set.loans.prefilled_none");
}

/**
 * The form of one loan: a loan typed in, a proposal from the bank's rows, or a saved loan. Nothing is sent before
 * Tallenna.
 */
export function LoanEditor({ initial, today, cancelLabel, ask, onSave, onCancel }: {
  initial: LoanForm;
  /**
   * The fields the household is asked for, when the rest is filled from the bank's rows (a proposal). The others stay
   * in the form, shown in one line, and "Näytä kaikki kentät" opens them. Without it every field shows.
   */
  ask?: readonly LoanFieldKey[];
  /** The instance's day: the latest day a balance can be of. */
  today: string;
  cancelLabel: string;
  onSave: (body: LoanBody) => Promise<void>;
  onCancel: () => void;
}) {
  const uid = useId();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const compact = ask !== undefined && !all;
  const shown = shownFields(form).filter((key) => !compact || ask.includes(key));
  const interest = interestOverPayment(form);
  const links = useContext(LoanLinks);
  const choices = linkChoices(links.accounts, links.loans, form.id);
  // a stored link to an account that is not offered any more (removed, no card or loan account) is not kept by a save
  const linked = choices.some((c) => c.id === form.accountId) ? form.accountId : "";
  const idOf = (key: string) => `${uid}-${key}`;
  const change = (key: LoanFieldKey, text: string) => setForm((f) => setValue(f, key, text));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const { body, errors: found } = readForm({ ...form, accountId: linked });
    setErrors(found);
    // an error on a field that is not shown opens the rest of the form
    if (compact && (interest !== null || Object.keys(found).some((key) => key !== "kind" && !shown.includes(key as LoanFieldKey)))) setAll(true);
    const stop = Object.keys(found)[0] ?? (interest !== null ? "paymentCents" : null);
    if (!body || stop) {
      setProblem(
        Object.keys(found).length > 0 ? t("set.loans.fix_marked") : t("set.loans.payment_below_interest"),
      );
      if (stop) document.getElementById(idOf(stop))?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await onSave(body);
    } catch (err) {
      // the server names the field it refused
      setProblem((err as Error).message);
      setBusy(false);
    }
  };

  const input = (key: LoanFieldKey, describedBy: string | undefined): ReactNode => {
    const common = { id: idOf(key), value: form.values[key], "aria-describedby": describedBy, "aria-invalid": errors[key] ? true : undefined };
    const pick = (options: readonly (readonly [string, string])[]) => (
      <select {...common} onChange={(e) => change(key, e.target.value)}>
        <option value="">{t("set.loans.unknown")}</option>
        {options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    );
    if (key === "reference") return pick(LOAN_REFERENCES.map((id) => [id, REFERENCE_LABEL[id]] as const));
    if (key === "repayment") return pick(LOAN_REPAYMENTS.map((id) => [id, REPAYMENT_LABEL[id]] as const));
    if (key === "intervalMonths") {
      const current = Number(form.values.intervalMonths);
      const months = current > 0 && !INTERVALS.some((m) => m === current) ? [...INTERVALS, current].sort((a, b) => a - b) : INTERVALS;
      return pick(months.map((m) => [String(m), intervalLabel(m)] as const));
    }
    if (key === "balanceDate" || key === "endDate" || key === "rateReviewDate") return <input {...common} type="date" max={key === "balanceDate" ? today : undefined} required={key === "balanceDate"} onChange={(e) => change(key, e.target.value)} />;
    if (key === "lender") return <input {...common} type="text" maxLength={80} autoComplete="off" onChange={(e) => change(key, e.target.value)} />;
    return <input {...common} type="text" inputMode="decimal" autoComplete="off" required={key === "balanceCents"} onChange={(e) => change(key, e.target.value)} />;
  };

  return (
    <form className="loan-form" onSubmit={(e) => void submit(e)} noValidate>
      {compact && <p className="small muted loan-note">{prefilledLine(form)}</p>}
      {!compact && (
      <div className="loan-fields">
        <div className="loan-field">
          <label className="field-label" htmlFor={idOf("name")}>
            {t("set.loans.name")}
          </label>
          <input id={idOf("name")} type="text" maxLength={80} autoComplete="off" value={form.name} placeholder={form.kind === "" ? "" : defaultName(form.kind, form.values.lender)} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <span className="field-help">{t("set.loans.name_help")}</span>
        </div>
        <div className="loan-field">
          <label className="field-label" htmlFor={idOf("kind")}>
            Laji
          </label>
          <select id={idOf("kind")} value={form.kind} required aria-invalid={errors.kind ? true : undefined} aria-describedby={errors.kind ? idOf("kind-error") : undefined} onChange={(e) => setForm(setKind(form, e.target.value as LoanKind | ""))}>
            <option value="">Valitse laji</option>
            {LOAN_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </select>
          {errors.kind && (
            <span id={idOf("kind-error")} className="field-error">
              {errors.kind}
            </span>
          )}
        </div>
      </div>
      )}

      <div className="loan-fields">
        {shown.map((key) => {
          const help = key === "paymentCents" ? paymentHelp(form) : key === "balanceCents" && linked ? LINKED_BALANCE_HELP() : key === "rateReviewDate" ? REVIEW_HELP() : null;
          const described = [help && idOf(`${key}-help`), errors[key] && idOf(`${key}-error`)].filter(Boolean).join(" ") || undefined;
          return (
            <div key={key} className="loan-field">
              <div className="loan-field-head">
                <label className="field-label" htmlFor={idOf(key)}>
                  {FIELD_LABEL[key]}
                  {UNIT[key] ? ` (${UNIT[key]})` : ""}
                </label>
              </div>
              {input(key, described)}
              {help && (
                <span id={idOf(`${key}-help`)} className="field-help">
                  {help}
                </span>
              )}
              {errors[key] && (
                <span id={idOf(`${key}-error`)} className="field-error">
                  {errors[key]}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {choices.length > 0 && !compact && (
        <div className="loan-field">
          <label className="field-label" htmlFor={idOf("account")}>
            {t("set.loans.same_debt")}
          </label>
          <select id={idOf("account")} value={linked} aria-describedby={idOf("account-help")} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
            <option value="">{t("set.loans.not_linked")}</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <span id={idOf("account-help")} className="field-help">
            {LINK_HELP()}
          </span>
        </div>
      )}

      {form.values.repayment === "bullet" && shown.includes("repayment") && <p className="small muted loan-note">{t("set.loans.bullet_note")}</p>}

      {interest !== null && (
        <Notice tone="warning" className="loan-interest" role="status">
          <p>
            {t("set.loans.interest_warning", { interest: money(interest) })}
          </p>
          <Button variant="link" onClick={() => change("paymentCents", "")}>
            {t("set.loans.clear_payment")}
          </Button>
        </Notice>
      )}

      {problem && (
        <Notice tone="error">
          {problem}
        </Notice>
      )}
      <div className="form-row">
        <Button variant="primary" type="submit" busy={busy}>
          {busy ? t("set.loans.saving") : t("ui.save")}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </Button>
        {compact && (
          <Button variant="link" onClick={() => setAll(true)}>
            {t("set.loans.show_all")}
          </Button>
        )}
      </div>
    </form>
  );
}
