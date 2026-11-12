/**
 * The payee of a row, and the guard between a payee's name and the trade register. The register is public and outside
 * the household, so a name that may be a person's is never asked about: not by its shape, not by a word it shares
 * with a name the household has, and not as a name that only an invoice speaks for. industry.ts decides which rows
 * pay a business and which merchants are asked about; this file reads the names.
 */
import { cleanDescription, fold } from "./merchant.ts";
import { nameOf } from "./person-names.ts";
import type { Transaction } from "./types.ts";
import { companyForms, dropUnseen, isPersonShaped, namesBusiness } from "./wording.ts";

// ── the payee's name in the bank's own text ──

/**
 * Letters the cleaning keeps: it knows A to Z and the Nordic letters, and would split "AYŞE" into "AY" and "E" and
 * "RYŁSKI" into "RY" and "SKI". An accent goes, and so does a character nobody sees, which the cleaning would make a
 * space ("HEN" + soft hyphen + "RY"). A letter with no accent to drop (Ł, Ø, Æ, ß, another script) stands as X, so
 * every word stays whole.
 */
const plain = (text: string | null): string => dropUnseen((text ?? "").normalize("NFD")).replace(/[^\P{L}A-Za-z]/gu, "X");

/** One of the bank's texts as a name: cleaned the way the merchant name is made (normalizeMerchant), letters whole. */
export const nameIn = (text: string | null): string => fold(cleanDescription(plain(text)));

/**
 * The payee's name as the bank's own text gives it: the payee field, else the payment text. The merchant itself may
 * say less: a brand rule shortens "MAX MEIKALAINEN" to "Max", and a letter the cleaning does not know splits a name
 * into words that read as a company form.
 */
export function payeeName(t: Pick<Transaction, "counterparty" | "description">): string {
  return nameIn(t.counterparty) || nameIn(t.description);
}

/** The bank's text that names the payee, as it came. */
export const payeeText = (t: Pick<Transaction, "counterparty" | "description">): string => (t.counterparty?.trim() ? t.counterparty : (t.description ?? ""));

/** A processor's or a wallet's prefix before the shop's name, which a card terminal's text has: "SUMUP *KUKKAKAUPPA ILO", "MOB.PAY*STORYTEL OY". */
export const TERMINAL_PREFIX = /^\s*[\p{L}\p{N}._]{2,12} ?\*\s*[\p{L}\p{N}]/u;

// ── the household's own names ──

/** A word of a holder line or a display name that is no name: the company form of an account a firm holds, "ja" between two names. */
const NOT_A_NAME: ReadonlySet<string> = new Set([...companyForms("payee"), "JA", "TAI", "OCH", "AND"]);

/** A folded word in one spelling: a card account writes Ä and Ö as AE and OE ("MEIKAELAEINEN"), a bank as A and O. */
const oneSpelling = (word: string): string => word.replace(/AE/g, "A").replace(/OE/g, "O");

/**
 * The words of the names a household has: the holders of its accounts as the bank gives them, its members' display
 * names. They are spelled the way a payee's name is read (`plain`), so a letter the cleaning does not know stands as
 * X in both. An initial is no word of a name, and neither is a company form.
 */
export function householdWords(names: readonly (string | null | undefined)[]): ReadonlySet<string> {
  const words = new Set<string>();
  for (const name of names) for (const word of nameOf(plain(name ?? null))) if (word.length > 1 && !NOT_A_NAME.has(word)) words.add(oneSpelling(word));
  return words;
}

/**
 * Whether a name holds a word of a name the household has (householdWords): the word itself, one of five letters or
 * more at either end of a longer word, where two names are written together ("MATTIMEIKALAINEN"), or the start of
 * one, from four letters on, as the name's last word, where a bank cut it ("TMI PEKKA MEIKALAI"). A relative shares
 * the surname and a partner's first name may be a brand, so such a name is never asked about, whatever else it holds.
 */
export function namesHousehold(name: string, household: ReadonlySet<string>): boolean {
  if (household.size === 0) return false;
  const words = fold(name)
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
    .map(oneSpelling);
  const last = words[words.length - 1];
  for (const own of household) {
    if (last !== undefined && last.length >= 4 && own.startsWith(last)) return true;
    if (words.some((word) => word === own || (own.length >= 5 && (word.startsWith(own) || word.endsWith(own))))) return true;
  }
  return false;
}

// ── the guard ──

type PayeeFields = Pick<Transaction, "counterparty" | "counterpartyIban" | "description"> & { merchant?: string };

/**
 * Whether a row names a person: its merchant, or the payee's name in the bank's own text, has the shape of a
 * person's name. How whole the name is depends on where the bank has it from. With the payee's account it comes
 * whole, from the payment order. Without one it is a card terminal's or a wallet's and may be cut after two names:
 * there a last word that a name can begin with is no company form ("VIRTANEN LIISA KY"). Behind a prefix it shares
 * a short field and may be cut after one ("MOB.PAY*MEIKALAINEN OSK").
 */
function namesPerson(t: PayeeFields): boolean {
  const cutFrom = TERMINAL_PREFIX.test(payeeText(t)) ? 2 : t.counterpartyIban ? Number.POSITIVE_INFINITY : 3;
  return (t.merchant !== undefined && isPersonShaped(fold(t.merchant), cutFrom)) || isPersonShaped(payeeName(t), cutFrom);
}

/**
 * The guard between a payee and the register: whether the payee of a row may be a person. Such a row is no invoice of
 * a business, and its merchant is never asked about. Any one of these refuses it:
 *   - the name has the shape of a person's (namesPerson)
 *   - the name holds a word of a name the household has (namesHousehold)
 *   - nothing but an invoice speaks for a business (`evidenced` is false: no row of the merchant has business
 *     evidence of another kind), and the name does not say business either, as wording `namesBusiness` reads it: a
 *     company form or a business word with no person's two names beside it (a club's invoice names the child, a sole
 *     trader's the owner). A bare word, a name with a sign in a word ("L&P VIRTANEN", "A&B ESIMERKKI": the spelling
 *     cannot tell a couple from a company) and an e-mail address say nothing, so an invoice alone sends none of them.
 * The first reads the name in the merchant, which is what would be sent, and in the bank's own text. The second
 * reads the bank's text as it came too: the cleaning drops a surname that is also a town ("LIISA TAPIOLA" is the
 * merchant "Liisa"). The third reads the bank's text, where the name is whole.
 */
export function mayBePerson(t: PayeeFields, household: ReadonlySet<string>, evidenced: boolean): boolean {
  if (namesPerson(t)) return true;
  const payee = payeeName(t);
  if ([t.merchant ?? "", payee, plain(payeeText(t))].some((name) => namesHousehold(name, household))) return true;
  return !evidenced && !namesBusiness(payee);
}

/**
 * Whether a payee name alone may be a person's: its shape (`isPersonShaped`) or a word of a name the household has. For a
 * mark beside a name where no row of the payee is at hand; a row's own answer is `mayBePerson`. A doubtful name reads as
 * a person's, so no initials of a person's name are taken for a brand's.
 */
export function nameMayBePerson(name: string, household: ReadonlySet<string>): boolean {
  return isPersonShaped(fold(name)) || namesHousehold(name, household);
}
