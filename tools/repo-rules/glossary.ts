/**
 * The words the glossary of docs/UI_STYLE.md removed from the app, apart from rule 35 (glossary-rule.ts) so that the
 * unit tests (glossary.test.ts) do not run the rule's scan of every UI text a second time. A word that a copy pass
 * removes is added here with its replacement and a case in the test; the glossary in the document gets the row in the
 * same change.
 */
export interface Removed {
  name: string;
  re: RegExp;
  /** One line: the glossary term to write instead. */
  fix: string;
}

export const REMOVED: readonly Removed[] = [
  // the page is Säästövinkit; the route, the feature id and the code keep the old name
  { name: "Optimoi", re: /(?<!\p{L})optimo\p{L}*/iu, fix: 'write "Säästövinkit" (the page) or "säästövinkki"' },
  { name: "Yli jäi", re: /(?<!\p{L})yli\s+jäi(?!\p{L})/iu, fix: 'write "Tulos" (income less spending of the month)' },
  // as the name of a figure: a short text that starts with it. A sentence that uses the word is not a name.
  { name: "Tileillä as a figure name", re: /^\s*Tileillä(?!\p{L})[^.!?,:]{0,30}$/u, fix: 'write "Tilien saldo" (and "Nettovarat" for the balance less card debt)' },
  // a bank link is yhdistä; in Enable Banking's own panel the step is "lisää" (the panel's word, Link accounts, may be quoted)
  { name: "Linkitä", re: /(?<!\p{L})linkit(ä|e|t|y)\p{L}*/iu, fix: 'write "yhdistä" for a bank, or "lisää" for an account in Enable Banking; the panel\'s own word may stand in quotes' },
];

/** Text between double quotes is what somebody else wrote (a button of another service, a bank text): not read. */
const QUOTED = /"[^"]*"|“[^”]*”|”[^”]*”/g;

/** The removed words a text uses. */
export const removedIn = (text: string): Removed[] => {
  const outside = text.replace(QUOTED, " ");
  return REMOVED.filter((r) => r.re.test(r.name === "Tileillä as a figure name" ? text : outside));
};
