import { describe, expect, it } from "vitest";
import { businessMerchants, categoryForIndustry, companyKey, industryCandidates, isBusinessRow, matchCompany, type RegistryCompany, shorterQuery } from "../src/industry.ts";
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
    ["47810", "TOL2025", "car"], // car dealers in 2025
    ["45110", "TOL2008", "car"],
    ["95310", "TOL2025", "car"],
    ["96021", "TOL2008", "personal_care"],
    ["96210", "TOL2025", "personal_care"],
    ["68202", "TOL2008", "housing"],
    ["88910", "TOL2025", "kids"],
    ["94200", "TOL2025", "memberships"],
    ["61100", "TOL2025", "telecom"],
    ["35140", "TOL2008", "utilities"],
  ] as const)("%s (%s) → %s", (code, set, category) => {
    expect(categoryForIndustry(code, set)).toBe(category);
  });

  it("says nothing for broad industries and bad codes", () => {
    expect(categoryForIndustry("46389", "TOL2025")).toBeNull(); // food wholesale
    expect(categoryForIndustry("64190", "TOL2008")).toBeNull(); // banks
    expect(categoryForIndustry("70100", "TOL2025")).toBeNull(); // head offices
    expect(categoryForIndustry("abc", "TOL2025")).toBeNull();
  });
});

const company = (businessId: string, names: string[], code: string | null, codeSet: "TOL2008" | "TOL2025" = "TOL2025"): RegistryCompany => ({
  businessId,
  names,
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
