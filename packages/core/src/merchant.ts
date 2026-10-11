/**
 * Turns noisy bank descriptions ("PAYPAL *SPOTIFY P2A1B3 STOCKHOLM SE",
 * "K-MARKET KAMPPI HELSINKI") into a stable merchant name ("Spotify",
 * "K-Market") so that spending can be grouped per merchant.
 */
import { MOBILEPAY_SHOP_PREFIX } from "./wording.ts";

const PROCESSOR_PREFIX = new RegExp(
  String.raw`^(?:PAYPAL|PP|SUMUP|ZETTLE_?|IZ|SQ|SP|VFI|NETS|KLARNA|MOLLIE|STRIPE|PAYTRAIL|CHECKOUT|${MOBILEPAY_SHOP_PREFIX})\s*\*\s*`,
);

const NOISE_WORDS =
  /\b(?:KORTTIOSTO|KORTTIMAKSU|OSTOPVM|OSTO|PURCHASE|CARD|VISA|DEBIT|ELECTRON|MASTERCARD|E-LASKU|E-INVOICE|TILISIIRTO|SUORAMAKSU|VERKKOMAKSU|LASKU|INVOICE)\b/g;

/** Places that are common surnames too: "MATTI KALLIO" is a person, not Matti in Kallio. */
const SURNAME_TOWNS = new Set(["SALO", "LAHTI", "KOTKA", "KALLIO", "MALMI"]);

/** Towns, city districts and malls that banks append to a shop's name ("K-MARKET KAMPPI HELSINKI"). Folded. */
const PLACES = [
  "FI", "FIN", "FINLAND", "SE", "SWE", "EE", "DE", "IE", "NL", "LU", "GB", "UK", "US", "USA", "DK", "NO", "FR", "ES",
  "HELSINKI", "HELSINGFORS", "ESPOO", "VANTAA", "KAUNIAINEN", "TAMPERE", "TURKU", "OULU", "JYVASKYLA", "LAHTI",
  "KUOPIO", "PORI", "JOENSUU", "LAPPEENRANTA", "HAMEENLINNA", "VAASA", "SEINAJOKI", "ROVANIEMI", "MIKKELI",
  "KOTKA", "SALO", "PORVOO", "KOUVOLA", "HYVINKAA", "NURMIJARVI", "JARVENPAA", "KERAVA", "LOHJA", "KIRKKONUMMI",
  "TUUSULA", "RAUMA", "KAJAANI", "KOKKOLA", "SAVONLINNA", "RIIHIMAKI", "SIPOO", "RAISIO", "KAARINA", "NOKIA",
  "YLOJARVI", "KANGASALA", "LEMPAALA", "PIRKKALA", "KEMPELE", "NAANTALI", "STOCKHOLM", "TALLINN", "DUBLIN",
  "LUXEMBOURG", "AMSTERDAM", "LONDON", "BERLIN",
  // Helsinki
  "KAMPPI", "KALLIO", "ITAKESKUS", "ITIS", "HERTTONIEMI", "MALMI", "PASILA", "TOOLO", "PUNAVUORI", "SORNAINEN",
  "HAKANIEMI", "KANNELMAKI", "VUOSAARI", "MYLLYPURO", "MELLUNMAKI", "OULUNKYLA", "LAUTTASAARI", "MUNKKIVUORI",
  "MUNKKINIEMI", "MALMINKARTANO", "KONALA", "PITAJANMAKI", "HAAGA", "ARABIANRANTA", "VIIKKI", "KALASATAMA",
  "JATKASAARI", "RUOHOLAHTI", "SIILITIE",
  // Espoo
  "TAPIOLA", "LEPPAVAARA", "MATINKYLA", "ESPOONLAHTI", "ESPOON KESKUS", "OTANIEMI", "NIITTYKUMPU", "KIVENLAHTI",
  "SOUKKA", "OLARI", "KILO", "KAUKLAHTI", "SUURPELTO", "KALAJARVI", "LAAJALAHTI",
  // Vantaa
  "TIKKURILA", "MYYRMAKI", "KORSO", "MARTINLAAKSO", "KIVISTO", "HIEKKAHARJU", "KOIVUKYLA", "AVIAPOLIS",
  "VANTAANKOSKI", "LANSIMAKI", "SIMONKYLA",
  // malls and centres, also in Tampere, Turku and Oulu
  "JUMBO", "FLAMINGO", "SELLO", "ISO OMENA", "REDI", "TRIPLA", "MALL OF TRIPLA", "FORUM", "KAUPPAKESKUS",
  "KESKUSTA", "CITYCENTER", "RATINA", "KOSKIKESKUS", "IDEAPARK", "HERVANTA", "LIELAHTI", "LINNAINMAA", "HANSA",
  "SKANSSI", "VARISSUO", "RUNOSMAKI", "ZEPPELIN", "LIMINGANTULLI", "KAAKKURI", "TUIRA", "RITAHARJU",
];
const PLACE_SET = new Set(PLACES);

const TRAILING_PLACE = new RegExp(String.raw`\s+(?:${PLACES.join("|")})$`);

/** Whether a word (or two, "Iso Omena") is a town, a district or a mall. */
export function isPlaceName(name: string): boolean {
  return PLACE_SET.has(fold(name.trim()).replace(/\s+/g, " "));
}

/** [pattern on folded upper-case text, display name]. The first match wins. */
const BRANDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^K-?SUPERMARKET/, "K-Supermarket"],
  [/^K-?CITYMARKET/, "K-Citymarket"],
  [/^K-?MARKET/, "K-Market"],
  [/^K-?RUOKA/, "K-Ruoka"],
  [/^K-?RAUTA/, "K-Rauta"],
  [/^S-?MARKET/, "S-Market"],
  [/^PRISMA/, "Prisma"],
  [/^ALEPA/, "Alepa"],
  [/^SALE\b/, "Sale"],
  [/^LIDL/, "Lidl"],
  [/^TOKMANNI/, "Tokmanni"],
  [/^R-?KIOSKI/, "R-Kioski"],
  [/^UBER\s*\*?\s*EATS|^UBEREATS/, "Uber Eats"],
  [/\bWOLT\b/, "Wolt"],
  [/FOODORA/, "Foodora"],
  [/SPOTIFY/, "Spotify"],
  [/NETFLIX/, "Netflix"],
  [/DISNEY\s*(?:PLUS|\+)|DISNEYPLUS/, "Disney+"],
  [/HBO\s*MAX|^MAX\b(?!\s*BURGER)/, "Max"],
  [/VIAPLAY/, "Viaplay"],
  [/^APPLE\.COM|^ITUNES|^APPLE\s/, "Apple"],
  [/YOUTUBE/, "YouTube"],
  [/^GOOGLE/, "Google"],
  [/AMAZON\s*PRIME|PRIME\s*VIDEO/, "Amazon Prime"],
  [/^AMAZON|^AMZN/, "Amazon"],
  [/^OPENAI|CHATGPT/, "OpenAI"],
  [/^ANTHROPIC|CLAUDE\.AI/, "Anthropic"],
  [/^MICROSOFT|^MSFT/, "Microsoft"],
  [/^ADOBE/, "Adobe"],
  [/^STORYTEL/, "Storytel"],
  [/^BOOKBEAT/, "BookBeat"],
  [/^STEAM/, "Steam"],
  [/^HSL\b|HELSINGIN SEUDUN LIIKENNE/, "HSL"],
  [/^VR\b|^VR-YHTYMA/, "VR"],
  [/^NYSSE/, "Nysse"],
  [/^MATKAHUOLTO/, "Matkahuolto"],
  [/^BOLT\b/, "Bolt"],
  [/^UBER/, "Uber"],
  [/^NESTE/, "Neste"],
  [/^ST1/, "St1"],
  [/^ABC\b/, "ABC"],
  [/^SHELL/, "Shell"],
  [/^TEBOIL/, "Teboil"],
  [/^EASYPARK/, "EasyPark"],
  [/^PARKMAN/, "ParkMan"],
  [/^AIMO\s*PARK/, "Aimo Park"],
  [/^HESBURGER/, "Hesburger"],
  [/^MCDONALD/, "McDonald's"],
  [/^BURGER KING/, "Burger King"],
  [/^KOTIPIZZA/, "Kotipizza"],
  [/^ESPRESSO HOUSE/, "Espresso House"],
  [/^ROBERT'?S COFFEE/, "Robert's Coffee"],
  [/^ELISA\s*VIIHDE/, "Elisa Viihde"],
  [/^ELISA\b/, "Elisa"],
  [/^DNA\b/, "DNA"],
  [/^TELIA/, "Telia"],
  [/^HELEN\b/, "Helen"],
  [/^FORTUM/, "Fortum"],
  [/^OOMI/, "Oomi"],
  [/^CARUNA/, "Caruna"],
  [/^ZALANDO/, "Zalando"],
  [/^H\s?&\s?M\b/, "H&M"],
  [/^IKEA/, "IKEA"],
  [/^GIGANTTI/, "Gigantti"],
  [/VERKKOKAUPPA\.?COM/, "Verkkokauppa.com"],
  [/^CLAS OHLSON/, "Clas Ohlson"],
  [/^MOTONET/, "Motonet"],
  [/^BILTEMA/, "Biltema"],
  [/^STOCKMANN/, "Stockmann"],
  [/^SOKOS\s*HOTEL/, "Sokos Hotels"],
  [/^SOKOS/, "Sokos"],
  [/^FINNAIR/, "Finnair"],
  [/^AIRBNB/, "Airbnb"],
  [/^BOOKING\.COM/, "Booking.com"],
  [/^FINNKINO/, "Finnkino"],
  [/^TERVEYSTALO/, "Terveystalo"],
  [/^MEHILAINEN/, "Mehiläinen"],
  [/^PIHLAJALINNA/, "Pihlajalinna"],
  [/APTEEKKI/, "Apteekki"],
  [/^ELIXIA/, "Elixia"],
  [/^FITNESS24SEVEN/, "Fitness24Seven"],
  [/^SATS\b/, "SATS"],
  [/^EASYFIT/, "EasyFit"],
];

export const UNKNOWN_MERCHANT = "Tuntematon";

/** Upper-case and strip Nordic diacritics so "MEHILÄINEN" and "MEHILAINEN" match. */
export function fold(s: string): string {
  const upper = s.toUpperCase();
  // most texts have no diacritics: skip the replace passes (this runs for every row and field)
  return FOLD_CHARS.test(upper) ? upper.replace(FOLD_CHARS_G, (c) => FOLD_MAP[c]!) : upper;
}
const FOLD_MAP: Record<string, string> = { Ä: "A", Å: "A", Ö: "O", Ü: "U" };
const FOLD_CHARS = /[ÄÅÖÜ]/;
const FOLD_CHARS_G = /[ÄÅÖÜ]/g;

/** Whether a merchant name is the placeholder every row without a name shares. */
export function isUnknownMerchant(name: string): boolean {
  return fold(name.trim()) === fold(UNKNOWN_MERCHANT);
}

/**
 * A merchant rule for the placeholder would take every unnamed row, now and later, so none is made. Versions up to
 * 0.8.3 could store one (`merchant_exact`, or the older whole-word `merchant`): it never applies, and the upgrade
 * deletes it.
 */
export function namesUnknownMerchant(rule: { field: string; pattern: string }): boolean {
  return (rule.field === "merchant" || rule.field === "merchant_exact") && isUnknownMerchant(rule.pattern);
}

/**
 * Upper-cases and strips payment-processor prefixes, card masks, dates,
 * reference numbers and trailing town/country names. Keeps Nordic letters;
 * `fold` the result for matching.
 */
export function cleanDescription(raw: string): string {
  let s = raw.toUpperCase().trim();
  for (let i = 0; i < 2; i++) s = s.replace(PROCESSOR_PREFIX, "");
  s = s
    .replace(NOISE_WORDS, " ")
    // card masks with the card's first digits (4581XXXXXXXX2241, 4581 **** **** 2241), dates, times, long reference numbers
    .replace(/(?<![A-Z0-9])(?:\d{4,6}[ -]?)?(?:(?:X{2,}|\*{2,})[ -]?)+\d{2,4}(?!\d)/g, " ")
    .replace(/\b\d{1,2}\.\d{1,2}\.(?:\d{2,4})?/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/\b[A-Z\d]{5,}\b/g, (tok) => (isReferenceToken(tok) ? " " : tok))
    .replace(/[^A-ZÄÖÅÜ0-9&.'+\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // what is left of a card or terminal number before the shop's name
    .replace(/^(?:\d+ )+(?=\S*[A-ZÄÖÅÜ])/, "");
  // strip trailing towns / country codes, possibly several ("HELSINKI FI").
  // fold() keeps string length, so the folded match index applies to `s`.
  for (let i = 0; i < 3; i++) {
    const m = TRAILING_PLACE.exec(fold(s));
    if (!m || m.index === 0) break;
    const rest = s.slice(0, m.index).trim();
    // "MATTI LAHTI" is a person, not Matti in Lahti: these towns are common surnames too
    if (SURNAME_TOWNS.has(m[0].trim()) && /^[A-ZÅÄÖ]+$/i.test(rest)) break;
    s = rest;
  }
  return s;
}

/** "P2A1B3", "RF18539007547034" → true; "FITNESS24SEVEN", "ST1" → false */
function isReferenceToken(tok: string): boolean {
  const digits = tok.replace(/\D/g, "").length;
  return digits >= 2 && !/[A-Z]{4,}/.test(tok);
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s\-.])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * Returns a display name that is also the grouping key for a merchant.
 * `counterparty` (creditor/debtor name) is preferred over the free-text
 * description because banks fill it with the cleanest value.
 */
export function normalizeMerchant(counterparty: string | null, description: string | null): string {
  for (const candidate of [counterparty, description]) {
    if (!candidate?.trim()) continue;
    const cleaned = cleanDescription(candidate);
    if (!cleaned) continue;
    const folded = fold(cleaned);
    for (const [pattern, name] of BRANDS) {
      if (pattern.test(folded)) return name;
    }
    const words = cleaned.split(" ").filter((w) => /[A-ZÄÖÅÜ]/.test(w)).slice(0, 4);
    // whole words up to 40 characters
    while (words.length > 1 && words.join(" ").length > 40) words.pop();
    if (words.length) return titleCase(words.join(" ")).slice(0, 40);
  }
  return UNKNOWN_MERCHANT;
}
