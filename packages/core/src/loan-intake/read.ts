/**
 * One value after its label, read as the type of the label's field: an amount, a rate, a date, a word for the way of
 * repayment or the interval, the reference rate, a lender's name.
 */
import type { IsoDate } from "../types.ts";
import { type LoanLabelField, isLoanRateFormula, isLoanTotal, loanIntervalIn, loanReferenceIn, loanRepaymentIn } from "../wording-loan-pages.ts";
import { MARKS, foldLine, isIcon } from "./labels.ts";
import { findPercent, hasText, readDate, readMoney, readPercent } from "./values.ts";

export interface Got {
  /** Undefined when the text gave only the reference rate's own value, which is no field. */
  value: unknown;
  clean: boolean;
  doubt: boolean;
  /** A date beside the balance. */
  date?: IsoDate;
  /** The reference rate's own value, for the cross-check. */
  referenceBp?: number;
  /** The value stood on the line above its label. */
  above?: true;
  /** A rate with no percent sign under a word that can name an amount of interest. */
  bare?: true;
}

function readReference(text: string, folded: string): Got | null {
  // "12 kk Euribor + 0,65 %": the percentage is the margin, not the reference
  const percent = text.includes("+") ? null : findPercent(text);
  const named = loanReferenceIn(percent ? foldLine(percent.rest) : folded);
  if (named) return { value: named.value, clean: !hasText(named.rest), doubt: false, ...(percent ? { referenceBp: percent.bp } : {}) };
  return percent && !hasText(percent.rest) ? { value: undefined, clean: true, doubt: false, referenceBp: percent.bp } : null;
}

export function readLender(text: string): Got | null {
  const name = text.replace(MARKS, "").replace(/^[\s:=-]+|[\s.,;:]+$/g, "").replace(/\s+/g, " ");
  // a lone letter is the picture beside the label, not a name
  if (!/\p{L}/u.test(name) || isIcon(name) || name.length > 80) return null;
  // a long text or one with numbers holds more than the name (an address, a business id)
  return { value: name, clean: true, doubt: /\d/.test(name) || name.split(" ").length > 6 };
}

export function read(field: LoanLabelField, text: string, folded: string, certain = true): Got | null {
  switch (field) {
    case "grantedCents":
    case "paymentCents":
    case "amortisationCents":
    case "limitCents":
      return isLoanTotal(folded) ? null : readMoney(text);
    case "balanceCents":
      return isLoanTotal(folded) ? null : readMoney(text, true);
    case "rateBp":
    case "marginBp": {
      if (field === "rateBp" && isLoanRateFormula(folded)) return null;
      const percent = readPercent(text);
      // under a word that can name an amount of interest ("Korko 19,40") a number with no percent sign is the weakest reading of a rate
      const bare = percent !== null && !certain && !findPercent(text);
      // a rate or a margin below zero is not a loan's: the minus is a dash, and the user looks
      return percent && { value: percent.value, clean: percent.clean, doubt: percent.doubt || percent.negative, ...(bare ? { bare: true as const } : {}) };
    }
    case "endDate":
    case "balanceDate":
      return readDate(text);
    case "repayment":
    case "intervalMonths": {
      const word = field === "repayment" ? loanRepaymentIn(folded) : loanIntervalIn(folded);
      return word && { value: word.value, clean: !hasText(word.rest), doubt: false };
    }
    case "reference":
      return readReference(text, folded);
    case "lender":
      return readLender(text);
    case "marker":
      return null;
  }
}
