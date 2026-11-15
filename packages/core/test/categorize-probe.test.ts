/**
 * A probe of the categoriser on made-up but realistic Finnish bank rows (the data-reliability review of APP-22, D9):
 * each row is a counterparty, a description, an MCC, a sum in euros and the category a household would call right.
 * Names and sums are invented. The review probed two samples, 81 and 78 rows (159 in all). Only the first was kept with
 * its report; the second is written again here (SAMPLE_B) from the review's list of errors and the same kinds of
 * rows, so it is a rebuilt sample and not the original. A row the rules miss on purpose sits in KNOWN_MISSES with its
 * reason, so a change that fixes one fails here until the row moves into the table. Rows marked "?" are open
 * questions: the test records what the rules say today and calls no category right.
 */
import { describe, expect, it } from "vitest";
import { categorize, compileRules, normalizeMerchant } from "../src/index.ts";

type Row = [counterparty: string | null, description: string | null, mcc: string | null, euros: number, expected: string];

const SAMPLE_A: readonly Row[] = [
  [null,"SUMUP *KAHVILA PIPARI","5814", -6.17, "restaurants"],
  [null,"IZ *PARTURI RISTO","7230", -61.65, "personal_care"],
  [null,"PAYTRAIL OY KYLÄKAUPPA","5411", -16.44, "groceries"],
  [null,"KLARNA*ZALANDO","5651", -109.46, "shopping"],
  [null,"ZALANDO.FI","5651", -109.46, "shopping"],
  [null,"EASYPARK PARKING","7523", -4.38, "car"],
  [null,"APCOA PARKING FINLAND","7523", -8.22, "car"],
  [null,"PARKKI HELSINKI","7523", -3.29, "car"],
  [null,"MOBILEPAY *KOIRAPUISTO","8398", -6.85, "?"],
  [null,"OP-KOTIPANKKI NOSTO","6011", -137, "cash"],
  [null,"AUTOMAATTINOSTO HELSINKI","6011", -109.6, "cash"],
  [null,"KORTTIMAKSU/NOSTO","6011", -27.4, "cash"],
  [null,"TILINHOITOMAKSU","", -6.71, "fees"],
  ["NORDEA PANKKI SUOMI OYJ","PALVELUMAKSU 0.95",null, -1.3, "fees"],
  [null,"KORKO","", -16.85, "interest"],
  [null,"SIIRTO TILILTÄ 1234","", 411, "transfer"],
  ["Maija Mallikas","Vuokra",null, -616.5, "housing"],
  ["PERTTI ESIMERKKI","Kiitos kyydistä",null, -27.4, "p2p"],
  [null,"REMA 1000","5411", -32.88, "groceries"],
  [null,"COOP EXTRA OSLO","5411", -32.88, "groceries"],
  [null,"ICA SUPERMARKET STOCKHOLM","5411", -42.47, "groceries"],
  [null,"SEVEN-ELEVEN","5499", -8.22, "groceries"],
  [null,"TIGER","5311", -16.44, "shopping"],
  [null,"FLYING TIGER COPENHAGEN","5311", -16.44, "shopping"],
  [null,"ACTION VANTAA","5311", -34.25, "shopping"],
  [null,"SPORTIFE","5941", -54.8, "shopping"],
  [null,"INTERSPORT","5941", -164.4, "shopping"],
  [null,"LEMMIKKI TARVIKE OY","5995", -47.95, "pets"],
  [null,"EläinLääkäri Helsinki","0742", -164.4, "pets"],
  [null,"KUUKAUSIMAKSU HAMMASHOITO","8021", -82.2, "health"],
  [null,"CRAZY FOX","5813", -61.65, "restaurants"],
  [null,"BAR LOOSE HELSINKI","5813", -24.66, "restaurants"],
  [null,"TAKSI HELSINKI 100000","4121", -42.47, "transport"],
  [null,"BOLT FOOD","5814", -30.14, "food_delivery"],
  [null,"KOTIPIZZA KAMPPI","5814", -24.66, "restaurants"],
  [null,"DOMINOS PIZZA","5814", -32.88, "restaurants"],
  [null,"EPIC GAMES","5816", -13.56, "entertainment"],
  [null,"GOOGLE *GSUITE","7372", -8.77, "subscriptions"],
  [null,"MICROSOFT*OFFICE365","5734", -13.7, "subscriptions"],
  [null,"OPENAI *CHATGPT SUBSCR","5734", -27.4, "subscriptions"],
  [null,"ADOBE SYSTEMS","5734", -33.15, "subscriptions"],
  [null,"CLOUDFLARE","7372", -7.4, "subscriptions"],
  [null,"HETZNER ONLINE GMBH","7372", -6.17, "subscriptions"],
  [null,"WWW.DISCORD.COM","5818", -13.56, "subscriptions"],
  [null,"POSTI OY","4215", -9.45, "shopping"],
  [null,"TORI.FI","5999", -41.1, "shopping"],
  [null,"AIRBNB","6513", -137, "travel"],
  [null,"RYANAIR","4511", -53.43, "travel"],
  [null,"SAS SCANDINAVIAN","4511", -149.33, "travel"],
  [null,"TALLINK SILJA LINE","4411", -135.63, "travel"],
  [null,"VIKING LINE","4411", -82.2, "travel"],
  [null,"VR YHTIÖ OYJ","4112", -39.73, "transport"],
  [null,"ONNIBUS","4131", -12.33, "transport"],
  [null,"EUROPARK","7523", -16.44, "car"],
  [null,"AUTOKOULU","8299", -123.3, "education"],
  [null,"TRAFI AJONEUVOVERO","9399", -260.3, "taxes"],
  [null,"LIIKENNEVAKUUTUS FENNIA","6300", -411, "insurance"],
  [null,"FENNIA","", -411, "insurance"],
  [null,"AKAVA YHTEISKUNTA","8641", -47.95, "memberships"],
  [null,"UNICEF SUOMI","8398", -13.7, "gifts_donations"],
  [null,"PUNAINEN RISTI","8398", -20.55, "gifts_donations"],
  [null,"KOULULAISTEN RUOKA","5812", -4.66, "kids"],
  [null,"LEIKKI PAIKKA PUPUT","7999", -12.33, "kids"],
  [null,"SUOMEN POSTI","4215", -19.18, "shopping"],
  [null,"ROBERTS COFFEE","5814", -6.71, "restaurants"],
  [null,"JOKU RANDOM OY","", -61.65, "other"],
  [null,"Y-TUNNUS 1234567-8","", -61.65, "other"],
  [null,"Maksu 12.10.","", -13.7, "other"],
  [null,"AS OY HELSINGIN KOTI","", -315.1, "housing"],
  [null,"ASUNTO OY VASTIKE","", -315.1, "housing"],
  [null,"NORDNET BANK AB","", -205.5, "investments"],
  [null,"AVANZA BANK","", -274, "investments"],
  [null,"NORDEA RAHASTOT SAASTO","", -137, "investments"],
  [null,"KRAKEN","", -137, "investments"],
  [null,"COINBASE","", -137, "investments"],
  [null,"DANSKE BANK OSINKO","", 41.1, "investment_income"],
  [null,"TILI KORKO","", 0.42, "investment_income"],
  [null,"K-RAUTA ESPOO","5211", -109.6, "home"],
  [null,"K-MARKET KAMPPI HYVITYS","5411", 6.85, "?refund"],
  [null,"ELISA VIIHDE","4899", -13.56, "subscriptions"],
  [null,"KIRJASTO MYYNTI","5942", -4.11, "entertainment"],
  [null,"CASINO HELSINKI","7995", -68.5, "gambling"],
  [null,"VEIKKAUS","", -13.7, "gambling"],
  [null,"HOLVI PAYMENT","", -27.4, "?"],
  [null,"OMA YRITYS OY LASKU 1234","", -548, "?"],
  [null,"SEPA TILISIIRTO","", -548, "?"],
];

const SAMPLE_B: readonly Row[] = [
  [null, "K-SUPERMARKET ESIMERKKI", "5411", -48.2, "groceries"],
  [null, "S-MARKET ESPOO", "5411", -23.9, "groceries"],
  [null, "LIDL SUOMI KY", "5411", -31.4, "groceries"],
  [null, "PRISMA TAPIOLA", "5411", -87.15, "groceries"],
  [null, "SEPPÄLÄ OSTOS", "5651", -64.9, "shopping"],
  [null, "H&M HENNES & MAURITZ", "5651", -39.99, "shopping"],
  [null, "POSTI OY", "4215", -6.9, "shopping"],
  [null, "SUOMEN POSTI OYJ", "", -12.5, "shopping"],
  [null, "VERKKOKAUPPA.COM", "5732", -249, "home"],
  [null, "IKEA VANTAA", "5712", -119.5, "home"],
  [null, "JYSK ESPOO", "5712", -54, "home"],
  [null, "K-RAUTA LEPPÄVAARA", "5200", -76.3, "home"],
  [null, "NEO BARBERSHOP", "7230", -35, "personal_care"],
  [null, "APTEEKKI KAMPPI", "5912", -18.4, "health"],
  [null, "HAMMASLÄÄKÄRI ESIMERKKI", "8021", -142, "health"],
  [null, "SOKOS HOTEL ESIMERKKI", "7011", -189, "travel"],
  [null, "VR VERKKOKAUPPA", "4112", -34.5, "transport"],
  [null, "HSL MOBIILI", "4111", -3.2, "transport"],
  [null, "FINNAIR OYJ", "4511", -245, "travel"],
  [null, "SHELL KAMPPI", "5541", -62.4, "car"],
  [null, "ABC LEPPÄVAARA", "5541", -71, "car"],
  [null, "NESTE TAPIOLA", "5541", -58.3, "car"],
  [null, "WOLT HELSINKI", "5812", -26.4, "food_delivery"],
  [null, "FOODORA FINLAND", "5812", -21.9, "food_delivery"],
  [null, "RAVINTOLA ESIMERKKI", "5812", -54, "restaurants"],
  [null, "MCDONALDS KAMPPI", "5814", -12.8, "restaurants"],
  [null, "ALKO KAMPPI", "5921", -38.7, "alcohol"],
  [null, "SPOTIFY AB", "", -11.99, "subscriptions"],
  [null, "NETFLIX.COM", "", -15.99, "subscriptions"],
  [null, "GOOGLE *GSUITE_ESIMERKKI", "", -6.8, "subscriptions"],
  [null, "GOOGLE *GSUITE", "7372", -12.36, "subscriptions"],
  [null, "AVANZA BANK AB", "", -200, "investments"],
  [null, "AVANZA", "6211", -150, "investments"],
  [null, "NORDNET BANK AB", "", -300, "investments"],
  [null, "ELISA OYJ", "", -29.9, "telecom"],
  [null, "DNA OYJ", "", -24.9, "telecom"],
  [null, "HELEN SÄHKÖNMYYNTI", "", -86.4, "utilities"],
  [null, "FORTUM MARKKINAT", "", -72.1, "utilities"],
  [null, "HELSINGIN KAUPUNKI VESI", "", -31.2, "utilities"],
  [null, "IF VAKUUTUS", "", -48.3, "insurance"],
  [null, "POHJOLA VAKUUTUS", "", -52.5, "insurance"],
  [null, "VEIKKAUS OY", "7995", -20, "gambling"],
  [null, "STEAM PURCHASE", "5816", -29.99, "entertainment"],
  [null, "FINNKINO ESIMERKKI", "7832", -27, "entertainment"],
  [null, "SIIRTO OMALLE TILILLE", "", -500, "transfer"],
  [null, "SIIRTO OMALLE TILILLE", "", 500, "transfer"],
  [null, "SIIRTO TILILTÄ", "", 200, "transfer"],
  [null, "SIIRTO TILILTÄ 5678", "", 85, "transfer"],
  [null, "KORTTIMAKSU / NOSTO", "6011", -60, "cash"],
  [null, "KORTTIMAKSU/NOSTO HELSINKI", "6011", -100, "cash"],
  [null, "NOSTO AUTOMAATILTA", "6011", -80, "cash"],
  ["VEROHALLINTO", "VEROJEN PALAUTUS", null, 482.3, "tax_refund"],
  ["VEROHALLINTO", "VERONPALAUTUS", null, 215, "tax_refund"],
  ["VEROHALLINTO", "JÄÄNNÖSVERO", null, -190, "taxes"],
  ["VEROHALLINTO", "ENNAKKOVERO", null, -120, "taxes"],
  ["KELA", "LAPSILISA", null, 94.88, "benefits"],
  ["KELA", "ASUMISTUKI", null, 310.4, "benefits"],
  ["ELÄKEVAKUUTUSYHTIÖ ESIMERKKI", "ELÄKE", null, 1450, "benefits"],
  ["ESIMERKKI OY", "PALKKA", null, 2840, "salary"],
  ["ESIMERKKI OY", "PALKKA 09/2026", null, 3120.5, "salary"],
  ["TYÖTTÖMYYSKASSA", "PÄIVÄRAHA", null, 1210, "benefits"],
  [null, "TILINHOITOMAKSU", "", -4.9, "fees"],
  [null, "KORTIN VUOSIMAKSU", "", -19, "fees"],
  [null, "TALLETUSKORKO", "", 1.2, "investment_income"],
  [null, "OSINKO ESIMERKKI OYJ", "", 38, "investment_income"],
  ["Maija Mallikas", "Vuokra", null, -720, "housing"],
  [null, "VUOKRAVASTIKE", "", -650, "housing"],
  [null, "TORI.FI", "", 45, "sales"],
  [null, "VINTED", "", 18, "sales"],
  [null, "HUUTO.NET", "", 70, "sales"],
  [null, "SUOMEN PELASTUSLIITTO LAHJOITUS", "", -20, "gifts_donations"],
  [null, "PÄIVÄKOTI ESIMERKKI", "", -150, "kids"],
  [null, "ELÄINLÄÄKÄRI ESIMERKKI", "0742", -88, "pets"],
  [null, "MUSTI JA MIRRI", "5995", -41, "pets"],
  [null, "AYY JÄSENMAKSU", "", -25, "memberships"],
  [null, "LUOTONNOSTO", "", 1000, "credit_draw"],
  [null, "LAINAN LYHENNYS", "", -420, "loans"],
  [null, "OPINTOLAINA LYHENNYS", "", -85, "student_loan"],
];

const ROWS: readonly Row[] = [...SAMPLE_A, ...SAMPLE_B];

/** Rows whose expected category the rules do not give, with what they give and why that stands. */
const KNOWN_MISSES: Readonly<Record<string, { got: string; why: string }>> = {
  "PERTTI ESIMERKKI|Kiitos kyydistä": { got: "other", why: "a person's name with a thank-you text is no evidence of a payment between people; Tarkistettavat asks" },
  "|KOULULAISTEN RUOKA": { got: "restaurants", why: "the MCC says a restaurant and the name is no trade word for children's care" },
  "|HELSINGIN KAUPUNKI VESI": { got: "taxes", why: "a city's name stands for its fees (Verot, maksut ja sakot); a utility row named after the city is not told from them" },
  "|LEIKKI PAIKKA PUPUT": { got: "entertainment", why: "the MCC says entertainment and the name is no trade word for children's care" },
};

/** The rows marked "?": what the rules say today, so a change of any of them is seen and judged. */
const OPEN_TODAY: Readonly<Record<string, string>> = {
  "|MOBILEPAY *KOIRAPUISTO": "p2p",
  "|K-MARKET KAMPPI HYVITYS": "groceries",
  "|HOLVI PAYMENT": "other",
  "|OMA YRITYS OY LASKU 1234": "other",
  "|SEPA TILISIIRTO": "other",
};

const rules = compileRules([]);
const keyOf = ([cp, desc]: Row) => `${cp ?? ""}|${desc ?? ""}`;
const run = ([cp, desc, mcc, euros]: Row) =>
  categorize({ merchant: normalizeMerchant(cp, desc), counterparty: cp, description: desc, mcc: mcc || null, amountCents: Math.round(euros * 100) }, rules).category;

const decided = ROWS.filter((r) => !r[4].startsWith("?"));
const open = ROWS.filter((r) => r[4].startsWith("?"));
const right = decided.filter((r) => !KNOWN_MISSES[keyOf(r)]);
const missed = decided.filter((r) => KNOWN_MISSES[keyOf(r)]);

describe("categorisation probe", () => {
  it("holds the 81 and 78 decided rows of the review: 159 in all", () => {
    const count = (rows: readonly Row[]) => rows.filter((r) => !r[4].startsWith("?")).length;
    expect([count(SAMPLE_A), count(SAMPLE_B), decided.length]).toEqual([81, 78, 159]);
  });

  it.each(right)("%s | %s -> %s", (...row) => {
    expect(run(row as unknown as Row)).toBe(row[4]);
  });

  it.each(missed)("%s | %s is a known miss", (...row) => {
    const miss = KNOWN_MISSES[keyOf(row as unknown as Row)]!;
    expect(run(row as unknown as Row)).toBe(miss.got);
  });

  it("every known miss names a row of the probe", () => {
    expect(Object.keys(KNOWN_MISSES).filter((k) => !decided.some((r) => keyOf(r) === k))).toEqual([]);
  });

  it("open questions: what the rules say today", () => {
    expect(Object.fromEntries(open.map((r) => [keyOf(r), run(r)]))).toEqual(OPEN_TODAY);
  });
});
