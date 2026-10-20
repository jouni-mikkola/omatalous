/**
 * Lenders the word lists do not name, and the bank's own rows.
 *
 * A household's debt payments and the credit it draws are told as debt (ADR 0014). A lender on no list was a shop when
 * it was paid and income when it paid out, so the month looked better than it was. A lender is told three ways: by the
 * shape of its name (a rule, below), by its own payout and by the trade register (`lenderEvidence`). The household's
 * own bank, like any bank named by its bank word alone, is none by its name, and a loan there is told by a word of a
 * loan in the text or by the reference its instalments are paid under. A card's bill is decided after the rules
 * (card-channel.ts), and nothing here asks whether a payment is one.
 */
import { isInstalments, isLenderPayout, referenceOf } from "./card-channel.ts";
import type { CategorizeInput, CompiledRule } from "./categorize.ts";
import { type Holders, noCard } from "./categorize-people.ts";
import { fold } from "./merchant.ts";
import { isBankName, namesBank } from "./transfers.ts";
import type { Account, Transaction } from "./types.ts";
import { isCardText, isInsuranceText, isLenderName, isNoCreditText, isReimbursementText } from "./wording.ts";
import { hasInterestWord, hasLoanText, isBankOnlyName, isLenderShapedName, isStreetAddressText } from "./wording-lenders.ts";

/** The folded text of a row that names no payee, else null. Such a row is the bank's own: cash from a machine, interest, a fee. */
const bankText = (input: CategorizeInput) => (input.counterparty?.trim() ? null : fold(input.description ?? ""));
const payeeOf = (row: Pick<CategorizeInput, "counterparty">) => fold(row.counterparty ?? "").trim();

/**
 * A payment to the bank of one of the household's accounts that its name does not make a loan payment: money out, to a
 * name with no word of lending beyond the bank's own. The bank's finance company (ESIMERKKIPANKKI RAHOITUS OY) is a
 * lender again, both ways. The name rule and the trade register both ask this, so a row has one answer whichever of
 * them is on. `names` tells how closely the payee must be the bank: by a word of its name (the step aside, which only
 * keeps a row what it was) or as the bank itself (a contract, which makes a row debt).
 */
const isOwnBankPayment = (row: Pick<CategorizeInput, "counterparty" | "amountCents">, accounts: readonly Account[], names = namesBank) => {
  const payee = payeeOf(row);
  return row.amountCents < 0 && !isLenderShapedName(payee, true) && accounts.some((a) => names(payee, a));
};

/** Whether a text holds a word. A reference number grouped by the bank (12345 67890) holds none; "TALLELOKERO" says what the money is. */
const hasWord = (text: string | null | undefined) => /\p{L}/u.test(text ?? "");

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
    // money to the bank of a connected account with no reference and no word of its own in the text: the household's own
    // money moved there. A payment under a reference may be a loan's instalment (lenderEvidence reads it), and a text
    // names a fee, a loan or a card (the rules above and below read it)
    rule("transfer", (_text, input, _holders, accounts) => noCard(input) && referenceOf(input as Transaction) === "" && !hasWord(input.description) && isOwnBankPayment(input, accounts, isBankName), "out"),
    // A lender by its name. A payment service is none: its row is a purchase unless the text names instalments, which
    // an earlier rule reads. Money in is credit drawn (categorize() turns a debt category around), when the name has a
    // word of lending beyond the bank's own: a bank also sends pay and bonuses.
    rule("loans", (text, input, _holders, accounts) => {
      const payee = payeeOf(input);
      if (!noCard(input) || !isLenderShapedName(payee, input.amountCents > 0) || isLenderName(payee) || namedLikeBusiness(payee)) return false;
      // a bank's name alone is no loan: its payments are fees, deposits and cards unless the text names a loan (a series the detection holds is read by lenderEvidence)
      if (isBankOnlyName(payee) && !hasLoanText(fold(input.description ?? ""))) return false;
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
 * One payee, one answer: a merchant that paid credit out (`isLenderPayout`, card-channel.ts) is a lender, so a payment to
 * it pays that credit, also one whose text has no word of lending. The payee is the merchant: the short run holds every
 * row of its merchants and gives way to the full run when a payout comes or goes, so both give the same answer. Another
 * form of the lender's name is another merchant and is missed.
 *
 * A bank is no lender by its name alone, the household's own or another (`isBankOnlyName`): a loan there that is paid
 * like an invoice has no word either, and its reference tells it. Payments to the bank itself, with a reference and no word in their text, are one contract
 * under one reference; when an amount is paid three times or more and makes up at least half of them they are a loan's
 * instalments (`isInstalments`), and a fee or a subscription is not paid so. A company that only shares a word with the
 * bank's name (its fund company, a stranger) is no contract, nor is a text that says what the money is. A card paid one
 * fixed sum under its reference reads the same, and only a pair with the card's own row tells that one apart.
 *
 * The register: the industry of a credit institution gives `loans`, except on a card purchase and on a payment to the
 * bank of a connected account (the name rule's step-aside). A card pays a shop, and a shop that the register matched to
 * a bank of the same name is no lender.
 */
export function lenderEvidence(txs: readonly Transaction[], cards: ReadonlySet<string>, holders: Holders, accounts: readonly Account[]) {
  const lenders = new Set<string>();
  const ownBank = new Map<string, boolean>();
  const contracts = new Map<string, Transaction[]>();
  /** The payee and the reference of a payment to the household's own bank itself, with no word in its text, else null. */
  const contractOf = (t: Transaction): string | null => {
    const reference = t.amountCents < 0 && !t.isTransfer && t.counterparty && !hasWord(t.description) ? referenceOf(t) : "";
    if (!reference) return null;
    let own = ownBank.get(t.counterparty!);
    // a bank the household has no account at is held to the same: its payments under one reference are a contract too
    if (own === undefined) ownBank.set(t.counterparty!, (own = isOwnBankPayment(t, accounts, isBankName) || isBankOnlyName(payeeOf(t))));
    return own ? `${t.merchant}\u0000${reference}` : null;
  };
  for (const t of txs) {
    if (isLenderPayout(t, holders)) lenders.add(t.merchant);
    const contract = contractOf(t);
    if (!contract) continue;
    const rows = contracts.get(contract);
    if (rows) rows.push(t);
    else contracts.set(contract, [t]);
  }
  const instalment = (t: Transaction) => {
    const rows = contracts.get(contractOf(t) ?? "");
    return !!rows && isInstalments(rows);
  };
  const onCard = (t: Transaction) => cards.has(t.accountId) || !noCard(t);
  return {
    paid: (t: Transaction) => (lenders.has(t.merchant) || instalment(t)) && !onCard(t),
    industry: (t: Transaction, industry: string | undefined) => (industry === "loans" && (onCard(t) || isOwnBankPayment(t, accounts)) ? undefined : industry),
  };
}
