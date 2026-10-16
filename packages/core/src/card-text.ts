import { isRefundText } from "./wording.ts";

/** ISO 3166-1 alpha-3: how a card account writes the country of a purchase. */
export const COUNTRY_CODES = new Set(
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

/** ISO 4217 codes a card text puts in front of a foreign purchase ("USD IRL DUBLIN EXAMPLECO"). */
const CURRENCY_CODES = new Set("USD EUR GBP SEK NOK DKK CHF JPY CAD AUD NZD PLN CZK HUF CNY HKD SGD INR ISK RON BGN TRY ZAR BRL MXN KRW ILS AED THB".split(" "));
const COUNTRY_CODES_2 = new Set("FI SE EE DE IE NL LU GB UK US DK NO FR ES".split(" "));
const isCountryCode = (tok: string) => COUNTRY_CODES.has(tok) || COUNTRY_CODES_2.has(tok);
/** The cities a card text writes around a foreign merchant, word by word. */
const CARD_CITIES = ["SAN FRANCISCO", "DUBLIN", "LONDON", "AMSTERDAM", "LUXEMBOURG", "STOCKHOLM", "OSLO", "BERLIN", "NEW YORK", "SEATTLE", "MOUNTAIN VIEW", "CORK"].map((c) => c.split(" "));

/** The number of words of a card city that start at `at` (or end just before `at` when `ending`), else 0. */
function cityWords(words: readonly string[], at: number, ending = false): number {
  for (const city of CARD_CITIES) {
    const from = ending ? at - city.length : at;
    if (from >= 0 && from + city.length <= words.length && city.every((w, k) => words[from + k] === w)) return city.length;
  }
  return 0;
}

/**
 * A card text around a foreign merchant, cut off: currency, country and city in front ("USD IRL DUBLIN EXAMPLECO"),
 * the same at the end, and a refund word after a currency. A country code goes only beside a currency or a city, a city
 * in front only beside the proof of a currency or a country, or when what follows is a known merchant (`isBrand`) ("SAN FRANCISCO
 * ANTHROPIC PRO"): "DUBLIN BAKERY" keeps its name. `only`: nothing was left, the text is all envelope.
 */
export function dropCardEnvelope(s: string, fold: (text: string) => string, isBrand: (folded: string) => boolean): { text: string; only: boolean } {
  const words = s.split(" ");
  let from = 0;
  let proof = false;
  if (CURRENCY_CODES.has(words[0]!)) [from, proof] = [1, true];
  while (from < words.length) {
    const word = words[from]!;
    if (proof && isRefundText(fold(word))) from++;
    else if (isCountryCode(word) && (proof || cityWords(words, from + 1) > 0)) [from, proof] = [from + 1, true];
    else {
      const n = cityWords(words, from);
      if (!n || !(proof || isBrand(fold(words.slice(from + n).join(" "))))) break;
      from += n;
    }
  }
  if (from >= words.length) return { text: s, only: true };
  let to = words.length;
  while (to > from) {
    const n = cityWords(words, to, true);
    if (n && to - n > from) to -= n;
    else if (isCountryCode(words[to - 1]!) && to - 1 > from && (proof || cityWords(words, to - 1, true) > 0)) to--;
    else break;
  }
  return { text: from === 0 && to === words.length ? s : words.slice(from, to).join(" "), only: false };
}
