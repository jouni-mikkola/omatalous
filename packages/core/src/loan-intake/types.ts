/**
 * What `parseLoanText` returns: one draft per loan found in pasted or OCR text. The field names are the loan's own
 * (plan 0.8.7, "Loan fields"). Money is integer cents, positive for what is owed; rates are hundredths of a percent
 * (`325` is 3,25 %); dates are `YYYY-MM-DD`. A draft is a proposal: the user confirms every field before it is saved.
 */
import type { LoanReference } from "../optimise/types.ts";
import type { IsoDate, LoanKind, LoanRepayment } from "../types.ts";

/** `sure`: the label and the value were read as printed. `check`: anything less, the user looks at the source line. */
export type DraftConfidence = "sure" | "check";

export interface LoanDraftField<T> {
  value: T;
  /** The source line the value was read from, for the user to compare. A value below its label shows both lines. */
  line: string;
  confidence: DraftConfidence;
}

/** The value type of each field a draft can carry. */
export interface LoanDraftValues {
  lender: string;
  grantedCents: number;
  balanceCents: number;
  balanceDate: IsoDate;
  rateBp: number;
  reference: LoanReference;
  marginBp: number;
  repayment: LoanRepayment;
  intervalMonths: number;
  /**
   * The whole payment (Kuukausierä). For `equal_principal` it is the amortisation alone, read from Lyhennys; a whole
   * payment read for such a loan stays here as `check` with the warning `payment_whole`.
   */
  paymentCents: number;
  endDate: IsoDate;
  limitCents: number;
}
export type LoanDraftKey = keyof LoanDraftValues;

export type LoanDraftWarningId =
  | "rate_sum"
  | "rate_high"
  | "balance_over_granted"
  | "balance_over_limit"
  | "payment_annuity"
  | "payment_whole"
  | "end_passed"
  | "two_values"
  | "mixed_loans";

export interface LoanDraftWarning {
  id: LoanDraftWarningId;
  /** A Finnish sentence for the user. */
  text: string;
  /** The fields the warning lowered to `check`. */
  fields: LoanDraftKey[];
}

/**
 * What the draft's `paymentCents` holds: the `whole` payment (Kuukausierä, with the interest in it) or the
 * `amortisation` alone (Lyhennys). An equal-principal loan stores the amortisation, every other loan the whole payment.
 */
export type LoanDraftPaymentKind = "whole" | "amortisation";

/** A field is absent when its label was not found or its value could not be read: nothing is guessed. */
export type LoanDraft = { [K in LoanDraftKey]?: LoanDraftField<LoanDraftValues[K]> } & {
  /**
   * Present with `paymentCents`. It is no field of the loan and is not saved. The form that shows the draft reads
   * it when the user changes Lyhennystapa, and does what the parser does for a text that names that type: a `whole`
   * payment under `equal_principal` stays to check with the `payment_whole` warning, an `amortisation` under any other
   * type is emptied for the user to type, and a kind that fits the type (`amortisation` for `equal_principal`, `whole`
   * for the others) stays as read. The form works neither kind out of the other.
   */
  paymentKind?: LoanDraftPaymentKind;
  /** The kind of loan the text names in a heading ("Asuntolaina") or by its lender (a mortgage bank). The form preselects it; the household can change it. */
  kind?: LoanKind;
  warnings: LoanDraftWarning[];
};

export interface LoanTextOptions {
  /** The day the text was copied. Core has no clock, so the payment check needs it when the text gives no balance date. */
  asOf?: IsoDate;
  /**
   * `ocr` for text read from a picture. OCR can drop a comma and leave a well-formed number ("689,20" as "68920"),
   * which no reader can see, so every field of such a text is `check`.
   */
  source?: "text" | "ocr";
}
