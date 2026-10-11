import { describe, expect, it } from "vitest";
import { categorize, categoryForMcc, compileRules, isUsablePattern, patternProblem } from "../src/categorize.ts";

const rules = compileRules([]);
const tx = (merchant: string, amountCents: number, extra: { description?: string; mcc?: string } = {}) => ({
  merchant,
  counterparty: null,
  description: extra.description ?? merchant,
  mcc: extra.mcc ?? null,
  amountCents,
});

describe("categorize", () => {
  it.each([
    ["K-Market", -2350, "groceries"],
    ["Wolt", -2890, "food_delivery"],
    ["Uber Eats", -2890, "food_delivery"],
    ["Uber", -1590, "transport"],
    ["Spotify", -1199, "subscriptions"],
    ["Disney+", -999, "subscriptions"],
    ["Elisa Viihde", -1990, "subscriptions"],
    ["Elisa", -2990, "telecom"],
    ["HSL", -6470, "transport"],
    ["Helen", -5512, "utilities"],
    ["Sokos Hotels", -12900, "travel"],
    ["Sokos", -4900, "shopping"],
    ["Apteekki", -1290, "health"],
  ])("%s %d → %s", (merchant, amount, expected) => {
    expect(categorize(tx(merchant, amount), rules).category).toBe(expected);
  });

  // one case per kind of biller a Finnish household pays; texts as banks show them
  it.each([
    ["ASUNTO OY KOIVIKKO", "HOITOVASTIKE 10/2026", -31500, "housing"],
    ["AS OY KOIVIKKO", "VESIMAKSU ENNAKKO", -2400, "housing"],
    ["HOAS", "VUOKRA 10/2026", -52000, "housing"],
    ["SHURGARD", "PIENVARASTO", -8900, "housing"],
    ["VÄRE OY", "SÄHKÖ 09/2026", -6420, "utilities"],
    ["LOISTE SÄHKÖNMYYNTI OY", null, -5500, "utilities"],
    ["ALVA OY", "KAUKOLÄMPÖ", -9800, "utilities"],
    ["TAMPEREEN VESI", "VESILASKU", -4100, "utilities"],
    ["KIERTOKAPULA OY", "JÄTEHUOLTO", -3800, "utilities"],
    ["NUOHOUSPALVELU MÄKI", null, -6500, "utilities"],
    ["SÄHKÖASENNUS LAINE OY", null, -24000, "home"],
    ["SIIVOUSPALVELU PUHDAS", null, -9600, "home"],
    ["LOUNEA OY", "LAAJAKAISTA", -3990, "telecom"],
    ["POHJANTÄHTI", "VAKUUTUSMAKSU", -12000, "insurance"],
    ["TEHY RY", "JÄSENMAKSU", -2800, "memberships"],
    ["IAET-KASSA", "JÄSENMAKSU 2026", -1100, "memberships"],
    ["AUTOLIITTO", null, -6900, "memberships"],
    ["VANTAAN JA KERAVAN HYVINVOINTIALUE", "ASIAKASMAKSU", -4170, "health"],
    ["SYNSAM", null, -18900, "health"],
    ["PSYKOTERAPIA VIRTA", null, -9000, "health"],
    ["HELSINGIN KAUPUNKI", "VARHAISKASVATUS ASIAKASMAKSU", -29500, "kids"],
    ["ESPOON KAUPUNKI", "LASKU 123456", -4500, "taxes"],
    ["PARKKIPATE OY", "VALVONTAMAKSU", -6000, "taxes"],
    ["MAANMITTAUSLAITOS", null, -15000, "taxes"],
    ["TOUHULA PÄIVÄKODIT", null, -30000, "kids"],
    ["KANSALAISOPISTO", "KURSSIMAKSU", -6500, "education"],
    ["HELSINGIN YLIOPISTO", null, -10000, "education"],
    ["MTV KATSOMO", null, -1295, "subscriptions"],
    ["SKYSHOWTIME", null, -699, "subscriptions"],
    ["ILTALEHTI", "TILAUS", -1490, "subscriptions"],
    ["FRESSI", null, -3900, "fitness"],
    ["SEURAMAKSU HIFK", null, -12000, "fitness"],
    ["MINIMANI", null, -6720, "groceries"],
    ["SOCIAL BURGERJOINT", null, -1890, "restaurants"],
    ["KAMUX", "HUOLTO", -24900, "car"],
    ["MOOVY", "PYSÄKÖINTI", -340, "car"],
    ["TAKSI HELSINKI", null, -2890, "transport"],
    ["FLIXBUS", null, -1999, "transport"],
    ["WIZZ AIR", null, -8900, "travel"],
    ["OMENA HOTELS", null, -7900, "travel"],
    ["GINA TRICOT", null, -2995, "shopping"],
    ["J. KÄRKKÄINEN", null, -4990, "shopping"],
    ["TIKETTI", null, -6900, "entertainment"],
    ["KORKEASAARI", null, -2400, "entertainment"],
    ["COOLBET", null, -2000, "gambling"],
    ["SYÖPÄSÄÄTIÖ", "LAHJOITUS", -5000, "gifts_donations"],
    ["SUPERALKO", null, -9900, "alcohol"],
    ["ULOSOTTOLAITOS", null, -15000, "collection"],
    ["S-ETUKORTTI VISA", "LASKU 09/2026", -42000, "card_bill"],
    ["NORDEA PLATINUM", "LASKU", -42000, "card_bill"],
    ["MONEYGO", "LYHENNYS", -12000, "loans"],
  ])("%s / %s → %s", (counterparty, description, amountCents, expected) => {
    const input = { merchant: counterparty, counterparty, description, mcc: null, amountCents };
    expect(categorize(input, rules).category).toBe(expected);
  });

  it.each([
    ["ALVA NIEMINEN", "LAINA TAKAISIN", "loans"],
    ["SERENA KOSKINEN", "SYNTTÄRILAHJA", "other"],
    ["MATTI KÄRKKÄINEN", "VUOKRAOSUUS", "housing"],
    ["ELISA", "SALDON LATAUS", "telecom"],
  ])("names that are also brand words: %s / %s → %s", (counterparty, description, expected) => {
    expect(categorize({ merchant: counterparty, counterparty, description, mcc: null, amountCents: -2000 }, rules).category).toBe(expected);
  });

  it.each([
    ["AUTOTALO LAAKKONEN", null, "car"],
    ["MATTI LAAKKONEN", "SIIRTO", "other"],
    ["VEPSÄLÄINEN OY", null, "home"],
    ["MIKKO VEPSÄLÄINEN", "SIIRTO", "other"],
    ["MASKUN KALUSTETALO", null, "home"],
    ["KIRJASTO MASKU", "MYÖHÄSTYMISMAKSU", "entertainment"],
    ["INTERSPORT TIKKURILA", null, "shopping"],
    ["TIKKURILA OYJ", "LASKU 4471", "home"],
    ["FYSIOPISTE TIKKURILA OY", null, "health"],
    ["KAHVILA TIKKURILA OY", null, "restaurants"],
    ["NILSON SHOES", null, "shopping"],
    ["PEKKA NILSON", "SIIRTO", "other"],
    ["ANNA DOUGLAS", "SIIRTO", "other"],
    ["JUHA LOUNASMAA", "SIIRTO", "other"],
    ["LOUNASKAHVILA PIHKA", null, "restaurants"],
    ["MARJA PUTKINEN", "SIIRTO", "other"],
    ["PUTKITYÖ LAHTINEN OY", null, "home"],
    ["PARTIOAITTA", null, "other"],
    ["SUOMEN PARTIOLAISET", "JÄSENMAKSU", "memberships"],
  ])("surnames and places in brand rules: %s / %s → %s", (counterparty, description, expected) => {
    expect(categorize({ merchant: counterparty, counterparty, description, mcc: null, amountCents: -2000 }, rules).category).toBe(expected);
  });

  it.each([
    ["SUOMEN SYDÄNLIITTO RY", "LAHJOITUS", "gifts_donations"],
    ["MANNERHEIMIN LASTENSUOJELULIITTO RY", null, "gifts_donations"],
    ["SUOMEN LUONNONSUOJELULIITTO RY", null, "gifts_donations"],
    ["SÄHKÖPALVELU VIRTANEN", null, "home"],
    ["SÄHKÖURAKOINTI MÄKI OY", null, "home"],
    ["HOTELLI SEURAHUONE", null, "travel"],
    ["HOTELLI SEURAHUONE", "RAVINTOLA", "restaurants"],
    ["TANSSISTUDIO ASKEL", null, "fitness"],
    ["SUOMEN URHEILUOPISTO", null, "other"],
    ["BANK NORWEGIAN", "KORTTILASKU 09/2026", "card_bill"],
    ["BANK NORWEGIAN", "LAINAN LYHENNYS", "loans"],
  ])("rule order: %s / %s → %s", (counterparty, description, expected) => {
    expect(categorize({ merchant: counterparty, counterparty, description, mcc: null, amountCents: -2000 }, rules).category).toBe(expected);
  });

  it("money in: rent received is income, pensions and allowances are benefits", () => {
    const money = (counterparty: string, description: string) => categorize({ merchant: counterparty, counterparty, description, mcc: null, amountCents: 65000 }, rules).category;
    expect(money("VIRTANEN LIISA", "VUOKRA 10/2026")).toBe("income");
    expect(money("VIRTANEN LIISA", "VUOKRAT 10/2026")).toBe("income");
    expect(money("VUOKRAVÄLITYS OY", "VUOKRATILITYS 10/2026")).toBe("income");
    expect(money("VARMA", "TYÖELÄKE")).toBe("benefits");
    expect(money("KELA", "ANSIOPÄIVÄRAHA")).toBe("benefits");
    expect(money("TYÖTTÖMYYSKASSA", "PÄIVÄRAHA")).toBe("benefits");
  });

  it("money in from a card issuer is borrowing, money back from enforcement is not", () => {
    const money = (counterparty: string, description: string | null) => categorize({ merchant: counterparty, counterparty, description, mcc: null, amountCents: 150000 }, rules).category;
    expect(money("BANK NORWEGIAN", null)).toBe("credit_draw");
    expect(money("ENTERCARD", "SIIRTO")).toBe("credit_draw");
    expect(money("ULOSOTTOLAITOS", "PALAUTUS")).toBe("reimbursements");
  });

  it("recognises salary only for money in", () => {
    expect(categorize(tx("Acme Oy", 320000, { description: "PALKKA 03/2026" }), rules).category).toBe("salary");
    expect(categorize(tx("Acme Oy", -320000, { description: "PALKKA 03/2026" }), rules).category).not.toBe("salary");
  });

  it("keeps a refund in the merchant's category", () => {
    expect(categorize(tx("Zalando", 5995), rules).category).toBe("shopping");
  });

  it("falls back to MCC, then to income/other", () => {
    expect(categorize(tx("Jokin Pikkukauppa", -500, { mcc: "5411" }), rules)).toEqual({ category: "groceries", source: "mcc" });
    expect(categorize(tx("Matti Meikäläinen", -500), rules)).toEqual({ category: "other", source: "default" });
    expect(categorize(tx("Matti Meikäläinen", 500), rules)).toEqual({ category: "income", source: "default" });
  });

  it("matches plain user text as whole words", () => {
    const vr = compileRules([{ field: "merchant", pattern: "VR", category: "transport", priority: 10 }]);
    expect(categorize(tx("VR Lähijuna", -450), vr).category).toBe("transport");
    expect(categorize(tx("Evry Finland Oy", -450), vr).category).not.toBe("transport");
    const max = compileRules([{ field: "merchant", pattern: "Max", category: "restaurants", priority: 10 }]);
    expect(categorize(tx("Maxi Zoo", -450), max).category).not.toBe("restaurants");
  });

  it("refuses new regex rules and empty patterns, accepts plain text", () => {
    for (const p of ["/k-market/", "/^as oy/", "/(a+)+/", "/kahvi/g", " /wolt/ "]) expect(patternProblem(p)).toMatch(/vinoviivoja/);
    for (const p of ["kahvila", "K-", "PAYPAL *", "a/b", "/", "Lidl|Prisma", "K-Market*"]) expect(patternProblem(p)).toBeNull();
    for (const p of ["", "   ", "|", " | ", "*", "**|"]) expect(patternProblem(p)).toBe("Kirjoita sana tai kauppiaan nimi.");
  });

  it("lets user rules win over built-in rules", () => {
    const custom = compileRules([{ field: "merchant", pattern: "wolt", category: "restaurants", priority: 10 }]);
    expect(categorize(tx("Wolt", -2000), custom).category).toBe("restaurants");
    const regex = compileRules([{ field: "any", pattern: "/^kahvila\\s/", category: "restaurants", priority: 10 }]);
    expect(categorize(tx("Kahvila Ilo", -450), regex).category).toBe("restaurants");
  });

  it("maps MCC ranges", () => {
    expect(categoryForMcc("5812")).toBe("restaurants");
    expect(categoryForMcc("4111")).toBe("transport");
    expect(categoryForMcc("abc")).toBeNull();
    // single codes inside a broader range win
    expect(categoryForMcc("4784")).toBe("car");
    expect(categoryForMcc("5047")).toBe("health");
    expect(categoryForMcc("8699")).toBe("memberships");
    expect(categoryForMcc("1731")).toBe("home");
  });
});

describe("Finnish compound words", () => {
  it.each([
    ["If", "IF VAHINKOVAKUUTUS OY", "insurance"],
    ["Lähitapiola", "KOTIVAKUUTUS", "insurance"],
    ["Kotikatu", "VUOKRANMAKSU 10/2026", "housing"],
    ["As Oy Koivu", "HOITOVASTIKE", "housing"],
    ["Pienyhtiö", "SÄHKÖLASKU", "utilities"],
    ["Nordea", "LAINANLYHENNYS", "mortgage"],
    ["Nordea Rahoitus", "LAINANLYHENNYS", "loans"],
  ])("%s / %s → %s", (merchant, description, expected) => {
    expect(categorize({ merchant, counterparty: null, description, mcc: null, amountCents: -10000 }, compileRules([])).category).toBe(expected);
  });
});

describe("user rules", () => {
  const rule = (pattern: string) => compileRules([{ id: 1, field: "any", pattern, category: "gifts_donations", priority: 1 }]);
  const hit = (pattern: string, counterparty: string) =>
    categorize({ merchant: counterparty, counterparty, description: null, mcc: null, amountCents: -1000 }, rule(pattern)).category === "gifts_donations";

  it.each([
    ["PAYPAL *", "PAYPAL *SPOTIFY"],
    ["K-", "K-MARKET KAMPPI"],
    ["k-market kamppi", "K-MARKET KAMPPI HELSINKI"],
    ["jäätelö", "JÄÄTELÖ BAARI"],
    ["Ayşe", "AYŞE YILMAZ"],
    ["(kuitti)", "OSTO (KUITTI) 12"],
  ])("plain text %s matches %s", (pattern, text) => expect(hit(pattern, text)).toBe(true));

  it.each([
    ["VR", "EVRY OY"],
    ["kahvi", "KAHVILA"],
    // letters of other scripts are part of a word too
    ["Jos", "JOSÉ GARCIA"],
    ["Sa", "SAŠA PETROVIĆ"],
    ["Elik", "ÇELIK OY"],
  ])("plain text %s does not match %s", (pattern, text) => expect(hit(pattern, text)).toBe(false));

  it.each([
    ["/^kahvila\\s/", "KAHVILA ILO"],
    ["/\\bpizza\\b/", "MAMMA PIZZA"],
    ["/^matti\\b/", "MATTI MEIKÄLÄINEN"],
    ["/wolt|foodora/", "FOODORA OY"],
    ["/k-market\\s+kamppi/", "K-MARKET KAMPPI"],
    ["/tori\\.fi/", "TORI.FI"],
    ["/^jäätelö$/i", "JÄÄTELÖ"],
  ])("an old regex rule %s still matches %s", (pattern, text) => {
    expect(isUsablePattern(pattern)).toBe(true);
    expect(hit(pattern, text)).toBe(true);
  });

  it.each(["/(a+)+/", "/k-market\\s+\\d+/", "/lahja\\w*/", "/.*/", "/a\\bb/", "/[a-z]+ oy/", "/(\\w)\\1/", "/^matti\\B/", "/|/"])(
    "an old regex rule %s never matches",
    (pattern) => {
      expect(isUsablePattern(pattern)).toBe(false);
      for (const text of ["AAAAAAAAAAAAAAAAAAAAAAAAAAAA!", "K-MARKET 123", "LAHJAKORTTI", "MATTIX", "AB OY"]) expect(hit(pattern, text)).toBe(false);
    },
  );

  it("treats plain text as usable unless it is empty", () => {
    expect(isUsablePattern("Lidl")).toBe(true);
    expect(isUsablePattern("Lidl|Prisma")).toBe(true);
    expect(isUsablePattern("K-Market*")).toBe(true);
    expect(isUsablePattern("   ")).toBe(false);
  });

  it.each([
    ["Lidl|Prisma", "LIDL TIKKURILA", true],
    ["Lidl|Prisma", "PRISMA JUMBO", true],
    [" lidl | prisma ", "PRISMA", true],
    ["Lidl|Prisma", "ALEPA", false],
    ["Lidl|Prisma", "PRISMANTIE 4", false],
    ["Lidl|", "LIDL", true],
    ["K-Market*", "K-MARKET KAMPPI", true],
    ["K-Market*", "K-MARKETIT OY", true],
    ["kahvi*", "KAHVILA ILO", true],
    ["kahvi*", "PIKKUKAHVILA", false],
    ["kahvi*|pizza", "MAMMA PIZZA", true],
    ["k-market", "K-MARKETIT OY", false],
  ])("%s: alternatives and a trailing star, %s → %s", (pattern, text, expected) => expect(hit(pattern, text)).toBe(expected));
});

describe("merchant_exact rules", () => {
  const rules = compileRules([{ id: 1, field: "merchant_exact", pattern: "Matti Meikäläinen", category: "gifts_donations", priority: 1 }]);
  const cat = (merchant: string, counterparty: string | null = merchant) =>
    categorize({ merchant, counterparty, description: "MOBILEPAY", mcc: null, amountCents: -1000 }, rules).category;

  it("matches the whole merchant name only, ignoring case and dots", () => {
    expect(cat("Matti Meikäläinen")).toBe("gifts_donations");
    expect(cat("MATTI MEIKALAINEN")).toBe("gifts_donations");
    expect(cat(" Matti  Meikäläinen ")).toBe("gifts_donations");
    expect(cat("Mobilepay Matti Meikäläinen", null)).not.toBe("gifts_donations");
    expect(cat("Matti Meikäläinen Oy")).not.toBe("gifts_donations");
  });

  it("takes no wildcards or alternatives: the name is compared as it is", () => {
    const literal = compileRules([{ id: 2, field: "merchant_exact", pattern: "K-Market*", category: "groceries", priority: 1 }]);
    const input = (merchant: string) => ({ merchant, counterparty: null, description: null, mcc: null, amountCents: -1000 });
    expect(categorize(input("K-Market*"), literal).category).toBe("groceries");
    expect(categorize(input("K-Marketti Oy"), literal).category).toBe("other");
  });

  it("keeps merchant rules matching whole words", () => {
    const words = compileRules([{ id: 3, field: "merchant", pattern: "Matti Meikäläinen", category: "gifts_donations", priority: 1 }]);
    const input = { merchant: "Mobilepay Matti Meikäläinen", counterparty: null, description: null, mcc: null, amountCents: -1000 };
    expect(categorize(input, words).category).toBe("gifts_donations");
  });

  it("tells which result came from the user's own rule", () => {
    expect(categorize({ merchant: "Matti Meikäläinen", counterparty: null, description: null, mcc: null, amountCents: -1000 }, rules).byUser).toBe(true);
    expect(categorize({ merchant: "Wolt", counterparty: null, description: null, mcc: null, amountCents: -1000 }, rules).byUser).toBeUndefined();
  });
});

describe("people vs merchants", () => {
  const cat = (counterparty: string, description: string, cents: number) =>
    categorize({ merchant: counterparty, counterparty, description, mcc: null, amountCents: cents }, compileRules([])).category;

  it.each(["ELISA VIRTANEN", "OTTO MÄKINEN", "SILJA KORHONEN", "MATTI VIRTA", "HELEN LAINE", "ASKO NIEMINEN", "JUHA ESKELINEN", "ANNA-LIISA SALO"])(
    "MobilePay with %s is a payment between people",
    (name) => {
      expect(cat(name, "MOBILEPAY", -2000)).toBe("p2p");
      expect(cat(name, "MOBILEPAY", 2000)).toBe("p2p_in");
    },
  );

  // since 2022 the app is Vipps MobilePay, and the bank text says Vipps (or both words) on rows of the new brand
  it.each(["VIPPS", "VIPPS MOBILEPAY", "Vipps MobilePay Oy"])("a %s payment to or from a person is a payment between people", (description) => {
    expect(cat("ELISA VIRTANEN", description, -2000)).toBe("p2p");
    expect(cat("ELISA VIRTANEN", description, 2000)).toBe("p2p_in");
    expect(cat("ANNA-LIISA SALO", description, -1500)).toBe("p2p");
  });

  it("a Vipps payment to a payee with a company form is not a payment to a person", () => {
    expect(cat("ELISA OYJ", "VIPPS", -2990)).toBe("telecom");
    expect(cat("K-MARKET KAMPPI", "VIPPS MOBILEPAY", -1500)).toBe("groceries");
    expect(cat("TIKKURILAN TIIKERIT RY", "VIPPS", -1000)).toBe("other");
    expect(cat("KAHVIPAAHTIMO OY", "VIPPS", 1000)).toBe("income");
  });

  it("Vipps is a word of its own: a merchant that only contains it is not a payment between people", () => {
    expect(cat("VIPPSTAD KIOSKI", "KORTTIOSTO", -1000)).not.toBe("p2p");
    expect(cat("ELISA VIRTANEN", "KORTTIOSTO", -1000)).not.toBe("p2p");
  });

  it("still recognises companies paid with MobilePay", () => {
    expect(cat("ELISA OYJ", "MOBILEPAY", -2990)).toBe("telecom");
    expect(cat("K-MARKET KAMPPI", "MOBILEPAY", -1500)).toBe("groceries");
    expect(cat("KESÄKAHVILA MAJAKKA", "MOBILEPAY", -1260)).toBe("restaurants");
    expect(cat("LÄHIAPTEEKKI KUNTTU", "MOBILEPAY", -1260)).toBe("health");
    expect(cat("ESPRESSO HOUSE ITIS", "MOBILEPAY", -590)).toBe("restaurants");
    expect(cat("TIKKURILAN TIIKERIT RY", "MOBILEPAY", -1000)).toBe("other");
    expect(cat("KAHVIPAAHTIMO OY", "MOBILEPAY", 1000)).toBe("income");
    expect(cat("ELISA VIRTANEN", "E-LASKU", -2990)).toBe("telecom"); // no MobilePay: the merchant word wins as before
  });

  it("an insurance payout is a reimbursement, a premium is insurance", () => {
    expect(cat("LÄHITAPIOLA", "VAKUUTUSKORVAUS VAHINKO 123", 200000)).toBe("reimbursements");
    expect(cat("POHJOLA VAKUUTUS OY", "KORVAUS", 50000)).toBe("reimbursements");
    expect(cat("IF VAHINKOVAKUUTUS OY", "VAKUUTUSMAKSU", -14230)).toBe("insurance");
  });
});
