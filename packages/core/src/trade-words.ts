/**
 * The generic nouns of a trade, Finnish and Swedish, that a company's name may say what it sells by (Esimerkin
 * Autokorjaamo Oy): the fallback for a register entry whose industry code is too broad to say. Short on purpose.
 * A brand word (Market, Power, Center, Shop) is no trade and is not here. A word matches at the start of a word of the
 * name ("KAHVILA" finds KAHVILAT), never inside one, so a compound is listed by the compound.
 */
const TRADE_WORDS: ReadonlyArray<readonly [category: string, words: readonly string[]]> = [
  ["car", ["AUTOKORJAAMO", "AUTOHUOLTO", "KATSASTUS", "RENGAS", "RENKAAT", "AUTOPESULA", "BILVERKSTAD", "DACK", "BESIKTNING"]],
  ["transport", ["TAKSI", "TAXI"]],
  ["restaurants", ["RAVINTOLA", "KAHVILA", "PIZZERIA", "LEIPOMO", "RESTAURANG", "KAFFE", "BAGERI", "KONDITORI", "KONDIITTORI"]],
  ["personal_care", ["PARTURI", "KAMPAAMO", "HIUSSALONKI", "FRISOR", "FRISORSALONG"]],
  ["health", ["APTEEKKI", "APOTEK", "HAMMASLAAKARI", "HAMMASASEMA", "HAMMASHOITOLA", "OPTIIKKA", "TANDLAKARE", "FYSIOTERAPIA", "FYSIOTERAPEUTTI", "LAAKARIASEMA", "LAKARSTATION"]],
  ["education", ["AUTOKOULU", "TRAFIKSKOLA"]],
  ["fitness", ["KUNTOSALI", "KUNTOKESKUS"]],
  ["home", ["KUKKAKAUPPA", "BLOMSTERHANDEL"]],
  ["pets", ["ELAINLAAKARI", "ELAINKLINIKKA", "DJURLAKARE", "DJURKLINIK"]],
];

const COMPILED = TRADE_WORDS.map(([category, words]) => [category, new RegExp(String.raw`(?<![A-Z0-9])(?:${words.join("|")})`)] as const);

/** The category of the first trade noun that a word of the folded name starts with, or null. */
export const tradeWordCategory = (folded: string): string | null => COMPILED.find(([, re]) => re.test(folded))?.[0] ?? null;
