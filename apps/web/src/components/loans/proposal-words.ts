/**
 * The words of a proposed loan, asked in Tarkistettavat: the question a neighbour would ask, since a payee can be a bank,
 * a finance company, a private person or a housing company, so "Ei ole laina" is an easy answer.
 * Read when shown, since the language can change.
 */
import { t } from "../../text.ts";

export const proposalQuestion = (): string => t("set.loans.proposal_question");
