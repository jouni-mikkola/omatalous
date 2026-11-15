import { t } from "../../text.ts";

/** The two figures of the saved-debt rows: core's constants are Finnish, these follow the language. */
export const sameDebtTwice = (): string => t("rpt.same_debt_twice");
export const accountsLessDebt = () => ({ label: t("rpt.accounts_less_debt"), sub: t("rpt.accounts_less_debt_sub") });

/** The text of a card's datum with the period it sums, when the page names one. */
export const inSpan = (ctx: { span?: string }, text: string): string => (ctx.span ? `${text}, ${ctx.span}` : text);
