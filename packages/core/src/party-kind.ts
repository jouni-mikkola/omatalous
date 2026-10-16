/**
 * Whether the other side of a payment is a company or a person, from its name and the bank's text. One function, so
 * the category rules and the questions read a name one way (the word forms of wording.ts, the payees of payees.ts).
 *   company: a legal form (OY, OYJ, AB, ABP, TMI, LTD, GMBH, AB FILIAL; AS, ASA, AY and KY at the end only with another sign),
 *            a business id (1234567-8) in the text, a payee the app knows by trade, or a word of a bank or an insurer
 *            (Bank, Pankki, Vakuutus, Nordea, If ...). A company named after a person ("Virtanen Oy") is one.
 *   person:  two or three words in a name's shape (isPersonShaped), either order, with none of the above.
 *   unknown: one word, four or more, or a trade word: the name does not tell.
 */
import { fold } from "./merchant.ts";
import { payeeFor } from "./payees.ts";
import { hasBusinessWord, isPersonShaped } from "./wording.ts";

type PartyKind = "company" | "person" | "unknown";

/** A form at the end of a name that makes it a company's. */
const END_FORMS: ReadonlySet<string> = new Set(["OY", "OYJ", "AB", "TMI", "LTD", "GMBH"]);
/** Forms that are also a surname or a first name (Ås, Asa, Ay, Ky): a company by them only with another sign. */
const WEAK_FORMS: ReadonlySet<string> = new Set(["AS", "ASA", "AY", "KY"]);
/** A form that stands anywhere in a name: "OY" and "TMI" are no part of a person's name, in front of the name too ("TMI MATTI MEIKALAINEN", "AS OY X"). */
const ANYWHERE_FORMS: ReadonlySet<string> = new Set(["OY", "OYJ", "TMI", "GMBH", "LTD"]);
/** Words that end a bank's or an insurer's name ("Säästöpankki", "S-Pankki", "Vahinkovakuutus", "Handelsbanken"). */
const FINANCE_ENDS = ["PANKKI", "BANK", "BANKEN", "VAKUUTUS", "FORSAKRING"];
/** Whole words: the sort of company, and the names of the Finnish banks and insurers that carry none of those. */
const FINANCE_WORDS: ReadonlySet<string> = new Set([
  "ABP", "INSURANCE", "OP", "NORDEA", "DANSKE", "AKTIA", "IF", "LAHITAPIOLA", "FENNIA", "POHJOLA", "TURVA",
]);
const BUSINESS_ID = /(?<![\d-])\d{7}-\d(?!\d)/;

const wordsOf = (text: string): string[] => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Whether a name carries a legal form. A weak one at the end needs a sign beside it: a trade word, a digit or four words or more. */
function hasLegalForm(parts: readonly string[], folded: string): boolean {
  const last = parts[parts.length - 1];
  if (!last || parts.length < 2) return false;
  if (parts.some((part) => ANYWHERE_FORMS.has(part)) || END_FORMS.has(last)) return true;
  if (last === "FILIAL" && parts[parts.length - 2] === "AB") return true;
  return WEAK_FORMS.has(last) && (hasBusinessWord(folded) || parts.length >= 4 || parts.some((part) => /d/.test(part)));
}

/** A bank or an insurer by a word of its name. A surname that only starts with one ("Pankkinen") is no such word. */
const namesFinance = (parts: readonly string[]) => parts.some((part) => FINANCE_WORDS.has(part) || FINANCE_ENDS.some((end) => part.endsWith(end)));

/** `text`: what else the bank wrote about the payment, which may hold the business id. */
export function partyKind(name: string, text = ""): PartyKind {
  const folded = fold(name);
  const parts = wordsOf(folded);
  if (BUSINESS_ID.test(`${name} ${text}`) || hasLegalForm(parts, folded) || payeeFor(folded) !== null || namesFinance(parts)) return "company";
  // a weak form is read as the name word it may be, so the form's own check does not refuse it
  const shape = WEAK_FORMS.has(parts[parts.length - 1] ?? "") ? [...parts.slice(0, -1), "NAME"].join(" ") : folded;
  return parts.length >= 2 && parts.length <= 3 && isPersonShaped(shape) ? "person" : "unknown";
}
