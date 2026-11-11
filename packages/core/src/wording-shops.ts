/**
 * What a payment is for, in the bank's text or the payer's message, as Tarkistettavat's guess reads it (payee-guess.ts):
 * the words of a trade's own service. No rule files by them: the payee is still asked, and the word is the reason given.
 * A connection of another trade is not here (SAHKOLIITTYMA, VESILIITTYMA).
 */
const PURPOSE: ReadonlyArray<readonly [category: string, re: RegExp]> = [
  ["telecom", /(?<![A-Z0-9])(?:(?:PUHELIN|MOBIILI|MATKAPUHELIN|NETTI|LAAJAKAISTA|KUITU)LIITTYMA[A-Z]*|LAAJAKAISTA[A-Z]*|PUHELINLASKU[A-Z]*)(?![A-Z0-9])/],
];
/** The category a payment's purpose word names, or null. */
export const purposeCategory = (folded: string): string | null => PURPOSE.find(([, re]) => re.test(folded))?.[0] ?? null;
