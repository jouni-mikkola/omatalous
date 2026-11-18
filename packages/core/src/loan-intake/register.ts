/**
 * The positive credit register's own words, settled into the fields of the loan. The register names how the rate is
 * set (Koron tyyppi), its period (Koronmääräytymisjakso), the day a fixed period ends and the last payment with its
 * parts apart. None of them is a field of the loan: they are read like fields and settled here, once a loan's lines
 * are all in. Decision it serves: the household gets the reference rate, the day the rate is set again and the split of
 * one real payment from one paste.
 */
import type { IsoDate, LoanReference } from "../types.ts";
import type { DraftFields } from "./checks.ts";
import type { LoanDraftField } from "./types.ts";

/** What the register's labels leave on a draft while it is read. */
export interface RegisterFields {
  rateKind?: LoanDraftField<"fixed" | "variable">;
  /** The reference rate the period names: "12 kk" is euribor_12. */
  referenceTerm?: LoanDraftField<LoanReference>;
  fixedUntil?: LoanDraftField<IsoDate>;
  lastDate?: LoanDraftField<IsoDate>;
  lastPrincipal?: LoanDraftField<number>;
  lastInterest?: LoanDraftField<number>;
  lastFee?: LoanDraftField<number>;
}

const REGISTER_KEYS = ["rateKind", "referenceTerm", "fixedUntil", "lastDate", "lastPrincipal", "lastInterest", "lastFee"] as const;

/** The lines of the parts side by side, and `sure` only when every part is. */
const together = (parts: readonly LoanDraftField<unknown>[]) => ({
  line: parts.map((p) => p.line).join(" / "),
  confidence: parts.every((p) => p.confidence === "sure") ? ("sure" as const) : ("check" as const),
});

/**
 * Turns the register's words into fields. A reference the text names itself (Viitekorko) stays. A fixed rate with no
 * end day is `fixed`. A fixed rate that ends on a day follows its period's Euribor after it: the reference is that
 * Euribor and the day is the rate review date. A variable rate with a period follows that Euribor. The last payment
 * needs its date, its principal and its interest, or none of it is kept. The other costs are zero when the text gives
 * none, and the payment is then `check`.
 */
export function settleRegister(fields: DraftFields & RegisterFields): void {
  const { rateKind, referenceTerm, fixedUntil, lastDate, lastPrincipal, lastInterest, lastFee } = fields;
  for (const key of REGISTER_KEYS) delete fields[key];
  const fixed = rateKind?.value === "fixed" ? rateKind : undefined;
  if (fixedUntil && !fields.rateReviewDate) fields.rateReviewDate = fixedUntil;
  if (!fields.reference) {
    if (fixed && !fixedUntil) fields.reference = { value: "fixed", line: fixed.line, confidence: fixed.confidence };
    else if (referenceTerm && fixed) fields.reference = { value: referenceTerm.value, ...together([fixed, referenceTerm, ...(fixedUntil ? [fixedUntil] : [])]) };
    else if (referenceTerm) fields.reference = { value: referenceTerm.value, ...together([...(rateKind ? [rateKind] : []), referenceTerm]) };
  }
  if (lastDate && lastPrincipal && lastInterest) {
    const parts = [lastDate, lastPrincipal, lastInterest, ...(lastFee ? [lastFee] : [])];
    fields.lastPayment = {
      value: { date: lastDate.value, principalCents: lastPrincipal.value, interestCents: lastInterest.value, feeCents: lastFee?.value ?? 0 },
      ...together(parts),
      ...(lastFee ? {} : { confidence: "check" as const }),
    };
  }
}
