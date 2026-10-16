import { describe, expect, it } from "vitest";
import { categorize, compileRules, isUsablePattern, patternProblem } from "../src/categorize.ts";
import { categoryForMcc } from "../src/categorize-mcc.ts";
import { isUnknownMerchant, namesUnknownMerchant, UNKNOWN_MERCHANT } from "../src/merchant.ts";

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
    ["KFC TAMPERE", null, -1290, "restaurants"],
    ["TACO BELL HELSINKI", null, -1450, "restaurants"],
    ["SKODA SERVICE", null, -24000, "car"],
    ["PEUGEOT", null, -9000, "car"],
    ["RENAULT", null, -9000, "car"],
    ["MERCEDES-BENZ", null, -9000, "car"],
    ["MERCEDES BENZ SERVICE", null, -9000, "car"],
    ["AUDI", null, -9000, "car"],
    ["HONDA", null, -9000, "car"],
    ["CITROËN", null, -9000, "car"],
    ["AGODA.COM", null, -18000, "travel"],
    ["TRIP.COM INTERNATIONAL", null, -18000, "travel"],
    ["OPODO LIMITED", null, -18000, "travel"],
    ["AEGEAN AIRLINES", null, -18000, "travel"],
    ["RENTALCARS.COM", null, -18000, "travel"],
    ["EUROWINGS", null, -18000, "travel"],
    ["LOT POLISH AIRLINES", null, -18000, "travel"],
    ["LOT.COM", null, -18000, "travel"],
    ["ASOS.COM", null, -4900, "shopping"],
    ["ABOUT YOU GMBH", null, -4900, "shopping"],
    ["ABOUTYOU", null, -4900, "shopping"],
    ["NELLY.COM", null, -4900, "shopping"],
    ["CDON.COM", null, -4900, "shopping"],
    ["VINTED UAB", null, -1200, "shopping"],
    ["BUBBLEROOM", null, -4900, "shopping"],
    ["FYNDIQ", null, -4900, "shopping"],
    ["EVENTBRITE", null, -3500, "entertainment"],
    ["UBISOFT STORE", null, -3500, "entertainment"],
    ["XBOX", null, -1999, "entertainment"],
    ["ZOOM.US", null, -1499, "subscriptions"],
    ["ZOOM VIDEO COMM", null, -1499, "subscriptions"],
    ["MIDJOURNEY INC", null, -1000, "subscriptions"],
    ["PERPLEXITY", null, -2000, "subscriptions"],
    ["OVH SAS", null, -700, "subscriptions"],
    ["OVHCLOUD", null, -700, "subscriptions"],
    ["AWS EMEA", null, -500, "subscriptions"],
    ["AMAZON WEB SERVICES", null, -500, "subscriptions"],
    ["GOOGLE *CLOUD", null, -500, "subscriptions"],
    ["GOOGLE CLOUD EMEA", null, -500, "subscriptions"],
    ["PROTON AG", null, -499, "subscriptions"],
    ["PROTON.ME", null, -499, "subscriptions"],
    ["MULLVAD VPN AB", null, -500, "subscriptions"],
    ["ESET SPOL", null, -3000, "subscriptions"],
    ["DISCORD.COM", null, -999, "subscriptions"],
    ["DISCORD NITRO", null, -999, "subscriptions"],
    ["MICROSOFT *XBOX", null, -1999, "subscriptions"],
    ["BETWAY", null, -2000, "gambling"],
    ["BETFAIR", null, -2000, "gambling"],
    ["COMEON!", null, -2000, "gambling"],
    ["MR GREEN", null, -2000, "gambling"],
    ["BOLT FOOD", null, -2500, "food_delivery"],
    ["BOLT.EU/F/HELSINKI", null, -2500, "food_delivery"],
    ["BOLT", null, -1500, "transport"],
    ["AIRALO", null, -900, "telecom"],
    ["NOTINO", null, -3900, "personal_care"],
    ["RITUALS COSMETICS", null, -3900, "personal_care"],
    ["HEMTEX", null, -4900, "home"],
    ["TOYOTA FINANCIAL SERVICES", null, -25000, "loans"],
    ["REVOLUT BANK UAB", null, -5000, "transfer"],
    ["REVOLUT**1234*", null, 5000, "transfer"],
    ["WISE EUROPE SA", null, -5000, "transfer"],
    ["WISE PAYMENTS LTD", null, 5000, "transfer"],
    ["TRANSFERWISE", null, -5000, "transfer"],
    ["WESTERN UNION", null, -15000, "p2p"],
    ["WESTERN UNION", null, 15000, "p2p_in"],
    ["N26 BANK GMBH", null, -5000, "transfer"],
    ["N26 BANK GMBH", null, 5000, "transfer"],
    ["BUNQ B.V.", null, -5000, "transfer"],
    ["BUNQ B.V.", null, 5000, "transfer"],
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
    ["MORROW BANK ASA", "LASKU 09/2026", "card_bill"],
    ["MORROW BANK ASA", "LAINAN LYHENNYS", "loans"],
    ["KOMPLETT BANK", "LAINA 1234", "loans"],
    // one list of the issuers that are banks (ADR 0008): a loan named inside a longer word is a loan at each of them
    ["BANK NORWEGIAN", "ERIKOISLAINA 12", "loans"],
    ["KOMPLETT BANK", "ERIKOISLAINA 12", "loans"],
    ["MORROW BANK ASA", "ERIKOISLAINA 12", "loans"],
    // Nordea's finance company by either of its names: a card word behind it is the card's bill, the name alone a loan
    ["NORDEA RAHOITUS SUOMI GOLD", null, "card_bill"],
    ["NORDEA FINANCE FINLAND GOLD", null, "card_bill"],
    ["NORDEA RAHOITUS SUOMI OY", null, "loans"],
    ["NORDEA FINANCE FINLAND LTD", null, "loans"],
    ["NORDEA RAHOITUSYHTIO", null, "loans"],
    ["NORDEA", "LAINANLYHENNYS", "mortgage"],
    ["NORDEA FINANCE", "LAINANLYHENNYS", "loans"],
    ["ESIMERKKI", "RAHOITUSSOPIMUS 123", "loans"],
    ["ESIMERKKI", "SOPIMUS 123", "other"],
    // one list of the payment services (ADR 0008): a purchase paid at once is shopping. Anyday sells only payment in parts
    ["AFTERPAY", null, "shopping"],
    ["ANYDAY", null, "loans"],
    ["RESURS BANK AB", "LASKU 09/2026", "loans"],
    // Resurs lends by its whole name: a company with the word in its name is paid like any other
    ["HR RESURS AB", "LASKU 09/2026", "other"],
  ])("rule order: %s / %s → %s", (counterparty, description, expected) => {
    expect(categorize({ merchant: counterparty, counterparty, description, mcc: null, amountCents: -2000 }, rules).category).toBe(expected);
  });

  it("money back from a payment service is shopping's, from each service of the one list", () => {
    for (const service of ["KLARNA", "ANYDAY"]) expect(categorize({ merchant: service, counterparty: service, description: null, mcc: null, amountCents: 2000 }, rules).category, service).toBe("shopping");
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
    expect(money("MORROW BANK ASA", "SIIRTO")).toBe("credit_draw");
    expect(money("RESURS BANK AB", "SIIRTO")).toBe("credit_draw");
    expect(money("ULOSOTTOLAITOS", "PALAUTUS")).toBe("reimbursements");
  });

  it.each(["NORDEA GOLD", "NORDEA PLATINUM", "NORDEA CREDIT"])("%s names a card: money out is its bill, money in a draw on its credit", (card) => {
    const money = (amountCents: number) => categorize({ merchant: card, counterparty: card, description: null, mcc: null, amountCents }, rules).category;
    expect(money(-42000)).toBe("card_bill");
    expect(money(42000)).toBe("credit_draw");
  });

  it("a savings account at a card issuer that is a bank is saving in both directions: no card bill, no loan and no borrowing", () => {
    for (const bank of ["BANK NORWEGIAN", "MORROW BANK ASA", "KOMPLETT BANK"])
      for (const text of ["SÄÄSTÖTILI", "Säästötili 4417", "TALLETUS"])
        for (const amountCents of [-30000, 30000])
          expect(categorize({ merchant: bank, counterparty: bank, description: text, mcc: null, amountCents }, rules), `${bank} ${text} ${amountCents}`).toEqual({ category: "savings", source: "rule" });
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

  describe("the bank's own transaction code (ISO 20022)", () => {
    const coded = (bankTxnCode: string | null, amountCents: number, merchant = "Matti Meikäläinen", mcc: string | null = null) =>
      categorize({ merchant, counterparty: null, description: merchant, mcc, bankTxnCode, amountCents }, rules);

    it.each([
      ["PMNT-RCDT-SALA", 250000, "salary"],
      ["RCDT-XBSA", 250000, "salary"],
      ["PMNT-RRCT-SALA", 250000, "salary"],
      ["RRCT-XBSA", 250000, "salary"],
      ["PMNT-CCRD-CWDL", -6000, "cash"],
      ["CCRD-XBCW", -6000, "cash"],
      ["PMNT-CNTR-CWDL", -6000, "cash"],
      ["CNTR-BCWD", -6000, "cash"],
      ["PMNT-ICCN-COAT", -30000, "savings"],
      ["RCCN-COAT", 30000, "savings"],
    ])("%s on %i cents is %s, decided as a rule", (code, cents, category) => expect(coded(code, cents)).toEqual({ category, source: "rule" }));

    it.each([
      // the payer's side of a salary, the merchant's side of a card payment, deposits, any transfer inside one bank
      ["PMNT-ICDT-SALA", 250000],
      ["PMNT-MCRD-POSC", 250000],
      ["PMNT-CCRD-CDPT", 6000],
      ["PMNT-CNTR-CDPT", 6000],
      ["PMNT-RCDT-BOOK", 30000],
      ["PMNT-RCCN-ICCT", 30000],
      // another domain, half a code, lower case, nothing
      ["CAMT-RCDT-SALA", 250000],
      ["SALA", 250000],
      ["PMNT-SALA", 250000],
      ["pmnt-rcdt-sala", 250000],
      ["", 250000],
      [null, 250000],
    ])("%s decides nothing", (code, cents) => {
      expect(coded(code, cents)).toEqual({ category: "income", source: "default" });
      expect(coded(code, -cents)).toEqual({ category: "other", source: "default" });
    });

    it("a card payment code names no category: the merchant, the card's MCC or nothing decides, as without it", () => {
      for (const code of ["PMNT-CCRD-POSD", "CCRD-POSC", "CCRD-XBCP", "CCRD-SMRT"]) {
        expect(coded(code, -500, "K-Market Kamppi")).toEqual({ category: "groceries", source: "rule" });
        expect(coded(code, -500, "Jokin Pikkukauppa", "5411")).toEqual({ category: "groceries", source: "mcc" });
        expect(coded(code, -500)).toEqual({ category: "other", source: "default" });
        expect(coded(code, 500)).toEqual({ category: "income", source: "default" });
      }
    });

    it("the direction of the money must fit the code", () => {
      expect(coded("RCDT-SALA", -250000).category).toBe("other");
      expect(coded("CCRD-CWDL", 6000).category).toBe("income");
    });

    it("a purpose in the wording decides before a code, and a code before a merchant's name: an employer may be a shop or a hospital", () => {
      for (const payer of ["Kela", "Keva", "Varma", "Ilmarinen", "Verohallinto"]) expect(coded("RCDT-SALA", 14000, payer).category, payer).toBe("benefits");
      for (const employer of ["Zalando", "HUS-yhtymä", "Lidl Suomi Ky", "VR-Yhtymä Oyj", "Elisa Oyj", "Helsingin yliopisto"])
        expect(coded("RCDT-SALA", 250000, employer), employer).toEqual({ category: "salary", source: "rule" });
      // a staffing company with a lender's word in its name pays wages: no money borrowed
      expect(coded("RCDT-SALA", 250000, "Resurs Bemanning AB")).toEqual({ category: "salary", source: "rule" });
      // cash from a shop's till carries the shop's name
      expect(coded("CCRD-CWDL", -2000, "K-Market Kamppi")).toEqual({ category: "cash", source: "rule" });
      expect(coded("CCRD-CWDL", -2000, "HSL Automaatti").category).toBe(categorize(tx("HSL Automaatti", -2000), rules).category);
      expect(coded("ICCN-COAT", -2000, "Nordnet").category).toBe("investments");
      const own = compileRules([{ field: "merchant", pattern: "Matti Meikäläinen", category: "p2p_in", priority: 10 }]);
      expect(categorize({ ...tx("Matti Meikäläinen", 500), bankTxnCode: "RCDT-SALA" }, own)).toMatchObject({ category: "p2p_in", byUser: true });
    });

    it("money back for a cost is no pay, though it came in the payroll batch", () => {
      const paid = (payer: string, description: string) => categorize({ merchant: payer, counterparty: payer, description, mcc: null, bankTxnCode: "PMNT-RCDT-SALA", amountCents: 12300 }, rules).category;
      for (const text of ["MATKALASKU 09/2026", "KULUKORVAUS", "KORVAUS", "HYVITYS", "PALAUTUS"]) expect(paid("ACME OY", text), text).toBe("reimbursements");
      expect(paid("LÄHITAPIOLA", "VAKUUTUSKORVAUS")).toBe("reimbursements");
      // where the wording names no purpose the code is trusted
      expect(paid("MATTI MEIKÄLÄINEN", "RUOKARAHAT")).toBe("salary");
    });

    it("a code decides before the card's MCC", () => {
      expect(coded("CCRD-CWDL", -6000, "Jokin Pikkukauppa", "5411")).toEqual({ category: "cash", source: "rule" });
    });
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

  it("never applies a merchant rule for the placeholder of unnamed rows", () => {
    // what 0.8.3 stored when one unnamed row was given a category "for the merchant"
    const stale = compileRules([
      { field: "merchant_exact", pattern: UNKNOWN_MERCHANT, category: "restaurants", priority: 5 },
      { field: "merchant", pattern: "tuntematon", category: "restaurants", priority: 10 },
    ]);
    const unnamed = { ...tx(UNKNOWN_MERCHANT, -500), description: null };
    expect(categorize(unnamed, stale)).toEqual({ category: "other", source: "default" });
    expect(categorize(unnamed, rules)).toEqual({ category: "other", source: "default" });
    // a rule for a named merchant, or on another field, still works
    const others = compileRules([
      { field: "merchant_exact", pattern: "Kahvila Ilo", category: "restaurants", priority: 5 },
      { field: "description", pattern: "Tuntematon", category: "gifts", priority: 10 },
    ]);
    expect(categorize(tx("Kahvila Ilo", -450), others).category).toBe("restaurants");
    expect(categorize(tx(UNKNOWN_MERCHANT, -450), others).category).toBe("gifts");
    expect(isUnknownMerchant(" TUNTEMATON ")).toBe(true);
    expect(isUnknownMerchant("Xyzzy Tuntematon")).toBe(false);
    expect(namesUnknownMerchant({ field: "any", pattern: UNKNOWN_MERCHANT })).toBe(false);
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

  // the shape of a name is the one the register lookup reads (wording isPersonShaped): an initial, a comma, an apostrophe
  it.each(["HELEN J. LAINE", "LAINE, HELEN", "H. LAINE", "ELISA O'ESIMERKKI", "ELISA2 VIRTANEN"])("MobilePay with %s is a payment between people", (name) => {
    expect(cat(name, "MOBILEPAY", -2000)).toBe("p2p");
    expect(cat(name, "MOBILEPAY", 2000)).toBe("p2p_in");
  });

  it("SA, SE and AS are words of a name, as they are to the register", () => {
    expect(cat("ELISA DE SA", "MOBILEPAY", -2000)).toBe("p2p");
    expect(cat("HELEN SE JIN", "MOBILEPAY", -2000)).toBe("p2p");
    // the cost: a company named by one brand word and such a form reads as a person too
    expect(cat("ZALANDO SE", "MOBILEPAY", -2000)).toBe("p2p");
    expect(cat("ZALANDO SE", "KORTTIOSTO", -2000)).toBe("shopping");
  });

  it("a brand with a chain's letter and hyphen or with a digit is no first name", () => {
    expect(cat("S-MARKET ESIMERKKI", "MOBILEPAY", -1500)).toBe("groceries");
    expect(cat("K-RAUTA ESIMERKKI", "MOBILEPAY", -1500)).toBe("home");
    expect(cat("R-KIOSKI ESIMERKKI", "MOBILEPAY", -1500)).toBe("groceries");
    expect(cat("FITNESS24 SEVEN", "MOBILEPAY", -1000)).toBe("fitness");
    expect(cat("ANNA-LIISA HELEN", "MOBILEPAY", -1500)).toBe("p2p");
  });

  it("a company form at either end is a company's to the rules, also one a first name begins with", () => {
    expect(cat("AB ESIMERKKI", "MOBILEPAY", -1000)).toBe("other");
    expect(cat("KY HELEN", "MOBILEPAY", -1000)).toBe("utilities");
    expect(cat("HELEN LAINE OY", "MOBILEPAY", -1000)).toBe("utilities");
  });

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

describe("foreign brands a household pays", () => {
  const cat = (merchant: string, description: string | null, cents: number, counterparty: string | null = merchant) =>
    categorize({ merchant, counterparty, description, mcc: null, amountCents: cents }, compileRules([])).category;

  it("a car maker is a car at a service's sum and a purchase from 1 500 euros, either way of the money", () => {
    for (const brand of ["SKODA", "PEUGEOT", "RENAULT", "MERCEDES-BENZ", "AUDI", "HONDA", "CITROEN", "CITROËN"]) {
      expect(cat(brand, null, -149_999)).toBe("car");
      expect(cat(brand, null, -150_000)).toBe("vehicle_purchase");
      expect(cat(brand, null, 150_000)).toBe("vehicle_purchase");
    }
    // service and parts are upkeep at any sum
    expect(cat("SKODA SERVICE", null, -250_000)).toBe("car");
    expect(cat("AUDI VARAOSAT", null, -250_000)).toBe("car");
  });

  it("a maker's lorries, finance arm and a bare given name are no car", () => {
    expect(cat("RENAULT TRUCKS", null, -9000)).not.toBe("car");
    expect(cat("MERCEDES-BENZ FINANCIAL SERVICES", null, -9000)).not.toBe("car");
    expect(cat("MERCEDES", null, -9000)).toBe("other");
    expect(cat("KIA", null, -9000)).toBe("other");
    expect(cat("KIA FINLAND", null, -9000)).toBe("other");
  });

  it("a car brand stands whole: a street, a place or a longer word is not it", () => {
    expect(cat("AUDIBLE", null, -999)).toBe("subscriptions");
    expect(cat("HONDALA OY", null, -9000)).toBe("other");
    expect(cat("SKODAN KATU 5", null, -9000)).toBe("other");
    expect(cat("AUDITOINTI OY", null, -9000)).toBe("other");
  });

  it("a refund and a payment in from the car maker's financier is no loan payment", () => {
    expect(cat("TOYOTA FINANCIAL SERVICES", "HYVITYS", 6000)).toBe("reimbursements");
    expect(cat("TOYOTA FINANCIAL SERVICES", "RAHOITUS 44512", 1_200_000)).toBe("income");
    expect(cat("TOYOTA FINANCIAL SERVICES", "ERA 10/2026", -32_000)).toBe("loans");
    // the Finnish finance company's payout is still a loan drawn
    expect(cat("TOYOTA FINANCE FINLAND OY", "RAHOITUS 44512", 1_200_000)).toBe("credit_draw");
  });

  it("the narrowed patterns need the whole phrase", () => {
    for (const merchant of ["WISE", "WISE GUYS OY", "NELLY", "ABOUT YOU", "ZOOM", "PROTON", "AEGEAN", "TRIP", "DISCORD", "RITUALS", "LOT", "COME ON", "OVHAUS", "ESETTI", "XOVH"]) {
      expect(cat(merchant, null, -2000)).toBe("other");
    }
  });

  it("a MobilePay or transfer row to a person named like a brand is a person's", () => {
    for (const name of ["NELLY MEIKALAINEN", "PROTON MEIKALAINEN", "WISE MEIKALAINEN", "MERCEDES MEIKALAINEN", "KIA MEIKALAINEN", "COME ON MEIKALAINEN", "AUDI MEIKALAINEN", "HONDA MEIKALAINEN"]) {
      expect(cat(name, "MOBILEPAY", -2000)).toBe("p2p");
      expect(cat(name, "SIIRTO HENKILOLLE", -2000)).toBe("p2p");
      expect(cat(name, "MOBILEPAY", 2000)).toBe("p2p_in");
    }
    expect(cat("NELLY MEIKALAINEN", "SIIRTO", -2000)).toBe("other");
  });

  it("the specific brand wins over the broader one that holds its word", () => {
    expect(cat("BOLT FOOD", null, -2500)).toBe("food_delivery");
    expect(cat("BOLT.EU/R/HELSINKI", null, -1500)).toBe("transport");
    expect(cat("AWS EMEA", null, -500)).toBe("subscriptions");
    expect(cat("AMAZON EU SARL", null, -2500)).toBe("shopping");
    expect(cat("GOOGLE CLOUD EMEA", null, -500)).toBe("subscriptions");
    expect(cat("GOOGLE *YOUTUBE", null, -1299)).toBe("subscriptions");
    expect(cat("MICROSOFT *XBOX", null, -1999)).toBe("subscriptions");
  });

  it("a brand word beside a Finnish street or place is the brand only when it stands whole", () => {
    expect(cat("OVH HELSINKI", null, -700)).toBe("subscriptions");
    expect(cat("ESET HELSINKI", null, -3000)).toBe("subscriptions");
    expect(cat("OVHINTIE 5", null, -700)).toBe("other");
    expect(cat("ESETINTIE 5 TAMPERE", null, -3000)).toBe("other");
    expect(cat("KFC TAMPERE", null, -1290)).toBe("restaurants");
    expect(cat("KFCKATU TAMPERE", null, -1290)).toBe("other");
  });

  it("money moved through a foreign account is a transfer, never spending, and Western Union is a person paid", () => {
    expect(cat("REVOLUT BANK UAB", "TOP-UP", -5000)).toBe("transfer");
    expect(cat("WISE EUROPE SA", null, 5000)).toBe("transfer");
    expect(cat("WESTERN UNION", null, -15000)).toBe("p2p");
  });
});
