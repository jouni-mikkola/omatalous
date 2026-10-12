/** The Finnish names of a loan's fields and choices, shared by the list and the form of Asetukset > Lainat. */
import { LOAN_REFERENCE_LABEL, MAX_LOAN_INTERVAL_MONTHS } from "@banking/core";
import type { Loan, LoanDraftKey, LoanKind } from "@banking/core";

export const KIND_LABEL: Record<LoanKind, string> = {
  mortgage: "Asuntolaina",
  consumer: "Kulutusluotto",
  car: "Autolaina",
  student: "Opintolaina",
  credit_line: "Luottolimiitti",
  card: "Luottokortti",
  instalment: "Osamaksu",
  other: "Muu laina",
};

/** The names the Säästövinkit rate question uses. */
export const REFERENCE_LABEL: Record<NonNullable<Loan["reference"]>, string> = LOAN_REFERENCE_LABEL;

export const REPAYMENT_LABEL: Record<NonNullable<Loan["repayment"]>, string> = {
  annuity: "Annuiteetti (tasaerä)",
  equal_principal: "Tasalyhennys",
  fixed_instalment: "Kiinteä tasaerä",
  bullet: "Kertalyhennys",
};

export const FIELD_LABEL: Record<LoanDraftKey, string> = {
  lender: "Lainanantaja",
  balanceCents: "Lainaa jäljellä",
  balanceDate: "Jäljellä olevan summan päivä",
  grantedCents: "Myönnetty määrä",
  limitCents: "Luottoraja",
  rateBp: "Kokonaiskorko",
  reference: "Viitekorko",
  marginBp: "Marginaali",
  repayment: "Lyhennystapa",
  intervalMonths: "Lyhennysväli",
  paymentCents: "Maksuerä",
  endDate: "Viimeinen eräpäivä",
};

/** "kuukauden välein" for the common intervals, a plain count for the rest. */
export function intervalLabel(months: number): string {
  if (months === 1) return "Kuukauden välein";
  if (months === 12) return "Vuoden välein";
  return `${months} kuukauden välein`;
}

/** The intervals the form offers, up to the longest one the server takes; a loan with another one keeps it. */
export const INTERVALS = [1, 2, 3, 6, MAX_LOAN_INTERVAL_MONTHS] as const;
