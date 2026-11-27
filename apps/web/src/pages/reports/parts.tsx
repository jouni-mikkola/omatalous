import { t } from "../../text.ts";

/** The warning of the saved-debt rows: core's constant is Finnish, this follows the language. */
export const sameDebtTwice = (): string => t("rpt.same_debt_twice");

/** The text of a card's datum with the period it sums, when the page names one. */
export const inSpan = (ctx: { span?: string }, text: string): string => (ctx.span ? `${text}, ${ctx.span}` : text);
