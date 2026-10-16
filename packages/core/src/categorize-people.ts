/**
 * People in the category rules: money to and from a person, and money another holder of the user's account moves.
 * What moves between the people of a household and their relatives is neither pay nor shopping, and a person's first
 * name or surname is often a shop's brand too (Elisa, Helen, Silja, Asko, Virta), so a person is told before the shops.
 */
import type { CategorizeInput, CompiledRule } from "./categorize.ts";
import { hasTerminalShape } from "./industry.ts";
import { dropCardAccountPrefix, fold } from "./merchant.ts";
import { partyKind } from "./party-kind.ts";
import { holdersIn, type Name, nameOf, samePerson, userNameOf } from "./person-names.ts";
import type { Account } from "./types.ts";
import { hasPayeeForm, INVOICE_WORDS, isBusinessPaymentText, isCardCode, isPersonShaped, isRent, MOBILEPAY_SHOP_PREFIX, MOBILEPAY_WORDS, namesBusiness, PERSON_PAYMENT_WORDS, words } from "./wording.ts";
import { isOrganisationName } from "./wording-lenders.ts";

export interface Holders {
  /** The user's own name. Null: the accounts do not tell it, and then nobody is told apart. */
  user: Name | null;
  /** Everyone else who holds one of the user's accounts. */
  others: readonly Name[];
}

const NOBODY: Holders = { user: null, others: [] };
const known = new WeakMap<readonly Account[], Holders>();

/**
 * Who holds the accounts, from the holders the bank gives ("A, B"). The user is the one name on the most accounts
 * (`userNameOf`). When the accounts do not tell it, nobody is told apart and every row is read as before.
 */
export function holdersOf(accounts: readonly Account[]): Holders {
  if (!accounts.length) return NOBODY;
  let holders = known.get(accounts);
  if (!holders) {
    const user = userNameOf(accounts);
    holders = user ? { user, others: accounts.flatMap((a) => holdersIn(a.holder).map((h) => h.name)).filter((name) => !samePerson(name, user)) } : NOBODY;
    known.set(accounts, holders);
  }
  return holders;
}

/** Whether a payee's name is the user's own, with its words in either order. */
export const isUserName = (name: string, holders: Holders): boolean => !!holders.user && samePerson(nameOf(name), holders.user);

const MOBILEPAY_TEXT = words(`${MOBILEPAY_WORDS}|SIIRTO HENKILO(?:LLE|LTA)`);
const SHOP_PREFIX = new RegExp(String.raw`^(?:${MOBILEPAY_SHOP_PREFIX})\s*\*\s*`);
const BANK_PERSON_PAYMENT = words(PERSON_PAYMENT_WORDS);
/** "LASKU 12": a glued number does not make it another word. */
const INVOICE_TEXT = words(INVOICE_WORDS, true);
/** A reference number written into a message: the word for one, an RF reference (its groups may stand apart), or six digits at least as long as a bank's (single spaces between them: references print in fives). */
const REFERENCE_TEXT = /(?<![A-Z0-9])VIITE[A-Z]*|(?<![A-Z0-9])RF\d{2}(?: ?[A-Z0-9]){4,}|\d(?: ?\d){5}/;

/** The folded payee, without the country and the city a card account writes in front of it ("OSTO FIN KUOPIO MOB.PAY*MATTI MEIKALAINEN"): the merchant's name is read without them too. */
const payeeOf = (input: CategorizeInput) => dropCardAccountPrefix(fold(input.counterparty ?? "").trim());
/**
 * No card in the row: no card code, no code of the bank's for a card, and no text of a card terminal. One bank gives
 * neither code, and there the terminal's number and town are all that tells a purchase. A card pays a shop, whatever
 * the shop is called, also one named like a person or like a lender.
 */
export const noCard = (row: Pick<CategorizeInput, "mcc" | "bankTxnCode" | "counterparty" | "description">) => !row.mcc && !isCardCode(row.bankTxnCode) && !hasTerminalShape(row);

/** The payer or payee is another holder of the user's accounts: a person of the household, whatever the text says. */
function isCoHolder(input: CategorizeInput, holders: Holders): boolean {
  // a company named after its owner is a company
  if (!holders.user || !input.counterparty || hasPayeeForm(payeeOf(input))) return false;
  const name = nameOf(input.counterparty);
  return !samePerson(name, holders.user) && holders.others.some((other) => samePerson(name, other));
}

/**
 * The rules about people. `namedLikeBusiness`, `shopMcc` and `namesShopOrService` are the category rules' own knowledge
 * of shops.
 *   first: before every built-in rule. MobilePay to or from a person, and money in from a co-holder: an own transfer
 *          by the bank's words or code is the sender's own, so from a co-holder it is no saving of the user's drawn.
 *   plain: after the rules that read a purpose (pay, benefits, loans, the bank's codes) and before the shops.
 */
export function peopleRules(
  namedLikeBusiness: (name: string) => boolean,
  shopMcc: (mcc: string | null) => boolean,
  namesShopOrService: (message: string) => boolean,
): { first: CompiledRule[]; plain: CompiledRule[] } {
  // a person has the shape of a name, by the rule that keeps a name from the trade register, no company form at an end or
  // between two words ("BOSTADS AB EXEMPEL"), no word of a school or an association and no trade word, and no company by
  // partyKind (a legal form, a business id in the text, a payee the app knows)
  const person = (name: string, text = "") => isPersonShaped(name) && !hasPayeeForm(name) && !namesBusiness(name) && !isOrganisationName(name) && !namedLikeBusiness(name) && partyKind(name, text) !== "company";

  const viaMobilePay = (input: CategorizeInput): boolean => {
    const payee = payeeOf(input);
    // booked as a card purchase, MobilePay stands in front of the payee: a person's name behind it is a person, unless the card's code names a shop
    const behind = payee.replace(SHOP_PREFIX, "");
    if (behind !== payee) return !shopMcc(input.mcc) && person(behind);
    return MOBILEPAY_TEXT.test(fold([input.counterparty, input.description].filter(Boolean).join(" "))) && person(payee);
  };

  /** A transfer to or from a person: a co-holder, or a name with the bank's own word for a payment between people. */
  const plain = (text: string, input: CategorizeInput, holders: Holders) =>
    noCard(input) && (isCoHolder(input, holders) || (BANK_PERSON_PAYMENT.test(text) && person(payeeOf(input), input.description ?? "")));

  /**
   * Money out to a person named without the bank's word: a credit transfer, which has the payee's account, with no
   * reference number. With a number the payee may be a sole trader. The absence of card evidence is not enough: a
   * card purchase from a bank that sends no code and no card text is named like a person too (a shop and its town),
   * and has no payee account. Pay and rent from a person carry no number either, so money in is left. The message
   * alone may still name a purchase (a word of a shop's or service's rule, or the bank's own text of a card purchase),
   * an invoice or a reference written into the text: the payee is a trade's then and the rules that follow decide.
   * A payee the account pays the same sum month after month (rent, a childminder, a coach) is no single gift, and the
   * user's own name is no other person: both are read as before, and a steady payee keeps its series.
   */
  const unreferenced = (input: CategorizeInput, holders: Holders): boolean => {
    // a row built without the field (the kit's, the demo's) says nothing, and a row without the payee's account is no credit transfer
    if (input.reference === undefined || input.reference?.trim() || !input.counterpartyIban?.trim() || !noCard(input)) return false;
    if (input.steadyPayee || isUserName(input.counterparty ?? "", holders)) return false;
    const message = fold(input.description ?? "");
    return person(payeeOf(input), message) && !isBusinessPaymentText(message) && !INVOICE_TEXT.test(message) && !REFERENCE_TEXT.test(message) && !namesShopOrService(message);
  };

  const rule = (category: string, direction: "in" | "out", test: CompiledRule["test"]): CompiledRule => ({ category, income: false, field: "any", direction, test });
  return {
    first: [
      rule("p2p_in", "in", (_text, input) => viaMobilePay(input)),
      rule("p2p", "out", (_text, input) => viaMobilePay(input)),
      rule("p2p_in", "in", (_text, input, holders) => noCard(input) && isCoHolder(input, holders)),
    ],
    // rent paid to a person is rent: a private landlord, or the share paid to the one who pays it
    plain: [rule("p2p_in", "in", plain), rule("housing", "out", (text, input, holders) => isRent(text) && plain(text, input, holders)), rule("p2p", "out", (text, input, holders) => plain(text, input, holders) || unreferenced(input, holders))],
  };
}
