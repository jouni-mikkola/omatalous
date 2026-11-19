import { type Fixings, LOAN_KINDS, LOAN_REFERENCES, LOAN_REPAYMENTS, type Loan, type LoanDraft, type LoanKind } from "@banking/core";
import { createContext, type FormEvent, type ReactNode, useContext, useId, useState } from "react";
import { date, money, percent } from "../../format.ts";
import { t } from "../../text.ts";
import type { Account } from "../../types.ts";
import { checksLeft, defaultName, formOfDraft, type FormErrors, interestOverPayment, type LoanBody, type LoanForm, linkChoices, markOf, matchedLoan, rateNow, readForm, setKind, setValue, shownFields, toggleConfirmed } from "./form.ts";
import { LoanSource } from "./LoanSource.tsx";
import { FIELD_LABEL, INTERVALS, intervalLabel, KIND_LABEL, type LoanFieldKey, referenceName, REPAYMENT_LABEL } from "./labels.ts";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import "../../styles/loans.css";
const UNIT: Partial<Record<LoanFieldKey, string>> = { balanceCents: "€", grantedCents: "€", limitCents: "€", paymentCents: "€", paymentFeeCents: "€", rateBp: "%", marginBp: "%", rateStepBp: "%" };

/**
 * What the select "Sama velka pankin tilillä" offers from: the household's accounts and its saved loans (an account
 * another loan holds is not offered). The loans card provides it to every form it holds, so the new loan and the
 * proposals need no props for it. Without a provider the select is not shown. `fixings` are the published fixings of
 * `GET /api/loans`, which a loan on a euribor counts its rate from (`rateNow`).
 */
export const LoanLinks = createContext<{ accounts: readonly Account[]; loans: readonly Loan[]; fixings?: Fixings }>({ accounts: [], loans: [] });

/**
 * The form of one loan: a loan typed in, a proposal from the bank's rows, or a saved loan. Nothing is sent before
 * Tallenna.
 */
export function LoanEditor({ initial, today, cancelLabel, saveLabel, noSource, ask, balanceOn, onSeveral, onSave, onCancel }: {
  initial: LoanForm;
  /** The balance's label names the day it is of ("Jäljellä 16.10. (€)"), where the form asks the balance of one debt among others. */
  balanceOn?: boolean;
  /** The save button's name, when it does not save the loan itself (a row of the table of read loans). */
  saveLabel?: string;
  /** The form of a row that is read already has no input box, and neither has a form that asks for given fields only. */
  noSource?: boolean;
  /**
   * Where a read text of several loans, or of a loan the household has saved already, goes: a table that saves them all.
   * Without it the form takes the first loan of the text.
   */
  onSeveral?: (drafts: LoanDraft[]) => void;
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
  const links = useContext(LoanLinks);
  const fields = shownFields(form, links.fixings);
  // on a euribor whose fixing is stored the margin stands in for the rate, so asking the rate asks the margin
  const asked: readonly LoanFieldKey[] = ask?.includes("rateBp") && !fields.includes("rateBp") ? [...ask, "marginBp"] : (ask ?? []);
  // a review day asked shows while a euribor is chosen: a fixed rate has none and an unknown one is picked first
  const euribor = form.values.reference !== "" && form.values.reference !== "fixed";
  const shown = fields.filter((key) => !compact || (asked.includes(key) && (key !== "rateReviewDate" || euribor)));
  const interest = interestOverPayment(form, links.fixings);
  const rate = rateNow(form, links.fixings);
  const left = checksLeft(form);
  const choices = linkChoices(links.accounts, links.loans, form.id);
  // a stored link to an account that is not offered any more (removed, no card or loan account) is not kept by a save
  const linked = choices.some((c) => c.id === form.accountId) ? form.accountId : "";
  const idOf = (key: string) => `${uid}-${key}`;
  const change = (key: LoanFieldKey, text: string) => setForm((f) => setValue(f, key, text));

  // the text of a read: one new loan fills this form, several loans (or one already saved) go to the table
  const take = (drafts: LoanDraft[]) => {
    const next = formOfDraft(drafts[0]!, today, form);
    if (onSeveral && (drafts.length > 1 || matchedLoan(next, links.loans) !== null)) return onSeveral(drafts);
    setForm(next);
    setErrors({});
    setProblem(null);
    setAll(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const { body, errors: found } = readForm({ ...form, accountId: linked }, links.fixings);
    setErrors(found);
    // an error on a field that is not shown opens the rest of the form
    if (compact && (interest !== null || Object.keys(found).some((key) => key !== "kind" && !shown.includes(key as LoanFieldKey)))) setAll(true);
    const stop = Object.keys(found)[0] ?? left[0] ?? (interest !== null ? "paymentCents" : null);
    if (!body || stop) {
      setProblem(
        Object.keys(found).length > 0
          ? t("set.loans.fix_marked")
          : left.length > 0
            ? t("set.ln.check_these", { fields: left.map((key) => FIELD_LABEL[key]).join(", ") })
            : t("set.loans.payment_below_interest"),
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
    if (key === "reference") return pick(LOAN_REFERENCES.map((id) => [id, referenceName(id)] as const));
    if (key === "repayment") return pick(LOAN_REPAYMENTS.map((id) => [id, REPAYMENT_LABEL[id]] as const));
    if (key === "intervalMonths") {
      const current = Number(form.values.intervalMonths);
      const months = current > 0 && !INTERVALS.some((m) => m === current) ? [...INTERVALS, current].sort((a, b) => a - b) : INTERVALS;
      return pick(months.map((m) => [String(m), intervalLabel(m)] as const));
    }
    if (key === "balanceDate" || key === "endDate" || key === "rateReviewDate" || key === "rateStepDate") return <input {...common} type="date" max={key === "balanceDate" ? today : undefined} required={key === "balanceDate"} onChange={(e) => change(key, e.target.value)} />;
    if (key === "lender") return <input {...common} type="text" maxLength={80} autoComplete="off" onChange={(e) => change(key, e.target.value)} />;
    return <input {...common} type="text" inputMode="decimal" autoComplete="off" required={key === "balanceCents"} onChange={(e) => change(key, e.target.value)} />;
  };

  return (
    <form className="loan-form" onSubmit={(e) => void submit(e)} noValidate>
      {form.id === null && !noSource && !ask && <LoanSource today={today} onDrafts={take} />}
      {!compact && (
      <div className="loan-fields">
        <div className="loan-field">
          <label className="field-label" htmlFor={idOf("name")}>
            {t("set.loans.name")}
          </label>
          <input id={idOf("name")} type="text" maxLength={80} autoComplete="off" value={form.name} placeholder={form.kind === "" ? "" : defaultName(form.kind, form.values.lender)} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
          const mark = markOf(form, key);
          const confirmed = form.confirmed.includes(key);
          // a value read with confidence and a field the household confirmed carry nothing: only what still asks is marked
          const badge = mark === "missing" || (mark === "check" && !confirmed) ? mark : null;
          const line = mark === "check" ? form.source?.lines[key] : undefined;
          const why = form.source?.warnings[key]?.join(" ");
          const described = [badge && idOf(`${key}-mark`), line && idOf(`${key}-line`), why && !confirmed && idOf(`${key}-warning`), key === "marginBp" && rate !== null && idOf("rate-now"), errors[key] && idOf(`${key}-error`)].filter(Boolean).join(" ") || undefined;
          return (
            <div key={key} className={`loan-field${mark === "check" && !confirmed ? " to-check" : ""}`}>
              <div className="loan-field-head">
                <label className="field-label" htmlFor={idOf(key)}>
                  {key === "balanceCents" && balanceOn && form.values.balanceDate ? t("set.rc.lt_left_on", { date: date(form.values.balanceDate, today) }) : `${FIELD_LABEL[key]}${UNIT[key] ? ` (${UNIT[key]})` : ""}`}
                </label>
                {badge && (
                  <span id={idOf(`${key}-mark`)} className={`badge${badge === "check" ? " warn" : ""}`}>
                    {badge === "missing" ? t("set.ln.mark_missing") : t("set.ln.mark_check")}
                  </span>
                )}
              </div>
              {input(key, described)}
              {line && (
                <span id={idOf(`${key}-line`)} className="loan-source">
                  {t("set.ln.in_the_text", { line })}
                </span>
              )}
              {why && !confirmed && (
                <span id={idOf(`${key}-warning`)} className="loan-source">
                  {why}
                </span>
              )}
              {mark === "check" && (
                <label className="loan-confirm">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setForm(toggleConfirmed(form, key, e.target.checked))} aria-label={t("set.ln.field_is_correct", { field: FIELD_LABEL[key] })} />
                  {t("set.ln.correct")}
                </label>
              )}
              {key === "marginBp" && rate !== null && (
                <span id={idOf("rate-now")} className="loan-rate-now">
                  {t("set.loans.rate_now", { rate: percent(rate / 10_000, 2) })}
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
          <select id={idOf("account")} value={linked} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
            <option value="">{t("set.loans.not_linked")}</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      )}

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
          {busy ? t("set.loans.saving") : (saveLabel ?? t("ui.save"))}
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
