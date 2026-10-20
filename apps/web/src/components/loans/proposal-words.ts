/**
 * The words of a proposed loan, asked in Tarkistettavat: the question a neighbour would ask, since a payee can be a bank,
 * a finance company, a private person or a housing company, so "Ei laina" is an easy answer.
 */
export const PROPOSAL_QUESTION = "Onko tämä lainan maksu?";
export const HELP_RATE = "Lisää vielä lainan korko.";
export const HELP_BALANCE_AND_RATE = "Lisää vielä jäljellä oleva laina ja korko.";

/** The help asks only for what the proposal's form leaves empty: the balance is filled when the loan account tells it. */
export const editorHelp = (form: { values: { balanceCents: string } }): string => (form.values.balanceCents === "" ? HELP_BALANCE_AND_RATE : HELP_RATE);
