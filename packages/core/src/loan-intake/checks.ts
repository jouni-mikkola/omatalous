/**
 * Cross-checks of one draft. A figure that disagrees with the others was probably misread, so the check lowers the
 * fields it compared to `check` and adds a warning. It never changes a value and never fills one in.
 */
import { DAYS_PER_MONTH } from "../dates.ts";
import type { IsoDate } from "../types.ts";
import type { LoanDraftField, LoanDraftKey, LoanDraftValues, LoanDraftWarning, LoanDraftWarningId, LoanTextOptions } from "./types.ts";

export type DraftFields = { [K in LoanDraftKey]?: LoanDraftField<LoanDraftValues[K]> };

/** Above this a loan's rate is more likely a lost comma (4,5 % read as 45 %) than a rate. */
const RATE_HIGH_BP = 2500;
/** Three figures rounded to hundredths can be this far from their sum, and a little more. */
const RATE_SUM_SLACK_BP = 5;
/** How far a payment may be from the computed one: fees and insurance ride on it, and the end date moves by a month. */
const PAYMENT_SLACK = 0.15;
const PAYMENT_SLACK_CENTS = 500;

/** The sentence of each warning. The loan form repeats `payment_whole` when the household picks Tasalyhennys itself. */
export const LOAN_DRAFT_WARNING_TEXT: Record<LoanDraftWarningId, string> = {
  rate_sum: "Kokonaiskorko ei ole viitekoron ja marginaalin summa. Tarkista korot.",
  rate_high: `Korko on yli ${RATE_HIGH_BP / 100} %. Tarkista pilkun paikka.`,
  balance_over_granted: "Lainaa on jäljellä enemmän kuin sitä myönnettiin. Tarkista summat.",
  balance_over_limit: "Lainaa on jäljellä enemmän kuin luottoraja sallii. Tarkista summat.",
  payment_annuity: "Maksuerä ei vastaa jäljellä olevaa lainaa, korkoa ja viimeistä eräpäivää. Tarkista luvut.",
  payment_whole: "Tasalyhennyslainan maksueräksi merkitään pelkkä lyhennys. Tekstin maksuerässä on korko mukana. Tarkista maksuerä.",
  end_passed: "Viimeinen eräpäivä on jo mennyt. Tarkista päivämäärät.",
  two_values: "Tekstissä on samalle tiedolle kaksi eri arvoa. Tarkista, kumpi on oikea.",
  mixed_loans: "Osa tiedoista voi kuulua toiselle lainalle. Tarkista ne.",
};

/** Lowers the named fields that the draft has to `check` and records why, once per warning id. */
export function lower(fields: DraftFields, warnings: LoanDraftWarning[], id: LoanDraftWarningId, keys: readonly LoanDraftKey[]): void {
  const present = keys.filter((k) => fields[k] !== undefined);
  for (const k of present) fields[k]!.confidence = "check";
  const old = warnings.find((w) => w.id === id);
  if (!old) warnings.push({ id, text: LOAN_DRAFT_WARNING_TEXT[id], fields: present });
  else for (const k of present) if (!old.fields.includes(k)) old.fields.push(k);
}

function monthsBetween(from: IsoDate, to: IsoDate): number {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  return (ty - fy) * 12 + (tm - fm) + (td - fd) / DAYS_PER_MONTH;
}

/** One whole payment of a loan with `periods` payments left, at the rate of one period. */
function paymentOf(repayment: LoanDraftValues["repayment"], balance: number, rate: number, periods: number): number {
  if (repayment === "bullet") return balance * rate;
  if (repayment === "equal_principal") return balance / periods + balance * rate;
  // an annuity; a fixed instalment is one at today's rate, with an end date that moves
  return rate === 0 ? balance / periods : (balance * rate) / (1 - (1 + rate) ** -periods);
}

/** What the text gave beside the draft's fields. */
export interface CheckInputs {
  /** The reference rate's own value, when the text printed one beside Viitekorko. It is no field of the loan. */
  referenceBp?: number;
  /** `paymentCents` came from Lyhennys: the principal part of an equal-principal loan's payment, with no interest. */
  amortisationOnly?: boolean;
}

export function crossCheck(fields: DraftFields, warnings: LoanDraftWarning[], { referenceBp, amortisationOnly }: CheckInputs, options: LoanTextOptions): void {
  const warn = (id: LoanDraftWarningId, ...keys: LoanDraftKey[]) => lower(fields, warnings, id, keys);
  const { rateBp, marginBp, balanceCents, grantedCents, limitCents, paymentCents, endDate } = fields;

  if (rateBp && rateBp.value > RATE_HIGH_BP) warn("rate_high", "rateBp");
  // a margin is a part of the rate, so the same limit finds its lost comma ("Marginaali 65 %" for 0,65 %)
  if (marginBp && marginBp.value > RATE_HIGH_BP) warn("rate_high", "marginBp");
  if (rateBp && marginBp && referenceBp !== undefined && fields.reference?.value !== "fixed") {
    if (Math.abs(rateBp.value - referenceBp - marginBp.value) > RATE_SUM_SLACK_BP) warn("rate_sum", "rateBp", "marginBp");
  }
  if (balanceCents && grantedCents && balanceCents.value > grantedCents.value) warn("balance_over_granted", "balanceCents", "grantedCents");
  if (balanceCents && limitCents && balanceCents.value > limitCents.value) warn("balance_over_limit", "balanceCents", "limitCents");
  // a loan has a granted amount, a credit line a limit: two different ones are most likely two loans read as one
  if (grantedCents && limitCents && grantedCents.value !== limitCents.value) warn("mixed_loans", "grantedCents", "limitCents");

  const asOf = fields.balanceDate?.value ?? options.asOf;
  if (!endDate || !asOf) return;
  if (endDate.value < asOf) return warn("end_passed", "endDate", "balanceDate");
  // the amortisation alone needs no rate: it is the balance over the payments left
  if (!paymentCents || !balanceCents || balanceCents.value <= 0 || (!rateBp && !amortisationOnly)) return;
  const interval = fields.intervalMonths?.value ?? 1;
  const periods = Math.max(1, Math.round(monthsBetween(asOf, endDate.value) / interval));
  const rate = amortisationOnly ? 0 : ((rateBp?.value ?? 0) / 10_000 / 12) * interval;
  // with no Lyhennystapa in the text, either common kind may explain the payment
  const kinds = fields.repayment ? [fields.repayment.value] : (["annuity", "equal_principal"] as const);
  const expected = kinds.flatMap((kind) => [periods - 1, periods, periods + 1].filter((n) => n >= 1).map((n) => paymentOf(kind, balanceCents.value, rate, n)));
  const low = Math.min(...expected) * (1 - PAYMENT_SLACK) - PAYMENT_SLACK_CENTS;
  const high = Math.max(...expected) * (1 + PAYMENT_SLACK) + PAYMENT_SLACK_CENTS;
  if (paymentCents.value >= low && paymentCents.value <= high) return;
  if (amortisationOnly) warn("payment_annuity", "paymentCents", "balanceCents", "endDate");
  else warn("payment_annuity", "paymentCents", "balanceCents", "rateBp", "endDate");
}
