/**
 * Lenders the word lists do not name, and the bank's own rows.
 *
 * A household's debt payments and the credit it draws are told as debt (ADR 0014). A lender on no list was a shop when
 * it was paid and income when it paid out, so the month looked better than it was. A lender is told three ways: by the
 * shape of its name (a rule, below), by its own payout and by the trade register (`lenderEvidence`). A card's bill is
 * decided after the rules (card-channel.ts), and nothing here asks whether a payment is one.
 */
import type { CategorizeInput, CompiledRule } from "./categorize.ts";
import { type Holders, isUserName } from "./categorize-people.ts";
import { hasTerminalShape } from "./industry.ts";
import { fold, UNKNOWN_MERCHANT } from "./merchant.ts";
import { namesBank } from "./transfers.ts";
import type { Account, Transaction } from "./types.ts";
import { isCardCode, isCardText, isInsuranceText, isLenderName, isNoCreditText, isPersonShaped, isReimbursementText } from "./wording.ts";
import { hasInterestWord, isLenderShapedName, isStreetAddressText } from "./wording-lenders.ts";

/**
 * No card in the row: no card code, no code of the bank's for a card, and no text of a card terminal. One bank gives
 * neither code, and there the terminal's number and town are all that tells a purchase. A card pays a shop, whatever
 * the shop is called.
 */
const noCard = (row: Pick<CategorizeInput, "mcc" | "bankTxnCode" | "counterparty" | "description">) => !row.mcc && !isCardCode(row.bankTxnCode) && !hasTerminalShape(row);
/** The folded text of a row that names no payee, else null. Such a row is the bank's own: cash from a machine, interest, a fee. */
const bankText = (input: CategorizeInput) => (input.counterparty?.trim() ? null : fold(input.description ?? ""));
const payeeOf = (row: Pick<CategorizeInput, "counterparty">) => fold(row.counterparty ?? "").trim();

/**
 * A payment to the bank of one of the household's accounts that its name does not make a loan payment: money out, to a
 * name with no word of lending beyond the bank's own. The bank's finance company (ESIMERKKIPANKKI RAHOITUS OY) is a
 * lender again, both ways. The name rule and the trade register both ask this, so a row has one answer whichever of
 * them is on.
 */
const isOwnBankPayment = (row: Pick<CategorizeInput, "counterparty" | "amountCents">, accounts: readonly Account[]) => {
  const payee = payeeOf(row);
  return row.amountCents < 0 && !isLenderShapedName(payee, true) && accounts.some((a) => namesBank(payee, a));
};

/**
 * The rules of this file, read after the lists of known lenders, the bank's codes and the people, and before the shops.
 * `namedLikeBusiness` is the category rules' own knowledge of trades: a restaurant called The Bank is a restaurant.
 * `cashMcc` tells the merchant code of a cash machine.
 */
export function bankRowRules(namedLikeBusiness: (name: string) => boolean, cashMcc: (mcc: string) => boolean): CompiledRule[] {
  const rule = (category: string, test: CompiledRule["test"], direction?: "out"): CompiledRule => ({ category, income: false, field: "any", direction, test });
  return [
    // a cash machine's row is its address, and a street or a town in it is no shop's brand; a card purchase's address is its own, and its code tells what it bought
    rule("cash", (_text, input) => (!input.mcc || cashMcc(input.mcc)) && isStreetAddressText(bankText(input) ?? ""), "out"),
    // interest the bank takes, in a compound too (VELKAKORKO), which the whole words of the interest rule miss
    rule("interest", (_text, input) => hasInterestWord(bankText(input) ?? ""), "out"),
    // A lender by its name. A payment service is none: its row is a purchase unless the text names instalments, which
    // an earlier rule reads. Money in is credit drawn (categorize() turns a debt category around), when the name has a
    // word of lending beyond the bank's own: a bank also sends pay and bonuses.
    rule("loans", (text, input, _holders, accounts) => {
      const payee = payeeOf(input);
      if (!noCard(input) || !isLenderShapedName(payee, input.amountCents > 0) || isLenderName(payee) || namedLikeBusiness(payee)) return false;
      // the bank of one of the household's accounts is no lender by its name: its own rows keep the category the other rules give
      if (isOwnBankPayment(input, accounts)) return false;
      // what the text says the money is: an insurance, a lease or a bond, a card's credit (its bill is decided elsewhere), a refund
      if (isInsuranceText(text) || isNoCreditText(text) || isCardText(fold(input.description ?? ""))) return false;
      return !(input.amountCents > 0 && isReimbursementText(text));
    }),
  ];
}

/**
 * What a payee's own payout and the trade register say of a payment no rule recognised. Read in `applyMerchantEvidence`
 * (pipeline.ts), which the full run and the run over one merchant's rows both go through.
 *
 * One payee, one answer: a merchant that paid credit out is a lender, so a payment to it pays that credit, also one
 * whose text has no word of lending. A person is none, nor is the user: the payer of such money moved it. The payee is the merchant: the short run holds every row of its merchants and
 * gives way to the full run when a payout comes or goes, so both give the same answer. Another form of the lender's
 * name is another merchant and is missed.
 *
 * The register: the industry of a credit institution gives `loans`, except on a card purchase and on a payment to the
 * bank of a connected account (the name rule's step-aside). A card pays a shop, and a shop that the register matched to
 * a bank of the same name is no lender.
 */
export function lenderEvidence(txs: readonly Transaction[], cards: ReadonlySet<string>, holders: Holders, accounts: readonly Account[]) {
  const lenders = new Set<string>();
  // a person's payout (a card's credit moved to the own account, an advance from a friend) makes the person no lender
  const person = (t: Transaction) => {
    const name = fold(t.counterparty ?? "").trim();
    return !!name && !isLenderShapedName(name) && (isUserName(name, holders) || isPersonShaped(name));
  };
  for (const t of txs) if (t.category === "credit_draw" && t.amountCents > 0 && !t.isTransfer && t.merchant !== UNKNOWN_MERCHANT && !person(t)) lenders.add(t.merchant);
  const onCard = (t: Transaction) => cards.has(t.accountId) || !noCard(t);
  return {
    paid: (t: Transaction) => lenders.has(t.merchant) && !onCard(t),
    industry: (t: Transaction, industry: string | undefined) => (industry === "loans" && (onCard(t) || isOwnBankPayment(t, accounts)) ? undefined : industry),
  };
}
