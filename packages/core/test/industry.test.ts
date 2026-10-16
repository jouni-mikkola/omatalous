import { describe, expect, it } from "vitest";
import { categoryByTradeWord, categoryForCompany } from "../src/categorize.ts";
import { businessMerchants, CAR_HIRE, categoryForIndustry, companyKey, formQuery, industryCandidates, isBusinessRow, matchCompany, type RegistryCompany, shorterQuery } from "../src/industry.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account } from "../src/types.ts";
import { tx } from "./helpers.ts";

describe("categoryForIndustry", () => {
  it.each([
    ["93130", "TOL2008", "fitness"],
    ["93130", "TOL2025", "fitness"],
    ["56101", "TOL2008", "restaurants"],
    ["56300", "TOL2025", "restaurants"],
    ["56400", "TOL2025", "food_delivery"],
    ["47111", "TOL2008", "groceries"],
    ["47250", "TOL2025", "alcohol"],
    ["47730", "TOL2008", "health"],
    ["47783", "TOL2008", "health"],
    ["47640", "TOL2008", "shopping"], // sports goods in 2008
    ["47640", "TOL2025", "kids"], // toys in 2025
    ["47810", "TOL2008", "groceries"], // food stalls in 2008
    ["47810", "TOL2025", "vehicle_purchase"], // car dealers in 2025: the row's sum tells the car from its upkeep
    ["45110", "TOL2008", "vehicle_purchase"],
    ["45200", "TOL2008", "car"], // a garage
    ["95310", "TOL2025", "car"],
    ["96021", "TOL2008", "personal_care"],
    ["96210", "TOL2025", "personal_care"],
    ["68202", "TOL2008", "housing"],
    ["88910", "TOL2025", "kids"],
    ["94200", "TOL2025", "memberships"],
    ["61100", "TOL2025", "telecom"],
    ["35140", "TOL2008", "utilities"],
    ["77110", "TOL2008", CAR_HIRE], // rental and leasing: the rows' rhythm tells which
    ["77110", "TOL2025", CAR_HIRE],
    ["64910", "TOL2025", "leasing"], // financial leasing
    ["52211", "TOL2008", "transport"], // bus stations
    ["52212", "TOL2025", "car"], // paid parking
    ["52219", "TOL2008", "car"],
    ["47595", "TOL2008", "shopping"], // musical instruments
    ["47741", "TOL2025", "health"], // opticians in 2025
    ["86230", "TOL2025", "health"], // dentists
    ["96210", "TOL2025", "personal_care"],
    ["93130", "TOL2008", "fitness"],
    ["45201", "TOL2008", "car"], // garages
  ] as const)("%s (%s) → %s", (code, set, category) => {
    expect(categoryForIndustry(code, set)).toBe(category);
  });

  it("says nothing for broad industries and bad codes", () => {
    expect(categoryForIndustry("46389", "TOL2025")).toBeNull(); // food wholesale
    expect(categoryForIndustry("64200", "TOL2008")).toBeNull(); // holding companies: finance that lends nothing to a household
    expect(categoryForIndustry("70100", "TOL2025")).toBeNull(); // head offices
    expect(categoryForIndustry("abc", "TOL2025")).toBeNull();
    expect(categoryForIndustry("52211", "TOL2025")).toBeNull(); // road freight terminals
  });
});

const company = (businessId: string, names: string[], code: string | null, codeSet: "TOL2008" | "TOL2025" = "TOL2025", active = true): RegistryCompany => ({
  businessId,
  names,
  active,
  industry: code ? { code, codeSet, label: null } : null,
});

describe("matchCompany", () => {
  it("prefers an exact name over a looser one", () => {
    const m = matchCompany("Lounea", [company("1", ["Lounea Yritysratkaisut Oy"], "61100"), company("2", ["Lounea Oy"], "61100")]);
    expect(m).toMatchObject({ status: "found", businessId: "2", companyName: "Lounea Oy", category: "telecom" });
  });

  it("uses auxiliary trade names", () => {
    const m = matchCompany("Kahvila Ilo", [company("1", ["Ilo Ravintolat Oy", "Kahvila Ilo"], "56300")]);
    expect(m).toMatchObject({ status: "found", category: "restaurants" });
  });

  it("finds a company whose name contains the merchant", () => {
    expect(matchCompany("Fressi", [company("1", ["Fysioline Fressi Oy"], "93130")]).category).toBe("fitness");
  });

  it("is ambiguous when equally good matches disagree or a word is too common", () => {
    expect(matchCompany("Aurinko", [company("1", ["Aurinko"], "56300"), company("2", ["Aurinko"], "96021", "TOL2008")]).status).toBe("ambiguous");
    const many = ["A", "B", "C", "D"].map((x) => company(x, [`${x} Aurinko Oy`], "56300"));
    expect(matchCompany("Aurinko", many).status).toBe("ambiguous");
  });

  it("finds the company but no category for a broad industry", () => {
    expect(matchCompany("Gilvaria", [company("1", ["Gilvaria Oy"], "46389")])).toMatchObject({ status: "found", category: null });
  });

  it("accepts only an exact name for a shortened query", () => {
    const cafes = [company("1", ["Kahvila Ilo Oy"], "56300"), company("2", ["Kahvila Ilona"], "56300")];
    expect(matchCompany("Kahvila Ilo", cafes, { exactOnly: true }).businessId).toBe("1");
    expect(matchCompany("Kahvila", cafes, { exactOnly: true }).status).toBe("none");
  });

  it("returns none when nothing matches", () => {
    expect(matchCompany("Kulmakuppila", []).status).toBe("none");
    expect(matchCompany("Kulmakuppila", [company("1", ["Kulmala Oy"], "56300")]).status).toBe("none");
  });

  it("normalises company forms and punctuation", () => {
    expect(companyKey("Oy Robert's Coffee Ab")).toBe("ROBERT S COFFEE");
    expect(companyKey("Liikuntakeskus Fressi Oy")).toBe("LIIKUNTAKESKUS FRESSI");
    expect(companyKey("Kahvila Ilo Oy Ab")).toBe("KAHVILA ILO");
    expect(companyKey("Stockmann Oyj Abp")).toBe("STOCKMANN");
    expect(companyKey("Café Señor Oy")).toBe("CAFE SENOR");
    expect(shorterQuery("Kukkakauppa Ilo Kallio")).toBe("Kukkakauppa Ilo");
    expect(shorterQuery("Hammaslääkäri Smile")).toBeNull();
    expect(shorterQuery("Fressi")).toBeNull();
    // a company form does not count as a word: "Tmi Matti" is a first name
    expect(shorterQuery("Tmi Matti Virtanen")).toBeNull();
  });

  it("drops a town or district after a single word", () => {
    expect(shorterQuery("Lankapuoti Tikkurila Oy")).toBe("Lankapuoti");
    expect(shorterQuery("Kukkakauppa Tikkurila")).toBe("Kukkakauppa");
    // two plain words are shaped like a first name and a surname, and a town is a surname too: nothing shorter
    expect(shorterQuery("Tukkatalo Tikkurila")).toBeNull();
    expect(shorterQuery("Fysiopiste Tikkurila Oy")).toBeNull();
    expect(shorterQuery("Kahvila Ilo")).toBeNull();
    // too short to be a name on its own
    expect(shorterQuery("Ab Tikkurila")).toBeNull();
    expect(shorterQuery("Ky Vantaa")).toBeNull();
  });
});

describe("matchCompany with a short name, a brand or a broad code", () => {
  it("finds the company among namesakes: equal name, then name with company form, then name that starts with it", () => {
    const hits = [
      company("1", ["Tyvensi Oy"], "47110"),
      company("2", ["Ayvens Finance Group Oy"], "64190"),
      company("3", ["Ayvens Oy"], "77110"),
      company("4", ["Brayvens Oy"], "56300"),
    ];
    expect(matchCompany("Ayvens", hits)).toMatchObject({ status: "found", businessId: "3", category: CAR_HIRE });
    // a name equal to the merchant as written beats the same name with a company form
    expect(matchCompany("Ayvens", [...hits, company("5", ["Ayvens"], "77110")])).toMatchObject({ businessId: "5" });
    expect(matchCompany("Ayvens", hits.filter((c) => c.businessId !== "3"))).toMatchObject({ businessId: "2" });
  });

  it("never matches inside a word", () => {
    expect(matchCompany("Ayvens", [company("1", ["Brayvens Oy"], "56300"), company("2", ["Tayvensi Oy"], "56300")]).status).toBe("none");
  });

  it("takes a brand for the longer company name or for a parallel and an auxiliary name", () => {
    expect(matchCompany("Esimerkki Gym", [company("1", ["Esimerkki Gym Fitness Oy"], "93130")])).toMatchObject({ status: "found", category: "fitness" });
    expect(matchCompany("Esimerkki Gym", [company("1", ["Holding Esimerkki Oy", "Esimerkki Oy", "Esimerkki Gym"], "93130")])).toMatchObject({ status: "found", companyName: "Esimerkki Gym" });
    expect(matchCompany("Esimerkki Gym", [company("1", ["Esimerkki Gym Fitness Oy"], "93130")], { exactOnly: true }).status).toBe("none");
  });

  it("prefers a company in the books to a ceased one, and one whose industry gives a category", () => {
    const ceased = company("1", ["Pikku Kuntosali Oy"], "56300", "TOL2025", false);
    const live = company("2", ["Pikku Kuntosali Oy"], "93130");
    expect(matchCompany("Pikku Kuntosali", [ceased, live])).toMatchObject({ businessId: "2", category: "fitness" });
    // a ceased company alone still answers
    expect(matchCompany("Pikku Kuntosali", [ceased])).toMatchObject({ businessId: "1", category: "restaurants" });
    // a namesake of a broad class does not stand in the way of the one with a category
    expect(matchCompany("Pikku Kuntosali", [company("3", ["Pikku Kuntosali Oy"], "46900"), live])).toMatchObject({ businessId: "2" });
    // two companies in the books with different categories: no answer
    expect(matchCompany("Pikku Kuntosali", [company("3", ["Pikku Kuntosali Oy"], "56300"), live]).status).toBe("ambiguous");
    // a ceased namesake with another category does not make it ambiguous
    expect(matchCompany("Pikku Kuntosali", [company("3", ["Pikku Kuntosali Oy"], "56300", "TOL2025", false), live]).status).toBe("found");
  });

  it("a company in the books beats a ceased one at any fit, and a ceased one-word namesake answers nothing", () => {
    const ceasedGarage = company("1", ["Linkki Oy"], "45200", "TOL2008", false);
    const live = company("2", ["Linkki Ravintolat Oy"], "56300");
    expect(matchCompany("Linkki", [ceasedGarage, live])).toMatchObject({ status: "found", businessId: "2", category: "restaurants" });
    expect(matchCompany("Linkki", [ceasedGarage]).status).toBe("ambiguous");
    // two words: a ceased company alone may be the one
    expect(matchCompany("Linkki Pesu", [company("3", ["Linkki Pesu Oy"], "96010", "TOL2008", false)]).status).toBe("found");
    // seven loose hits, five of them ceased: a common word, counted before the ceased ones go
    const seven = Array.from({ length: 7 }, (_, i) => company(`${i}`, [`Arabia ${i} Oy`], i === 0 ? "45200" : "47591", "TOL2008", i < 2));
    expect(matchCompany("Arabia", seven).status).toBe("ambiguous");
  });

  it("falls back to the trade word of the name when the code is broad or missing", () => {
    const options = { byName: categoryByTradeWord };
    const broad = company("1", ["Esimerkki Autokorjaamo Oy"], "46900");
    expect(matchCompany("Esimerkki Autokorjaamo", [broad], options)).toMatchObject({ status: "found", businessId: "1", code: "46900", category: "car" });
    expect(matchCompany("Esimerkki Autokorjaamo", [company("2", ["Esimerkki Autokorjaamo Oy"], null)], options).category).toBe("car");
    expect(matchCompany("Esimerkki Autohuolto", [company("3", ["Esimerkki Autohuolto"], "46900")], options).category).toBe("car");
    // the name says nothing: found, no category
    expect(matchCompany("Gilvaria", [company("4", ["Gilvaria Oy"], "46900")], options)).toMatchObject({ status: "found", category: null });
    // without the reader the broad code stays without one
    expect(matchCompany("Esimerkki Autokorjaamo", [broad]).category).toBeNull();
    // the industry wins over the name
    expect(matchCompany("Esimerkki Autokorjaamo", [company("5", ["Esimerkki Autokorjaamo Oy"], "56300")], options).category).toBe("restaurants");
  });

  it("asks again with a company form only for a name without one", () => {
    expect(formQuery("Ayvens")).toBe("Ayvens Oy");
    expect(formQuery("Ayvens Oy")).toBeNull();
    expect(formQuery("Esimerkki Gym Ab")).toBeNull();
    // a person's name never goes to the register, with or without a form
    expect(formQuery("Matti Meikalainen")).toBeNull();
  });
});

describe("categoryByTradeWord", () => {
  it.each([
    ["Esimerkki Autokorjaamo Oy", "car"],
    ["Esimerkki Autohuolto", "car"],
    ["Esimerkki Katsastusasema Oy", "car"],
    ["Esimerkki Taksi Oy", "transport"],
    ["Esimerkki Hammasasema Oy", "health"],
    ["Esimerkki Optiikka Oy", "health"],
    ["Esimerkki Autoliike Oy", "vehicle_purchase"],
    ["Kahvila Esimerkki", "restaurants"],
    ["Esimerkin Hammaslaakari Oy", "health"],
    ["Esimerkin Autokorjaamo Oy", "car"],
    ["Esimerkki Frisor", "personal_care"],
  ] as const)("%s → %s", (name, category) => {
    expect(categoryByTradeWord(name)).toBe(category);
  });

  it("says nothing for a brand word, or a trade noun inside a word", () => {
    for (const name of ["Power Market Oy", "Esimerkki Center Oy", "Esimerkki Shop Oy", "Esimerkki Perävaunukorjaamo Oy", "Kello Korjaamo Oy", "Puhelin Korjaamo Oy", "Esimerkki Verkstad Ab"]) expect(categoryByTradeWord(name), name).toBeNull();
    // a broad code with such a name stays unfiled
    expect(matchCompany("Power Market", [company("1", ["Power Market Oy"], "46900")], { byName: categoryByTradeWord })).toMatchObject({ status: "found", category: null });
  });

  it("says nothing for a name with no trade word, a lease or a bank", () => {
    expect(categoryByTradeWord("Gilvaria Oy")).toBeNull();
    expect(categoryByTradeWord("Esimerkki Autoleasing Oy")).toBeNull();
    expect(categoryByTradeWord("Esimerkki Rahoitus Oy")).toBeNull();
    expect(categoryByTradeWord("Esimerkki Linja-auto Oy")).not.toBe("vehicle_purchase");
  });

  it("gives a register answer the industry's category first, the name's after", () => {
    expect(categoryForCompany({ code: "56300", codeSet: "TOL2025", companyName: "Esimerkki Autokorjaamo Oy" })).toBe("restaurants");
    expect(categoryForCompany({ code: "46900", codeSet: "TOL2008", companyName: "Esimerkki Autokorjaamo Oy" })).toBe("car");
    expect(categoryForCompany({ code: null, codeSet: null, companyName: "Esimerkki Autokorjaamo Oy" })).toBe("car");
    expect(categoryForCompany({ code: "46900", codeSet: "TOL2008", companyName: null })).toBeNull();
  });
});

const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
const card: Account = { id: "card", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };

describe("isBusinessRow", () => {
  const cards = new Set(["card"]);
  const iban = "FI4950009420028731";
  const row = (fields: { accountId?: string; counterparty?: string; counterpartyIban?: string; description?: string; mcc?: string }) =>
    tx({ accountId: "chk", bookingDate: "2026-09-01", amountCents: -1000, ...fields });

  it("does not take people's names for company forms", () => {
    expect(isBusinessRow(row({ counterparty: "AYŞE YILMAZ", counterpartyIban: iban }), cards)).toBe(false);
    expect(isBusinessRow(row({ counterparty: "SAŠA PETROVIĆ" }), cards)).toBe(false);
    expect(isBusinessRow(row({ counterparty: "KIM SE JIN", counterpartyIban: iban }), cards)).toBe(false);
  });

  it("finds company forms at either end of the name", () => {
    expect(isBusinessRow(row({ counterparty: "PUTKITYÖ LAHTINEN OY", counterpartyIban: iban }), cards)).toBe(true);
    expect(isBusinessRow(row({ counterparty: "OY KARL FAZER AB", counterpartyIban: iban }), cards)).toBe(true);
    expect(isBusinessRow(row({ counterparty: "TMI MATTI VIRTANEN" }), cards)).toBe(true);
  });

  it("counts card rows only without a payee account", () => {
    expect(isBusinessRow(row({ accountId: "card", counterparty: "KAHVILA ILO" }), cards)).toBe(true);
    expect(isBusinessRow(row({ counterparty: "KAHVILA ILO", mcc: "5814" }), cards)).toBe(true);
    expect(isBusinessRow(row({ accountId: "card", counterparty: "LIISA VIRTANEN", counterpartyIban: iban }), cards)).toBe(false);
    expect(isBusinessRow(row({ counterparty: "LIISA VIRTANEN", counterpartyIban: iban, mcc: "4829" }), cards)).toBe(false);
  });

  it("recognises card and e-invoice texts", () => {
    expect(isBusinessRow(row({ counterparty: "PIKKUPUOTI", description: "KORTTIOSTO 01.09" }), cards)).toBe(true);
    expect(isBusinessRow(row({ counterparty: "PIKKUPUOTI", description: "E-LASKU 4471", counterpartyIban: iban }), cards)).toBe(true);
    expect(isBusinessRow(row({ counterparty: "LIISA VIRTANEN", description: "SIIRTO", counterpartyIban: iban }), cards)).toBe(false);
  });
});

describe("industryCandidates", () => {
  it("lists uncategorised businesses by spending and never people", () => {
    const txs = [
      tx({ accountId: "card", bookingDate: "2026-09-01", amountCents: -1200, merchant: "Kukkakauppa Ilo", counterparty: "KUKKAKAUPPA ILO" }),
      tx({ accountId: "chk", bookingDate: "2026-09-02", amountCents: -9000, merchant: "Putkityö Lahtinen Oy", counterparty: "PUTKITYÖ LAHTINEN OY", counterpartyIban: "FI4950009420028730" }),
      // a person paid by account transfer: no company form in the name
      tx({ accountId: "chk", bookingDate: "2026-09-03", amountCents: -5000, merchant: "Liisa Virtanen", counterparty: "LIISA VIRTANEN", counterpartyIban: "FI4950009420028731" }),
      // already categorised
      tx({ accountId: "card", bookingDate: "2026-09-04", amountCents: -800, merchant: "K-Market", counterparty: "K-MARKET", category: "groceries", categorySource: "rule" }),
      // money in
      tx({ accountId: "chk", bookingDate: "2026-09-05", amountCents: 5000, merchant: "Acme", counterparty: "ACME OY" }),
    ];
    expect(industryCandidates(txs, [checking, card])).toEqual(["Putkityö Lahtinen Oy", "Kukkakauppa Ilo"]);
  });

  // an outgoing transfer that carries a payee account: the export delivers them
  const rent = (bookingDate: string) =>
    tx({ accountId: "chk", bookingDate, amountCents: -70000, merchant: "Vuokranantaja", counterparty: "VUOKRANANTAJA", counterpartyIban: "FI4950009420028732", category: "housing", categorySource: "rule" });
  // a CSV export names a card purchase by its title alone; a bank fetch says it was a card purchase
  const shop = (bookingDate: string, fields: Partial<Parameters<typeof tx>[0]> = {}) =>
    tx({ accountId: "chk", bookingDate, amountCents: -2900, merchant: "Lyhtypuoti", description: "LYHTYPUOTI", ...fields });
  const cardText = { description: "KORTTIOSTO LYHTYPUOTI" };

  it("takes a shop's rows without card text for purchases once one row shows a card purchase (CSV card purchases)", () => {
    expect(industryCandidates([rent("2026-09-02"), shop("2026-09-01"), shop("2026-09-15", cardText)], [checking])).toEqual(["Lyhtypuoti"]);
    // two payments without a payee account prove nothing by themselves: some banks deliver a transfer to a person so
    expect(industryCandidates([rent("2026-09-02"), shop("2026-09-01"), shop("2026-09-15")], [checking])).toEqual([]);
    // a MobilePay row is not counted, and the shop's card purchase says nothing about it
    const mobilepay = { counterparty: "LYHTYPUOTI", description: "MOBILEPAY" };
    expect(industryCandidates([rent("2026-09-02"), shop("2026-09-01", cardText), shop("2026-09-08", mobilepay)], [checking])).toEqual([]);
    expect(industryCandidates([rent("2026-09-02"), shop("2026-09-01", cardText), shop("2026-09-02"), shop("2026-09-08", mobilepay)], [checking])).toEqual([]);
    // a payee account means a transfer, and one transfer to the name rules it out
    expect(
      industryCandidates([shop("2026-09-01", cardText), shop("2026-09-08"), shop("2026-09-09", { counterpartyIban: "FI4950009420028731" })], [checking]),
    ).toEqual([]);
  });

  it("does not take them for purchases in an account that has no payee accounts at all", () => {
    // a CSV layout without IBANs: a missing payee account says nothing there
    const rows = [shop("2026-09-01", cardText), shop("2026-09-15")];
    expect(industryCandidates(rows, [checking])).toEqual([]);
    const shops = businessMerchants(rows);
    expect(shops.size).toBe(0);
    expect(isBusinessRow(rows[1]!, new Set(), shops)).toBe(false);
    // the same two rows count once another outgoing row of the account carries a payee account
    expect(industryCandidates([...rows, rent("2026-09-02")], [checking])).toEqual(["Lyhtypuoti"]);
  });

  it("counts payee accounts within one import source, so older rows without them prove nothing", () => {
    // a bank fetch gives payee accounts, the CSV imported before it never did
    const fetched = tx({ accountId: "chk", source: "enablebanking", bookingDate: "2026-10-02", amountCents: -70000, merchant: "Vuokranantaja", counterparty: "VUOKRANANTAJA", counterpartyIban: "FI4950009420028732" });
    const oldCsv = [shop("2026-09-01", { source: "csv", ...cardText }), shop("2026-09-15", { source: "csv" })];
    expect(industryCandidates([fetched, ...oldCsv], [checking])).toEqual([]);
    expect(businessMerchants([fetched, ...oldCsv]).size).toBe(0);
    // the same two payments in the fetched rows follow the fetch's own payee accounts
    expect(industryCandidates([fetched, shop("2026-10-03", { source: "enablebanking", ...cardText }), shop("2026-10-10", { source: "enablebanking" })], [checking])).toEqual(["Lyhtypuoti"]);
  });

  it("keeps the positive signs in an account without payee accounts", () => {
    const rows = [
      tx({ accountId: "chk", bookingDate: "2026-09-01", amountCents: -1200, merchant: "Kukkakauppa Ilo", counterparty: "KUKKAKAUPPA ILO", mcc: "5992" }),
      tx({ accountId: "chk", bookingDate: "2026-09-02", amountCents: -1300, merchant: "Pikkupuoti", description: "KORTTIOSTO 02.09" }),
      tx({ accountId: "chk", bookingDate: "2026-09-03", amountCents: -9000, merchant: "Putkityö Lahtinen Oy", counterparty: "PUTKITYÖ LAHTINEN OY" }),
      tx({ accountId: "card", bookingDate: "2026-09-04", amountCents: -800, merchant: "Lankapuoti Kulma", description: "LANKAPUOTI KULMA" }),
    ];
    expect(industryCandidates(rows, [checking, card]).sort()).toEqual(["Kukkakauppa Ilo", "Lankapuoti Kulma", "Pikkupuoti", "Putkityö Lahtinen Oy"]);
  });
});

describe("enrichTransactions with merchant memory and industries", () => {
  it("gives a merchant's unrecognised rows the category its card rows have", () => {
    const rows = [
      tx({ accountId: "card", bookingDate: "2026-09-01", amountCents: -1200, merchant: "Pikkupuoti", counterparty: "PIKKUPUOTI", mcc: "5411" }),
      tx({ accountId: "card", bookingDate: "2026-09-08", amountCents: -1500, merchant: "Pikkupuoti", counterparty: "PIKKUPUOTI" }),
    ];
    const changed = enrichTransactions(rows, [checking, card], []);
    expect(changed.map((t) => [t.category, t.categorySource])).toEqual([
      ["groceries", "mcc"],
      ["groceries", "merchant"],
    ]);
  });

  it("uses the register's category for spending only, and only on business rows", () => {
    const industries = new Map([["Pikku Ilona", "restaurants"]]);
    const rows = [
      tx({ accountId: "card", bookingDate: "2026-09-01", amountCents: -1200, merchant: "Pikku Ilona", counterparty: "PIKKU ILONA" }),
      // money in from the same name stays income
      tx({ accountId: "chk", bookingDate: "2026-09-20", amountCents: 3500, merchant: "Pikku Ilona", counterparty: "PIKKU ILONA" }),
      // a transfer to a person's account with the same name is not a purchase there
      tx({ accountId: "chk", bookingDate: "2026-09-03", amountCents: -500, merchant: "Pikku Ilona", counterparty: "PIKKU ILONA", counterpartyIban: "FI4950009420028731" }),
    ];
    const byId = new Map(enrichTransactions(rows, [checking, card], [], industries).map((t) => [t.id, t]));
    expect(byId.get(rows[0]!.id)).toMatchObject({ category: "restaurants", categorySource: "industry" });
    expect(byId.get(rows[1]!.id)).toMatchObject({ category: "income", categorySource: "default" });
    expect(byId.get(rows[2]!.id)?.categorySource ?? rows[2]!.categorySource).toBe("default");
  });

  it("a found register entry beats a stem of the lexicon, a stem with no entry keeps its category, and a company row of the lexicon beats the register", () => {
    const buy = (merchant: string) => tx({ accountId: "card", bookingDate: "2026-09-01", amountCents: -1200, merchant, counterparty: merchant.toUpperCase() });
    const rows = [buy("Gastropub Esimerkki"), buy("Gastropub Toinen"), buy("Rusta Esimerkki")];
    // the first has an entry that fits (stem GASTROPUB: restaurants), the second has none, the third is a company row (RUSTA: home)
    const industries = new Map([["Gastropub Esimerkki", "shopping"], ["Rusta Esimerkki", "restaurants"]]);
    const [entry, stemOnly, company] = enrichTransactions(rows, [checking, card], [], industries);
    expect(entry).toMatchObject({ category: "shopping", categorySource: "industry" });
    expect(stemOnly).toMatchObject({ category: "restaurants", categorySource: "industry" });
    expect(company).toMatchObject({ category: "home", categorySource: "rule" });
    // near miss: an entry that gives no category (income is no spending) leaves the stem's category
    expect(enrichTransactions([rows[0]!], [checking, card], [], new Map([["Gastropub Esimerkki", "income"]]))[0]).toMatchObject({ category: "restaurants", categorySource: "industry" });
  });

  it("asks the register about a row only a stem filed, and not about one a company row filed", () => {
    const row = (merchant: string, categorySource: "default" | "industry" | "rule") => ({ ...tx({ accountId: "card", bookingDate: "2026-09-01", amountCents: -1200, merchant, counterparty: merchant.toUpperCase() }), categorySource });
    expect(industryCandidates([row("Gastropub Esimerkki Oy", "industry"), row("Kahvila Vanha Oy", "default"), row("Rusta Esimerkki Oy", "rule")], [checking, card])).toEqual(["Gastropub Esimerkki Oy", "Kahvila Vanha Oy"]);
  });

  it("files the rows of each monthly run of equal sums under Autoleasing, and every other row of the company under travel", () => {
    const industries = new Map([["Ilmari Wheels", CAR_HIRE]]);
    const row = (date: string, cents: number) => tx({ accountId: "card", bookingDate: date, amountCents: cents, merchant: "Ilmari Wheels", counterparty: "ILMARI WHEELS" });
    const months = (cents: number, from: number, count: number) => Array.from({ length: count }, (_, i) => row(`2026-${String(from + i).padStart(2, "0")}-05`, cents));
    const filed = (rows: ReturnType<typeof tx>[]) => new Map(enrichTransactions(rows, [checking, card], [], industries).map((t) => [t.id, t.category]));
    // two cars, 400 and 600 a month: both are leases, and they stay so when a month comes in
    const carA = months(-40000, 1, 6);
    const carB = months(-60000, 1, 6);
    const both = filed([...carA, ...carB]);
    expect([...carA, ...carB].map((t) => both.get(t.id))).toEqual(Array(12).fill("leasing"));
    const more = months(-40000, 7, 1);
    const grown = filed([...carA, ...carB, ...more]);
    expect([...carA, ...carB, ...more].map((t) => grown.get(t.id))).toEqual(Array(13).fill("leasing"));
    // three holiday rentals of one sum, in months that do not follow each other: rentals
    const holidays = [row("2026-02-10", -15000), row("2026-05-10", -15500), row("2026-09-10", -14800)];
    const rented = filed(holidays);
    expect(holidays.map((t) => rented.get(t.id))).toEqual(Array(3).fill("travel"));
    // a one-off rental from a company that is leased from too
    const oneOff = row("2026-04-20", -90000);
    const mixed = filed([...months(-45900, 1, 6), oneOff]);
    expect(mixed.get(oneOff.id)).toBe("travel");
  });

  it("files a car rental and leasing company's steady payment under Autoleasing and any other under travel", () => {
    const industries = new Map([["Ilmari Wheels", CAR_HIRE]]);
    const month = (m: number, cents: number) => tx({ accountId: "card", bookingDate: `2026-0${m}-05`, amountCents: cents, merchant: "Ilmari Wheels", counterparty: "ILMARI WHEELS" });
    const filed = (rows: ReturnType<typeof tx>[]) => enrichTransactions(rows, [checking, card], [], industries).map((t) => [t.category, t.categorySource]);
    // about the same sum in three months: a lease
    expect(filed([month(1, -45900), month(2, -45900), month(3, -45900)])).toEqual(Array(3).fill(["leasing", "industry"]));
    // two months only, or sums that wander: a rental
    expect(filed([month(1, -45900), month(2, -45900)])).toEqual(Array(2).fill(["travel", "industry"]));
    expect(filed([month(1, -45900), month(2, -12000), month(3, -80000)])).toEqual(Array(3).fill(["travel", "industry"]));
    // a refund follows its purchase, it is not the register's to file
    const refund = tx({ accountId: "card", bookingDate: "2026-03-20", amountCents: 3000, merchant: "Ilmari Wheels", counterparty: "ILMARI WHEELS" });
    expect(filed([month(1, -45900), month(2, -45900), month(3, -45900), refund]).slice(3)).toEqual([["leasing", "match"]]);
  });

  it("applies the register's category to a shop's CSV card purchases once a row shows a card purchase", () => {
    const industries = new Map([["Ruskea Lyhty", "restaurants"]]);
    // a CSV export names a card purchase by its title alone
    const bare = (bookingDate: string) => tx({ accountId: "chk", bookingDate, amountCents: -2900, merchant: "Ruskea Lyhty", description: "RUSKEA LYHTY" });
    const withCardText = tx({ accountId: "chk", bookingDate: "2026-09-29", amountCents: -3100, merchant: "Ruskea Lyhty", description: "KORTTIOSTO RUSKEA LYHTY" });
    // the export carries payee accounts on transfers
    const rent = tx({ accountId: "chk", bookingDate: "2026-09-02", amountCents: -70000, merchant: "Vuokranantaja", counterparty: "VUOKRANANTAJA", counterpartyIban: "FI4950009420028732" });
    const lyhty = (changed: ReturnType<typeof enrichTransactions>) => changed.filter((t) => t.merchant === "Ruskea Lyhty").map((t) => [t.category, t.categorySource]);
    expect(lyhty(enrichTransactions([bare("2026-09-01"), withCardText, rent], [checking], [], industries))).toEqual([
      ["restaurants", "industry"],
      ["restaurants", "industry"],
    ]);
    // two payments without a payee account and no other sign: a transfer to a person can look so
    expect(lyhty(enrichTransactions([bare("2026-09-01"), bare("2026-09-29"), rent], [checking], [], industries))).toEqual([]);
    // a single row without any business sign stays uncategorised
    expect(lyhty(enrichTransactions([bare("2026-09-01"), rent], [checking], [], industries))).toEqual([]);
    // in an export without payee accounts only the row with its own sign is a purchase
    expect(lyhty(enrichTransactions([bare("2026-09-01"), withCardText], [checking], [], industries))).toEqual([["restaurants", "industry"]]);
  });

  it("does not learn a merchant's category from payments to people, card bills, cash or fees", () => {
    for (const [description, counterparty] of [
      ["MOBILEPAY", "LOHIAUTO JOKINEN"],
      ["KORTTILASKU", "LOHIAUTO JOKINEN"],
      ["KÄTEISNOSTO", "LOHIAUTO JOKINEN"],
      ["PALVELUMAKSU", "LOHIAUTO JOKINEN"],
    ]) {
      const rows = [
        tx({ accountId: "chk", bookingDate: "2026-07-01", amountCents: -1400, merchant: "Lohiauto Jokinen", counterparty, description }),
        tx({ accountId: "chk", bookingDate: "2026-07-25", amountCents: -1800, merchant: "Lohiauto Jokinen", description: "LOHIAUTO JOKINEN" }),
      ];
      const byId = new Map(enrichTransactions(rows, [checking], []).map((t) => [t.id, t]));
      expect(byId.get(rows[1]!.id)?.categorySource ?? rows[1]!.categorySource).toBe("default");
    }
  });

  it("applies a debt category from the register too", () => {
    const rows = [
      tx({ accountId: "chk", bookingDate: "2026-09-01", amountCents: -5000, merchant: "Saatavat Nord", counterparty: "SAATAVAT NORD OY", counterpartyIban: "FI4950009420028730" }),
    ];
    const changed = enrichTransactions(rows, [checking], [], new Map([["Saatavat Nord", "collection"]]));
    expect(changed[0]).toMatchObject({ category: "collection", categorySource: "industry" });
  });

  it("keeps own transfers neutral even when the name is in the register", () => {
    const savings: Account = { id: "sav", name: "Säästötili", iban: "FI1410093000123458", currency: "EUR", type: "savings" };
    const rows = [
      tx({ accountId: "chk", bookingDate: "2026-09-01", amountCents: -10000, merchant: "Testikauppa Oy", counterparty: "TESTIKAUPPA OY", counterpartyIban: "FI1410093000123458" }),
      tx({ accountId: "sav", bookingDate: "2026-09-01", amountCents: 10000, merchant: "Testikauppa Oy", counterparty: "TESTIKAUPPA OY" }),
    ];
    const changed = enrichTransactions(rows, [checking, savings], [], new Map([["Testikauppa Oy", "home"]]));
    expect(changed.every((t) => t.category === "transfer")).toBe(true);
  });
});
