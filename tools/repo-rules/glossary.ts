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
  /** Files of the parts of the language work that have not come yet (docs/UI_STYLE.md); each part removes its own from here. */
  pending?: RegExp;
}

/** The Tarkistettavat cards ask the household a real question; that is not a heading. */
const ASKS = /(^|\/)messages-set-ri\./;

export const REMOVED: readonly Removed[] = [
  // the page is Säästövinkit; the route, the feature id and the code keep the old name
  { name: "Optimoi", re: /(?<!\p{L})optimo\p{L}*/iu, fix: 'write "Säästövinkit" (the page) or "säästövinkki"' },
  { name: "Yli jäi", re: /(?<!\p{L})yli\s+jäi(?!\p{L})/iu, fix: 'write "Tulos" (income less spending of the month)' },
  // as the name of a figure: a short text that starts with it. A sentence that uses the word is not a name.
  { name: "Tileillä as a figure name", re: /^\s*Tileillä(?!\p{L})[^.!?,:]{0,30}$/u, fix: 'write "Tilien saldo" (and "Varat velkojen jälkeen" for the balance less card debt)' },
  // plain words for the usual level and the finished months (docs/UI_STYLE.md, Glossary)
  { name: "Vaihteluväli", re: /(?<!\p{L})vaihteluväli\p{L}*/iu, fix: 'write what the range is: "tavallisesti X–Y €"' },
  { name: "Prosenttipiste", re: /(?<!\p{L})prosenttipist\p{L}*/iu, fix: 'write the plain range, or "prosenttiyksikkö" for a difference of percentages' },
  { name: "Valmis kuukausi", re: /(?<!\p{L})valmi(is|it|in|ik|ide)\p{L}*\s+kuukau\p{L}*/iu, fix: 'write "päättynyt kuukausi"' },
  { name: "Nettovarat", re: /(?<!\p{L})nettovara\p{L}*/iu, fix: 'write "Varat velkojen jälkeen"' },
  { name: "Jäämä", re: /(?<!\p{L})jäämä\p{L}*/iu, fix: 'write what is left: "Käteen jäi", "jäljellä"' },
  // the reports speak plainly to the reader: no statistics words (docs/UI_STYLE.md, Reports)
  { name: "Todennäköisin", re: /(?<!\p{L})todennäköi(sin|nen\s+väli|sesti\s+se\s+on)(?!\p{L})/iu, fix: 'write "Arvio" and "Se voi olla X–Y €"' },
  { name: "Luvun osat", re: /(?<!\p{L})luvun\s+osat(?!\p{L})/iu, fix: 'write "Mistä luku koostuu"' },
  // a bank link is yhdistä; in Enable Banking's own panel the step is "lisää" (the panel's word, Link accounts, may be quoted)
  { name: "Linkitä", re: /(?<!\p{L})linkit(ä|e|t|y)\p{L}*/iu, fix: 'write "yhdistä" for a bank, or "lisää" for an account in Enable Banking; the panel\'s own word may stand in quotes' },
  // the voice of the app (docs/UI_STYLE.md, Tone): the app says what it does, and a heading is a noun
  { name: "Näin heading", re: /^\s*Näin\s+\p{L}+(aan|ään)(?!\p{L})/u, fix: 'say what the reader gets or does: "Laskuihin riittää", not "Näin katetaan"' },
  { name: "Katetaan", re: /(?<!\p{L})katetaan(?!\p{L})/iu, fix: 'write the reader as the subject: "Laskuihin riittää", "Laskusi on katettu"' },
  // a passive finite verb anywhere in a text; a loading line ("Ladataan…", "Haetaan tapahtumia…") is the one place it stays
  { name: "Passive verb", re: /^(?!\s*\p{Lu}\p{L}*(taan|tään|daan|dään)(\s+\p{L}+){0,2}\s*…?\s*$)[\s\S]*?(?<!\p{L})(?!(enintään|vähintään|itsestään|aikaisintaan|portaan|vastaan|ainakaan)(?!\p{L}))\p{L}{2,}(?:[aeiouyäö](taan|tään)|[aeiouyäöh](daan|dään))(?!\p{L})/u, pending: /(^|\/)ops-english\./, fix: 'say who does it: "Haemme tapahtumat", "Laskemme summan", "Voit hakea"; only a loading line may be passive ("Ladataan…")' },
  { name: "Question heading", re: /^\s*(Mihin|Miten|Mistä|Mitkä|Milloin|Kuinka|Paljonko|Kestääkö|Kasvavatko|Kasvoiko|Riittävätkö|Pysyykö|Mitä|Missä|Minä|Mikä|Kenen|Tuleeko|Tuottivatko|Nousivatko)(?!\p{L})[^.!?]{0,80}\?$/u, fix: 'a heading is a short noun: "Rahankäyttö", "Kuukauden tilanne", not "Mihin raha menee?"', pending: ASKS },
];

/** Text between double quotes is what somebody else wrote (a button of another service, a bank text): not read. */
const QUOTED = /"[^"]*"|“[^”]*”|”[^”]*”/g;

/** The removed words a text uses. */
export const removedIn = (text: string, file = ""): Removed[] => {
  const outside = text.replace(QUOTED, " ");
  return REMOVED.filter((r) => !(r.pending && r.pending.test(file)) && (r.re.test(r.name === "Tileillä as a figure name" ? text : outside)));
};
