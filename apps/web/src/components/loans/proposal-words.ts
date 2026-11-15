/**
 * The words of a proposed loan, asked in Tarkistettavat: the question a neighbour would ask, since a payee can be a bank,
 * a finance company, a private person or a housing company, so "Ei ole laina" is an easy answer.
 * Read when shown, since the language can change.
 */
import { t } from "../../text.ts";

export const proposalQuestion = (): string => t("set.loans.proposal_question");
export const helpRate = (): string => t("set.loans.help_rate");
export const helpBalanceAndRate = (): string => t("set.loans.help_balance_and_rate");

/** The help asks only for what the proposal's form leaves empty: the balance is filled when the loan account tells it. */
export const editorHelp = (form: { values: { balanceCents: string } }): string => (form.values.balanceCents === "" ? helpBalanceAndRate() : helpRate());
