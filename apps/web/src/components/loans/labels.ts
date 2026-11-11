/** The Finnish names of a loan's fields and choices, shared by the list and the form of Asetukset > Lainat. */
import { LOAN_REFERENCE_LABEL, MAX_LOAN_INTERVAL_MONTHS } from "@banking/core";
import type { Loan, LoanKind } from "@banking/core";
import { t } from "../../text.ts";

/** An object of labels whose text follows the member's language: each read asks the catalogue. */
function labels<K extends string>(codes: Record<K, () => string>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of Object.keys(codes) as K[]) Object.defineProperty(out, key, { enumerable: true, get: codes[key] });
  return out;
}

export const KIND_LABEL: Record<LoanKind, string> = labels({
  mortgage: () => t("rpt.ln_kind_mortgage"),
  consumer: () => t("rpt.ln_kind_consumer"),
  car: () => t("rpt.ln_kind_car"),
  student: () => t("rpt.ln_kind_student"),
  credit_line: () => t("rpt.ln_kind_credit_line"),
  card: () => t("rpt.ln_kind_card"),
  instalment: () => t("rpt.ln_kind_instalment"),
  other: () => t("rpt.ln_kind_other"),
});

/** The name of a reference rate in the member's language. */
export const referenceName = (reference: NonNullable<Loan["reference"]>): string => t(`rpt.ln_ref_${reference}`);

/** The names the Säästövinkit rate question uses. */
export const REFERENCE_LABEL: Record<NonNullable<Loan["reference"]>, string> = LOAN_REFERENCE_LABEL;

export const REPAYMENT_LABEL: Record<NonNullable<Loan["repayment"]>, string> = labels({
  annuity: () => t("rpt.ln_rep_annuity"),
  equal_principal: () => t("rpt.ln_rep_equal_principal"),
  fixed_instalment: () => t("rpt.ln_rep_fixed_instalment"),
  bullet: () => t("rpt.ln_rep_bullet"),
});

/** A field of the loan form. Name and kind stand above them. */
export type LoanFieldKey = "lender" | "balanceCents" | "balanceDate" | "grantedCents" | "limitCents" | "rateBp" | "reference" | "marginBp" | "rateReviewDate" | "repayment" | "intervalMonths" | "paymentCents" | "endDate";

export const FIELD_LABEL: Record<LoanFieldKey, string> = {
  lender: "Lainanantaja",
  balanceCents: "Lainaa jäljellä",
  balanceDate: "Saldon päivä",
  grantedCents: "Myönnetty määrä",
  limitCents: "Luottoraja",
  rateBp: "Kokonaiskorko",
  reference: "Viitekorko",
  marginBp: "Marginaali",
  rateReviewDate: "Koron tarkistuspäivä",
  repayment: "Lyhennystapa",
  intervalMonths: "Lyhennysväli",
  paymentCents: "Maksuerä",
  endDate: "Viimeinen eräpäivä",
};

/** "kuukauden välein" for the common intervals, a plain count for the rest. */
export function intervalLabel(months: number): string {
  if (months === 1) return t("rpt.ln_every_month");
  if (months === 12) return t("rpt.ln_every_year");
  return t("rpt.ln_every_n", { n: months });
}

/** The intervals the form offers, up to the longest one the server takes; a loan with another one keeps it. */
export const INTERVALS = [1, 2, 3, 6, MAX_LOAN_INTERVAL_MONTHS] as const;
