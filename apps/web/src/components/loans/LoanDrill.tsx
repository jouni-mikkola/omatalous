/**
 * The drill of a loan in Raportit > Lainat: what is left of it, its rate, and what a new payment or an extra repayment
 * does to its end and its interest. Every figure is core's (`loanSchedule`, `loanWhatIf`, `loanRateLine`) on the saved
 * loan and the published fixings; nothing is worked out here.
 */
import { type Loan, loanBalanceOn, loanPaymentAfter, loanRateLine, loanSchedule, loansOf, loanWhatIf, type LoanUnknown, NO_INPUTS } from "@banking/core";
import { useId, useMemo, useState } from "react";
import { date, eurosText, money, parseEuros, percent, plainNumber } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { t } from "../../text.ts";
import type { LoansAnswer } from "../../types.ts";

/** A payment typed above ten times the plan's is a slip of the finger. */
const MAX_PAYMENT_TIMES = 10;

/** What the figures wait for, said as the field that is missing. */
function missing(field: LoanUnknown): string {
  switch (field) {
    case "payment":
      return t("rpt.ln_wi_missing_payment");
    case "rate":
      return t("rpt.ln_wi_missing_rate");
    case "repayment":
      return t("rpt.ln_wi_missing_repayment");
    case "interval":
      return t("rpt.ln_wi_missing_interval");
    case "end_date":
      return t("rpt.ln_wi_missing_end_date");
    default:
      return t("rpt.ln_wi_missing_other");
  }
}

/** "3/2041": the month a loan ends in. */
const monthYear = (day: string) => `${Number(day.slice(5, 7))}/${day.slice(0, 4)}`;

/** "4 v 2 kk": a span of whole months. */
function span(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [years > 0 ? t("rpt.ln_wi_years", { n: years }) : null, rest > 0 ? t("rpt.ln_wi_months", { n: rest }) : null].filter(Boolean).join(" ");
}

/** A payment as the loan pays it: "640 €/kk" each month, else the sum. */
const paymentText = (cents: number, months: number) => (months === 1 ? t("rpt.ln_per_month", { amount: money(cents) }) : money(cents));

/** Euros typed in an input held to 0…max, cents; null when the text is no amount. */
function clamped(text: string, max: number): number | null {
  const cents = parseEuros(text);
  return cents === null ? null : Math.min(max, Math.max(0, cents));
}

function Rate({ loan, day }: { loan: Loan; day: string }) {
  const line = loanRateLine(loan, day);
  let text: string | null = null;
  if (line !== null) {
    const rate = percent(line.rateMilli / 100_000, 3);
    const reference = line.reference !== null && line.reference !== "fixed" ? t("rpt.ln_wi_euribor", { months: line.reference.replace("euribor_", "") }) : null;
    const made = reference === null ? rate : line.fixingMilli !== null && line.marginBp !== null ? t("rpt.ln_wi_rate_made", { rate, reference, fixing: percent(line.fixingMilli / 100_000, 3), margin: percent(line.marginBp / 10_000, 3) }) : t("rpt.ln_wi_rate_ref", { rate, reference });
    text = line.reviewDate === null ? made : t("rpt.ln_wi_review", { line: made, date: date(line.reviewDate) });
  }
  return (
    <dl className="loan-figures loan-wi-rate">
      <div>
        <dt>{t("rpt.ln_rate")}</dt>
        <dd className={text === null ? "unknown" : undefined}>{text ?? "–"}</dd>
      </div>
    </dl>
  );
}

function Body({ id, today }: { id: string; today: string }) {
  const answer = useApi<LoansAnswer>("/api/loans");
  const [paymentInput, setPaymentInput] = useState("");
  const [extraInput, setExtraInput] = useState("");
  const inputId = useId();
  const loan = useMemo(() => {
    if (answer.data === null) return null;
    return loansOf({ ...NO_INPUTS, loans: answer.data.loans, fixings: answer.data.fixings }).find((l) => l.id === id) ?? null;
  }, [answer.data, id]);
  if (loan === null) return answer.error === null ? null : <p className="loan-wi-status">{answer.error}</p>;

  const from = today < loan.balanceDate ? loan.balanceDate : today;
  const balance = loanBalanceOn(loan, from);
  const schedule = loanSchedule(loan, from);
  const summary = schedule.summary;
  const current = loanPaymentAfter(loan, from);
  const months = loan.intervalMonths ?? 1;
  const paymentCents = current === null ? null : clamped(paymentInput, current * MAX_PAYMENT_TIMES);
  const extraCents = clamped(extraInput, balance.cents ?? 0);
  const change = paymentCents === null && !extraCents ? null : { ...(paymentCents === null ? {} : { paymentCents }), ...(extraCents ? { extra: { cents: extraCents, on: from } } : {}) };
  const shown = schedule.unknown === null && (summary !== null || schedule.never);

  let result: string | null = null;
  if (shown && change !== null) {
    const what = loanWhatIf(loan, from, change);
    if (what !== null) {
      const { endDate, monthsSooner, interestSavedCents } = what.shorter;
      const parts = [
        monthsSooner === 0 ? t("rpt.ln_wi_ends", { month: monthYear(endDate) }) : t("rpt.ln_wi_ends_by", { month: monthYear(endDate), span: t(monthsSooner > 0 ? "rpt.ln_wi_sooner" : "rpt.ln_wi_later", { span: span(Math.abs(monthsSooner)) }) }),
        ...(interestSavedCents === 0 ? [] : [t(interestSavedCents > 0 ? "rpt.ln_wi_saves" : "rpt.ln_wi_costs", { amount: money(Math.abs(interestSavedCents), false) })]),
        ...(what.lower === null ? [] : [t("rpt.ln_wi_lower", { payment: paymentText(what.lower.paymentCents, months) })]),
      ];
      result = parts.join(" · ");
    } else if (extraCents !== null && balance.cents !== null && extraCents >= balance.cents && summary !== null && summary.interestLeftCents !== null) {
      // the whole balance paid at once: it ends this month and the interest to come is what it saves
      result = [t("rpt.ln_wi_ends", { month: monthYear(from) }), t("rpt.ln_wi_saves", { amount: money(summary.interestLeftCents, false) })].join(" · ");
    } else {
      // a loan whose payments did not clear it can end with the change: what it then costs, with no earlier end to compare
      const changed = loanSchedule(loan, from, change).summary;
      result = changed === null || changed.interestLeftCents === null ? t("rpt.ln_wi_never") : [t("rpt.ln_wi_ends", { month: monthYear(changed.endDate) }), t("rpt.ln_wi_interest", { amount: money(changed.interestLeftCents, false) })].join(" · ");
    }
  }

  const figures: [label: string, value: string | null][] = [
    [t("rpt.ln_wi_left"), balance.cents === null ? null : money(balance.cents)],
    [t("rpt.ln_wi_payments_left"), summary === null ? null : plainNumber(summary.paymentsLeft)],
    [t("rpt.ln_wi_interest_left"), summary === null || summary.interestLeftCents === null ? null : money(summary.interestLeftCents)],
    [t("rpt.ln_wi_last"), summary !== null ? date(summary.endDate) : schedule.never ? t("rpt.ln_wi_never") : null],
  ];
  return (
    <div className="loan-wi">
      <dl className="loan-figures">
        {figures.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={value === null ? "unknown" : undefined}>{value ?? "–"}</dd>
          </div>
        ))}
      </dl>
      <Rate loan={loan} day={from} />
      {schedule.unknown !== null && <p className="loan-wi-status">{missing(schedule.unknown)}</p>}
      {shown && (
        <div className="loan-fields">
          {current !== null && (
            <div className="loan-field">
              <label className="field-label" htmlFor={`${inputId}-payment`}>
                {t(months === 1 ? "rpt.ln_wi_payment" : "rpt.ln_wi_payment_n")}
              </label>
              <input
                id={`${inputId}-payment`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={paymentInput}
                placeholder={eurosText(current)}
                onChange={(e) => setPaymentInput(e.target.value)}
                onBlur={() => paymentCents !== null && setPaymentInput(eurosText(paymentCents))}
              />
            </div>
          )}
          <div className="loan-field">
            <label className="field-label" htmlFor={`${inputId}-extra`}>
              {t("rpt.ln_wi_extra")}
            </label>
            <input id={`${inputId}-extra`} type="text" inputMode="decimal" autoComplete="off" value={extraInput} onChange={(e) => setExtraInput(e.target.value)} onBlur={() => extraCents !== null && setExtraInput(eurosText(extraCents))} />
          </div>
        </div>
      )}
      {result !== null && (
        <p className="loan-wi-result" role="status">
          {result}
        </p>
      )}
    </div>
  );
}

/** A fold under the figures of a loan. It asks the server for the loans and fixings only once it is opened. */
export function LoanDrill({ id, today }: { id: string; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="loan-drill" open={open}>
      <summary
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
      >
        {t("rpt.ln_wi_drill")}
      </summary>
      {open && <Body id={id} today={today} />}
    </details>
  );
}
