/**
 * Which rows are fees: a late fee (a reminder fee, late interest, a collection cost) and a bank's own price. The
 * overview's alerts and Optimoi's bank area read the same rows through these predicates.
 */
import { fold } from "../merchant.ts";
import type { AnalysisTx } from "./context.ts";
import { LATE_FEE_WORDS } from "../wording.ts";

const LATE_FEE = new RegExp(LATE_FEE_WORDS);

/** A reminder fee or late interest: its own alert, and not a bank's price. Optimoi's late fee finding reads the same rows. */
export const isLateFee = (t: AnalysisTx) => t.amountCents < 0 && !t.isTransfer && LATE_FEE.test(fold(`${t.description ?? ""} ${t.counterparty ?? ""} ${t.merchant}`));

const LATE_FEE_ALL = new RegExp(LATE_FEE.source, "g");

/**
 * A late fee whose message names nothing but the fee. "LASKU 4471 JA PERINTAKULU" pays the bill too, so its sum is not
 * the fee's; the alert counts it, a figure of what the fees cost does not.
 */
export const isLateFeeAlone = (t: AnalysisTx) => isLateFee(t) && !/[A-Z0-9]/.test(fold(t.description ?? "").replace(LATE_FEE_ALL, ""));

/** A bank's own price or interest, late fees left out: the rows of the bank fees alert and of Optimoi's bank fee summary. */
export const isBankFee = (t: AnalysisTx) => (t.category === "fees" || t.category === "interest") && t.spend > 0 && !isLateFee(t);
