/**
 * Turns noisy bank descriptions ("PAYPAL *SPOTIFY P2A1B3 STOCKHOLM SE",
 * "K-MARKET KAMPPI HELSINKI") into a stable merchant name ("Spotify",
 * "K-Market") so that spending can be grouped per merchant.
 */
import { companyForms, MOBILEPAY_SHOP_PREFIX } from "./wording.ts";

/**
 * Payment services that stand in front of a shop's name: before a star with any separator the rows use ("SUMUP *",
 * "ZETTLE-*", "PTL*"), and a name of four letters or more as the first words of a bank transfer, with its company form
 * and a word that starts with a letter after it ("PAYTRAIL OYJ KAUPPA ILO OY"). A short code is no company's name.
 */
const PROCESSOR_PREFIX = new RegExp(
  String.raw`^(?:PAYPAL|PP|SUMUP|ZETTLE|IZ|SQ|SP|VFI|PTL|NETS|KLARNA|MOLLIE|STRIPE|PAYTRAIL|CHECKOUT|${MOBILEPAY_SHOP_PREFIX})(?:[\s_-]*\*\s*|(?<=[A-Z]{4})\s+(?:${[...companyForms("payee")].join("|")})\s+(?=[A-ZÄÖÅÜ]))`,
);

/** ISO 3166-1 alpha-3: how a card account writes the country of a purchase. */
const COUNTRY_CODES = new Set(
  `ABW AFG AGO AIA ALA ALB AND ARE ARG ARM ASM ATA ATF ATG AUS AUT AZE BDI BEL BEN BES BFA BGD BGR BHR BHS BIH BLM BLR
  BLZ BMU BOL BRA BRB BRN BTN BVT BWA CAF CAN CCK CHE CHL CHN CIV CMR COD COG COK COL COM CPV CRI CUB CUW CXR CYM CYP
  CZE DEU DJI DMA DNK DOM DZA ECU EGY ERI ESH ESP EST ETH FIN FJI FLK FRA FRO FSM GAB GBR GEO GGY GHA GIB GIN GLP GMB
  GNB GNQ GRC GRD GRL GTM GUF GUM GUY HKG HMD HND HRV HTI HUN IDN IMN IND IOT IRL IRN IRQ ISL ISR ITA JAM JEY JOR JPN
  KAZ KEN KGZ KHM KIR KNA KOR KWT LAO LBN LBR LBY LCA LIE LKA LSO LTU LUX LVA MAC MAF MAR MCO MDA MDG MDV MEX MHL MKD
  MLI MLT MMR MNE MNG MNP MOZ MRT MSR MTQ MUS MWI MYS MYT NAM NCL NER NFK NGA NIC NIU NLD NOR NPL NRU NZL OMN PAK PAN
  PCN PER PHL PLW PNG POL PRI PRK PRT PRY PSE PYF QAT REU ROU RUS RWA SAU SDN SEN SGP SGS SHN SJM SLB SLE SLV SMR SOM
  SPM SRB SSD STP SUR SVK SVN SWE SWZ SXM SYC SYR TCA TCD TGO THA TJK TKL TKM TLS TON TTO TUN TUR TUV TWN TZA UGA UKR
  UMI URY USA UZB VAT VCT VEN VGB VIR VNM VUT WLF WSM YEM ZAF ZMB ZWE`.split(/\s+/),
);

/**
 * A card account writes "Osto <country> <city> <name> [<city>]" ("OSTO FIN KUOPIO KUKKAKAUPPA ILO OY KUOPIO"). The
 * country and the city in front hide the shop from the processor and brand patterns, which read the start. The leading
 * word and a country code prove the shape: "OSTO XYZ …" has no such code, and a shop whose own name starts with three
 * capitals has no "OSTO" before them. The word after the country is dropped as the city only when the text proves it
 * is one (dropCardAccountPrefix); a row with no city keeps the first word of its name. Groups: the country, all that
 * follows it, its first word, the rest.
 */
const CARD_ACCOUNT_TEXT = /^OSTO\s+([A-Z]{3})\s+((\S+)(?:\s+(\S.*))?)$/s;

const NOISE_WORDS =
  /\b(?:KORTTIOSTO|KORTTIMAKSU|OSTOPVM|OSTO|PURCHASE|CARD|VISA|DEBIT|ELECTRON|MASTERCARD|E-LASKU|E-INVOICE|TILISIIRTO|SUORAMAKSU|VERKKOMAKSU|LASKU|INVOICE)\b/g;

/** Places that are common surnames too: "MATTI KALLIO" is a person, not Matti in Kallio. */
const SURNAME_TOWNS = new Set(["SALO", "LAHTI", "KOTKA", "KALLIO", "MALMI"]);

/** Whether `town` after the one word `rest` is a surname: "MATTI LAHTI" is a person, not Matti in Lahti. */
const isSurnameAfterName = (town: string, rest: string) => SURNAME_TOWNS.has(town) && /^[A-ZÅÄÖ]+$/i.test(rest);

/** The countries a bank writes after a town, as a code or the name. Folded. */
const COUNTRY_WORDS = ["FI", "FIN", "FINLAND", "SE", "SWE", "EE", "DE", "IE", "NL", "LU", "GB", "UK", "US", "USA", "DK", "NO", "FR", "ES"];

/** Towns, city districts and malls that banks append to a shop's name ("K-MARKET KAMPPI HELSINKI"), and the countries. Folded. */
const PLACES = [
  ...COUNTRY_WORDS,
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
/** A place and at most a country code, and nothing after: all that a payment service's seat leaves in the text. */
const PLACE_AND_COUNTRY = new RegExp(String.raw`^(?:${PLACES.join("|")})(?:\s+(?:${COUNTRY_WORDS.join("|")}))?\s*$`);

/** Company forms, as the one word a text can be left with. */
const COMPANY_FORMS = new Set([...companyForms("strip"), ...companyForms("payee")]);

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
  // marketplaces: an item's title or an order number follows the name, so each purchase would be a merchant of its own.
  // Tori only in its own forms (the word alone, its domain): a shop that begins with the word ("TORI KEBAB") keeps its name
  [/^TORI(?:\.FI\b|$)/, "Tori"],
  [/^ENEBA\b/, "Eneba"],
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
  let s = dropCardAccountPrefix(raw.toUpperCase().trim());
  for (let i = 0; i < 2; i++) s = dropProcessor(s);
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
    if (isSurnameAfterName(m[0].trim(), rest)) break;
    s = rest;
  }
  return s;
}

/**
 * The payment service in front of a shop's name, dropped. The leading-words form ("PAYTRAIL OYJ KAUPPA ILO OY") keeps
 * the service only when a place and at most a country code are all that is left behind it: "PAYTRAIL OYJ HELSINKI" names
 * the service and its seat, and without the service only the town would be left. A shop whose name begins with a town
 * ("PAYTRAIL OYJ TURKU ENERGIA OY") keeps its own name.
 */
function dropProcessor(s: string): string {
  return s.replace(PROCESSOR_PREFIX, (prefix) => (!prefix.includes("*") && PLACE_AND_COUNTRY.test(fold(s.slice(prefix.length))) ? prefix : ""));
}

/** A city's spelling with Ä and Ö written AE and OE, as a card account does, and with them: "JYVAESKYLAE" is "JYVÄSKYLÄ". */
const cityKey = (city: string) => fold(city).replace(/AE/g, "A").replace(/OE/g, "O");

/**
 * The text of a card account (CARD_ACCOUNT_TEXT) without its country, its city and the same city at the end; else `s`.
 * The first word after the country is the city when the same word ends the text, when a processor follows it (the
 * processor stands where the name begins) or when it is a town of PLACES, in its own spelling or with AE and OE for
 * Ä and Ö ("JOENSUU" holds an OE of its own). When none holds, the word may be the first of the name, so only the
 * country goes. A town followed by nothing but a company form ("TIKKURILA OYJ") is a company named for its town, kept.
 */
export function dropCardAccountPrefix(s: string): string {
  const m = CARD_ACCOUNT_TEXT.exec(s);
  if (!m || !COUNTRY_CODES.has(m[1]!) || m[4] === undefined) return s;
  const [afterCountry, city, rest] = [m[2]!, m[3]!, m[4].trimEnd()];
  const at = rest.lastIndexOf(" ");
  const repeated = at > 0 && cityKey(rest.slice(at + 1)) === cityKey(city);
  if (!repeated && !isPlaceName(city) && !isPlaceName(cityKey(city)) && !PROCESSOR_PREFIX.test(rest)) return afterCountry;
  const name = rest.slice(0, at).trim();
  const kept = repeated && !isSurnameAfterName(fold(city), name) ? name : rest;
  return COMPANY_FORMS.has(fold(kept)) ? afterCountry : kept;
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
