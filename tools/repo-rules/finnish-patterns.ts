/**
 * The patterns of rule 28 (finnish.ts), apart from the rule so that their own tests (finnish.test.ts) do not run the
 * rule's scan of every UI text a second time.
 */
export interface Pattern {
  name: string;
  re: RegExp;
  /** One line: how to write it instead. */
  fix: string;
}

export const PATTERNS: readonly Pattern[] = [
  { name: "pois lukien", re: /pois lukien/i, fix: 'write "ilman" ("ilman kertaostoja")' },
  { name: "täysi kuukausi", re: /(täy(si|ttä|den|det|siä|sien|sistä|sissä|siin|deltä|dellä|dessä|teen)|kokonai(nen|sen|sta))\s+kuukau/iu, fix: 'write "valmis kuukausi" (completeMonths() on the web)' },
  { name: "calque: laskelma olettaa", re: /(?<!\p{L})(laskelma|arvio|sovellus)\s+olettaa/iu, fix: 'write "Laskelmassa oletetaan, että"' },
  { name: "ending glued to a name", re: /\}-\p{Ll}/u, fix: "a name of two words breaks the compound: write the ending as its own word, or leave the name out" },
  { name: "löydös", re: /löyd(ös|öksen|östä|öksi[aä]|ökset)/iu, fix: 'write "vinkki"' },
  { name: "te-form in the past tense", re: /(?<!\p{L})\p{L}{3,}itte(ko|kö)?(?!\p{L})/iu, fix: "address the reader as sinä (\"muutit\") or use the passive" },
  { name: "syötetty", re: /(?<!\p{L})syötetty(?!\p{L})/iu, fix: 'write "annettu"' },
  { name: "keskiostos, skripti", re: /keskiostos|skripti/iu, fix: 'write "ostoskerta keskimäärin" or "asennusohjelma"' },
  // what the 0.67 pass took out of the Finnish: word order, calques and terms
  { name: "Ylläpitäjä tarkistaa as an instruction", re: /(?<!\p{L})Ylläpitäjä\s+(painaa|tarkistaa|lisää|avaa|valitsee|ottaa)(?!\p{L})/u, fix: 'write "Ylläpitäjän pitää tarkistaa"' },
  { name: "a thing that needs", re: /\p{L}\s+tarvitse(e|vat)\s+(\$\{|\{|\d)/u, fix: 'write "Vertailuun tarvitaan" or "X varten tarvitaan"' },
  // an amount after "alkaen" is fine ("helmikuusta alkaen 2 400 €"); a date there is the English order
  { name: "alkaen before a date", re: /(?<!\p{L})alkaen\s+(\$?\{\s*(monthYear|formatFiDate|fiDate|dayHeading)\(|\d{1,2}[./]\d)/u, fix: 'put it after: "10/2026 alkaen"' },
  { name: "money that pays", re: /(?<!\p{L})(korot|kulut|menot)\s+maksoi(vat)?(?!\p{L})/iu, fix: 'say where the money went: "korkoihin meni 120 €"' },
  { name: "kuin mitä", re: /(?<!\p{L})kuin\s+mitä(?!\p{L})/iu, fix: 'write "kuin sitä" or leave "mitä" out' },
  { name: "ei ole saatavilla", re: /(?<!\p{L})(ei|eivät)\s+ole\s+saatavilla/iu, fix: 'write "ei näy" or "puuttuu"' },
  { name: "ei X annettu", re: /(?<!\p{L})ei\s+(?!vielä\s|enää\s)\p{L}+[aä]\s+annettu(?!\p{L})/iu, fix: 'write "syytä ei annettu"' },
  { name: "odotetusti", re: /odotetusti/iu, fix: 'say what happened: "antoi oudon vastauksen"' },
  { name: "suuntaa-antava", re: /suuntaa-antav/iu, fix: 'write "suuntaa antava" (Kielitoimisto)' },
  { name: "Yritä uudelleen myöhemmin", re: /uudelleen\s+myöhemmin/iu, fix: 'write "Yritä myöhemmin uudelleen"' },
  { name: "ostokerta", re: /(?<!\p{L})ostoker[tr]/iu, fix: 'write "ostoskerta"' },
  { name: "löydetty", re: /(?<!\p{L})löydetty(?!\p{L})/iu, fix: 'write "arvioitu" or say what the figure is' },
  // a span of months stays: "kolmessa kuukaudessa"
  { name: "kuukaudessa as a rate", re: /€\s+kuukaudessa(?!\p{L})|^\s*Kuukaudessa\s*$/u, fix: 'write "kuussa"' },
  { name: "X ei tiedossa as a label", re: /^\p{Lu}\p{Ll}+ ei tiedossa$/u, fix: 'write "Tuntematon kauppa"' },
  // whatever the list found: three marks of machine-written prose
  // the character is built from its code point, so this file holds none (rule 4 reads every file)
  { name: "em dash", re: new RegExp(String.fromCharCode(0x2014)), fix: "write a comma, a colon, parentheses or two sentences" },
  // "ei vain" in a plain sentence has no "vaan"; "ei X, vaan Y" is the contrast
  { name: '"ei ... vaan" as a contrast', re: /(?<!\p{L})(ei|eivät|en|et|emme|ette)(?!\p{L})[^.!?]*?(?<!\p{L})vaan(?!\p{L})/iu, fix: "say the one thing that is true and leave the other out" },
  // a mark that ends a sentence; one inside a quoted bank text ("KIITOS!") stays
  { name: "exclamation mark at the end of a sentence", re: /!(?=\s*$|\s+\p{Lu})/u, fix: "write a plain statement with a full stop" },
];

/** The patterns a text breaks. */
export const breaks = (text: string): Pattern[] => PATTERNS.filter((p) => p.re.test(text));
