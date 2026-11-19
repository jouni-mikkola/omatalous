/**
 * The drill of a loan in Raportit > Lainat: what its next 12 months cost, what is left of it, its rate, and what a new
 * payment or an extra repayment does to its end and its interest. And the drill of the plan line: the order the debts
 * are paid in, and what one new loan for the dear debts would cost. Every figure is core's (`loanSchedule`,
 * `loanWhatIf`, `loanRateLine`, `consolidationCost`, the report's `plan`) on the saved loan and the published fixings;
 * nothing is worked out here.
 */
import { belowWhole, consolidationCost, type Loan, loanBalanceOn, loanPaymentAfter, loanRateLine, type LoanRow, loanSchedule, type LoansReport, loansOf, loanWhatIf, type LoanUnknown, NO_INPUTS, THRESHOLDS } from "@banking/core";
import { useId, useMemo, useState } from "react";
import { date, eurosText, money, parseEuros, parseRate, percent, plainNumber } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { t } from "../../text.ts";
import type { LoansAnswer } from "../../types.ts";

/** A payment typed above ten times the plan's is a slip of the finger. */
const MAX_PAYMENT_TIMES = 10;

/** What the figures wait for, said as the field that is missing. */
function missing(field: LoanUnknown | "fee"): string {
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
    const made = reference === null ? rate : line.fixingMilli !== null && line.marginBp !== null ? t("rpt.ln_wi_rate_made", { rate, reference, fixing: percent(line.fixingMilli / 100_000, 3), margin: percent(line.marginBp / 10_000, 3) }) : line.marginBp !== null ? t("rpt.ln_wi_rate_margin", { rate, margin: percent(line.marginBp / 10_000, 3) }) : t("rpt.ln_wi_rate_ref", { rate, reference });
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
  const owed = loanBalanceOn(loan, from).cents;
  const schedule = loanSchedule(loan, from);
  const summary = schedule.summary;
  const current = loanPaymentAfter(loan, from);
  const months = loan.intervalMonths ?? 1;
  const paymentCents = current === null ? null : clamped(paymentInput, current * MAX_PAYMENT_TIMES);
  const extraCents = clamped(extraInput, owed ?? 0);
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
        ...(what.lower === null ? [] : [t("rpt.ln_wi_lower", { payment: paymentText(what.lower.cents, months) })]),
      ];
      result = parts.join(" · ");
    } else if (extraCents !== null && owed !== null && extraCents >= owed && summary !== null && summary.interestLeftCents !== null) {
      // the whole balance paid at once: it ends this month and the interest to come is what it saves
      result = [t("rpt.ln_wi_ends", { month: monthYear(from) }), t("rpt.ln_wi_saves", { amount: money(summary.interestLeftCents, false) })].join(" · ");
    } else {
      // a loan whose payments did not clear it can end with the change: what it then costs, with no earlier end to compare
      const changed = loanSchedule(loan, from, change).summary;
      result = changed === null || changed.interestLeftCents === null ? t("rpt.ln_wi_never") : [t("rpt.ln_wi_ends", { month: monthYear(changed.endDate) }), t("rpt.ln_wi_interest", { amount: money(changed.interestLeftCents, false) })].join(" · ");
    }
  }

  const figures: [label: string, value: string | null][] = [
    [t("rpt.ln_wi_left"), owed === null ? null : money(owed)],
    [t("rpt.ln_wi_payments_left"), summary === null ? null : plainNumber(summary.paymentsLeft)],
    [t("rpt.ln_wi_interest_left"), summary === null || summary.interestLeftCents === null ? null : money(summary.interestLeftCents)],
    [t("rpt.ln_wi_last"), summary !== null ? date(summary.endDate) : schedule.never ? t("rpt.ln_wi_never") : null],
  ];
  return (
    <>
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
                {t(loan.repayment === "equal_principal" ? (months === 1 ? "rpt.ln_wi_principal" : "rpt.ln_wi_principal_n") : months === 1 ? "rpt.ln_wi_payment" : "rpt.ln_wi_payment_n")}
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
      <p className="loan-wi-result" role="status">
        {result}
      </p>
    </>
  );
}

/**
 * What a debt's next 12 months cost, split into interest and fees where the evidence splits a payment, and for a loan the
 * viewer typed in whole the figures and what-if of its plan. The drill opens with its row, so the loans and fixings are
 * asked for only then.
 */
export function LoanDrill({ l, today, whatIf }: { l: LoanRow; today: string; whatIf: boolean }) {
  const next = l.cost?.next12 ?? null;
  const parts: [label: string, cents: number][] = next === null || next.interestCents === null || next.feeCents === null ? [] : [[t("rpt.ln_cost12_interest"), next.interestCents], [t("rpt.ln_cost12_fees"), next.feeCents]];
  const unknown = l.cost?.unknown ?? null;
  return (
    <div className="loan-wi">
      {parts.length > 0 && (
        <dl className="loan-figures loan-wi-cost">
          {parts.map(([label, cents]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{money(cents, false)}</dd>
            </div>
          ))}
        </dl>
      )}
      {unknown !== null && (unknown === "fee" || !whatIf) && <p className="loan-wi-status">{missing(unknown)}</p>}
      {whatIf && <Body id={l.id} today={today} />}
    </div>
  );
}

/** Whether a loan's what-if can be worked out here: a loan the viewer typed in whole, which `GET /api/loans` sends. */
export const hasWhatIf = (l: LoanRow): boolean => !l.id.startsWith("account:") && !l.typedBy && !belowWhole(l.part);

type Plan = NonNullable<LoansReport["plan"]>;
type Basis = NonNullable<LoansReport["consolidation"]>;

/** The bounds of a saved loan (`routes/loans.ts`): fifty years, 50 % a year; a fee of a thousand euros a payment is a slip of the finger. */
const MAX_OFFER_MONTHS = 600;
const MAX_OFFER_RATE_BP = 5000;
const MAX_OFFER_FEE_CENTS = 100_000;

/** What the typed offer says, or null until a rate and a term that make a loan are typed. The fee may stay empty: it is then 0. */
function offerOf(rateText: string, monthsText: string, feeText: string): { rateBp: number; months: number; feeCents: number } | null {
  const rateBp = parseRate(rateText.trim());
  const months = /^\d{1,4}$/.test(monthsText.trim()) ? Number(monthsText.trim()) : null;
  const feeCents = feeText.trim() === "" ? 0 : parseEuros(feeText);
  if (rateBp === null || rateBp > MAX_OFFER_RATE_BP || months === null || months < 1 || months > MAX_OFFER_MONTHS || feeCents === null || feeCents < 0 || feeCents > MAX_OFFER_FEE_CENTS) return null;
  return { rateBp, months, feeCents };
}

/** The fields of an offer and its one line. */
function Consolidation({ basis, names, today }: { basis: Basis; names: readonly string[]; today: string }) {
  const [rate, setRate] = useState("");
  const [months, setMonths] = useState("");
  const [fee, setFee] = useState("");
  const id = useId();
  const offer = offerOf(rate, months, fee);
  const cost = offer === null ? null : consolidationCost(basis, today, offer);
  const gap = cost?.savedCents ?? 0;
  const field = (key: string, label: string, value: string, set: (v: string) => void) => (
    <div className="loan-field">
      <label className="field-label" htmlFor={`${id}-${key}`}>
        {label}
      </label>
      <input id={`${id}-${key}`} type="text" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => set(e.target.value)} />
    </div>
  );
  return (
    <div className="loan-wi">
      <h4 className="loan-plan-head">{t("rpt.ln_consol")}</h4>
      <dl className="loan-figures loan-wi-cost">
        <div>
          <dt>{t("rpt.ln_consol_debts")}</dt>
          <dd>{names.join(", ")}</dd>
        </div>
        <div>
          <dt>{t("rpt.ln_consol_owed")}</dt>
          <dd>{money(basis.owedCents, false)}</dd>
        </div>
        <div>
          <dt>{t("rpt.ln_consol_now")}</dt>
          <dd>{money(basis.nowCents, false)}</dd>
        </div>
      </dl>
      <div className="loan-fields">
        {field("rate", t("rpt.ln_consol_rate"), rate, setRate)}
        {field("months", t("rpt.ln_consol_months"), months, setMonths)}
        {field("fee", t("rpt.ln_consol_fee"), fee, setFee)}
      </div>
      <p className="loan-wi-result" role="status">
        {cost === null ? null : [t("rpt.ln_consol_new", { amount: money(cost.newCents, false) }), gap === 0 ? t("rpt.ln_consol_same") : t(gap > 0 ? "rpt.ln_consol_less" : "rpt.ln_consol_more", { amount: money(Math.abs(gap), false) })].join(" · ")}
      </p>
    </div>
  );
}

/**
 * The plan line above the list, "Velaton 3/2029 · säästät 410 €", and under it: the debts in the order the money from a
 * paid-off debt goes to the next, the cost of paying the smallest debt first when it is at least `snowballGapCents`
 * more, and the offer of one loan for the dear debts. Null when the plan is not known (`plan` is null).
 */
export function PlanDrill({ plan, basis, loans, today }: { plan: Plan | null; basis: Basis | null; loans: readonly LoanRow[]; today: string }) {
  if (plan === null) return null;
  const name = (id: string) => loans.find((l) => l.id === id)?.name ?? id;
  const line = [t("rpt.ln_free_by", { month: monthYear(plan.debtFreeDate) }), ...(plan.savedCents > 0 ? [t("rpt.ln_saves", { amount: money(plan.savedCents, false) })] : [])].join(" · ");
  return (
    <details className="loan-plan">
      <summary>{line}</summary>
      <div className="loan-wi">
        <h4 className="loan-plan-head">{t("rpt.ln_plan_order")}</h4>
        <ol className="loan-plan-list">
          {plan.debts.map((d) => (
            <li key={d.id}>{d.endDate === d.baseEndDate ? t("rpt.ln_plan_end", { name: name(d.id), month: monthYear(d.endDate) }) : t("rpt.ln_plan_own", { name: name(d.id), month: monthYear(d.endDate), own: monthYear(d.baseEndDate) })}</li>
          ))}
        </ol>
        {plan.snowballExtraCents >= THRESHOLDS.snowballGapCents.value && <p className="loan-wi-status">{t("rpt.ln_snowball", { amount: money(plan.snowballExtraCents, false) })}</p>}
      </div>
      {basis !== null && <Consolidation basis={basis} names={basis.debtIds.map(name)} today={today} />}
    </details>
  );
}
