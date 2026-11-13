/**
 * The figures a bank writes around the payee in a row's text: the time of a purchase and a foreign purchase's sum and
 * exchange rate. The payee names (merchant.ts) and the category rules (categorize-text.ts) read the text without them.
 */
import { CURRENCY_CODES } from "./card-text.ts";

/** A sum with its currency's code on either side ("USD 25,00", "1 250,00 GBP"). */
const CURRENCY_WORD = `(?:${[...CURRENCY_CODES].join("|")})`;
// the edges of a word in upper case text that is not folded yet: `\b` would see one between Ä and K ("KESÄKURSSI")
const START = String.raw`(?<![A-ZÄÖÅÜË0-9])`;
const END = String.raw`(?![A-ZÄÖÅÜË0-9])`;
const FOREIGN_SUM = String.raw`${START}${CURRENCY_WORD} ?\d{1,3}(?:[ .]?\d{3})*,\d{2}${END}|${START}\d{1,3}(?:[ .]?\d{3})*,\d{2} ?${CURRENCY_WORD}${END}`;
/**
 * The time after its word ("KLO 14.22") and a foreign purchase's sum and rate ("USD 25,00 KURSSI 1,0834"). A rate has
 * three decimals or more, so a course's date ("KURSSI 1.10.2026", "KURSSI 12.10") or credits ("KURSSI 1,5 OP") stay.
 */
export const BANK_FIGURES = new RegExp(String.raw`${START}KLO\.? ?\d{1,2}[.:]\d{2}(?:[.:]\d{2})?(?![.:,]?\d)|${START}(?:VAIHTO)?KURSSI:? ?\d+[.,]\d{3,}(?![.,]?\d)|${FOREIGN_SUM}`, "g");

/**
 * Folded bank text without the figures a bank writes around the payee (`BANK_FIGURES`): the rate of a foreign purchase
 * ("KURSSI 1,0834") is no course of study for the category rules.
 */
export const dropBankFigures = (folded: string): string => folded.replace(BANK_FIGURES, " ");
