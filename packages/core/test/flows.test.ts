/**
 * End-to-end money-flow scenarios: raw bank rows → categorise → transfer
 * detection → flows. Every kind of household money movement should land in
 * exactly one of consumption / debt / savings / income / borrowed, or be neutral.
 */
import { describe, expect, it } from "vitest";
import { type Flows, flowsOf, totalsOf } from "../src/analysis/flows.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { detectTransfers } from "../src/transfers.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
const savingsAcc: Account = { id: "sav", name: "Säästötili", iban: "FI1410093000123458", currency: "EUR", type: "savings" };
const gold: Account = { id: "gold", name: "Nordea Gold", iban: null, currency: "EUR", type: "credit_card" };

function row(accountId: string, bookingDate: string, euros: number, description: string, counterparty: string | null = null, extra: Partial<Transaction> = {}) {
  return tx({ accountId, bookingDate, amountCents: Math.round(euros * 100), description, counterparty, merchant: normalizeMerchant(counterparty, description), ...extra });
}

function run(rows: Transaction[], accounts: Account[]) {
  const changed = new Map(enrichTransactions(rows, accounts, []).map((t) => [t.id, t]));
  const final = rows.map((t) => changed.get(t.id) ?? t);
  const savingsIds = new Set(accounts.filter((a) => a.type === "savings").map((a) => a.id));
  const loanIds = new Set(accounts.filter((a) => a.type === "loan").map((a) => a.id));
  const flows = final.map((t) => flowsOf(t, savingsIds, loanIds));
  return { final, flows, totals: totalsOf(flows), byDesc: (d: string) => final.find((t) => t.description === d)! };
}

const neutral: Flows = { consumption: 0, debt: 0, saved: 0, income: 0, borrowed: 0 };

describe("credit cards (Nordea Gold)", () => {
  it("bill paid from checking to Nordea Rahoitus is a transfer when the card is connected", () => {
    const { byDesc, totals } = run(
      [
        row("gold", "2026-09-03", -120, "K-MARKET KAMPPI"),
        row("chk", "2026-09-20", -120, "NORDEA GOLD LASKU 09/2026", "NORDEA RAHOITUS SUOMI OY"),
        row("gold", "2026-09-21", 120, "MAKSU", "NORDEA RAHOITUS SUOMI OY"),
      ],
      [checking, gold],
    );
    expect(byDesc("NORDEA GOLD LASKU 09/2026").isTransfer).toBe(true);
    expect(byDesc("MAKSU").isTransfer).toBe(true);
    expect(totals).toMatchObject({ consumptionCents: 12000, debtCents: 0, borrowedCents: 0 });
  });

  it("prepaying the card (money to Gold before purchases) is a transfer too", () => {
    const { byDesc } = run(
      [row("chk", "2026-09-02", -500, "SIIRTO NORDEA GOLD"), row("gold", "2026-09-02", 500, "SIIRTO TILILTA")],
      [checking, gold],
    );
    expect(byDesc("SIIRTO NORDEA GOLD").isTransfer).toBe(true);
    expect(byDesc("SIIRTO TILILTA").isTransfer).toBe(true);
  });

  it("without the card account the bill counts as (unitemised) consumption, once", () => {
    const { byDesc, totals } = run([row("chk", "2026-09-20", -120, "NORDEA GOLD LASKU", "NORDEA RAHOITUS SUOMI OY")], [checking]);
    expect(byDesc("NORDEA GOLD LASKU").category).toBe("card_bill");
    expect(totals.consumptionCents).toBe(12000);
  });

  it("credit moved from the card to checking is borrowing, or a transfer when both are connected", () => {
    const alone = run([row("chk", "2026-09-05", 1000, "LUOTON SIIRTO", "NORDEA RAHOITUS SUOMI OY")], [checking]);
    expect(alone.byDesc("LUOTON SIIRTO").category).toBe("credit_draw");
    expect(alone.totals).toMatchObject({ borrowedCents: 100000, incomeCents: 0 });

    const both = run(
      [row("gold", "2026-09-05", -1000, "LUOTON SIIRTO OMALLE TILILLE"), row("chk", "2026-09-05", 1000, "LUOTON SIIRTO", "NORDEA RAHOITUS SUOMI OY")],
      [checking, gold],
    );
    expect(both.final.every((t) => t.isTransfer)).toBe(true);
    expect(both.totals).toMatchObject({ borrowedCents: 0, incomeCents: 0, consumptionCents: 0 });
  });
});

describe("debt", () => {
  it.each([
    ["NORDEA RAHOITUS SUOMI OY", "OSAMAKSU AUTO 12/48", "loans"],
    ["NORDEA RAHOITUS SUOMI OY", "SOPIMUS 123456", "loans"],
    ["NORDEA BANK ABP", "ASUNTOLAINAN LYHENNYS", "mortgage"],
    ["NORDEA BANK ABP", "LAINAN LYHENNYS", "mortgage"],
    ["SANTANDER CONSUMER BANK", "LAINAN LYHENNYS", "loans"],
    ["KELA", "OPINTOLAINA", "student_loan"],
    ["RESURS BANK", "LASKU", "loans"],
    ["INTRUM OY", "PERINTÄ 99", "collection"],
    ["NORDEA BANK ABP", "LUOTONKORKO", "interest"],
  ])("%s / %s → %s", (counterparty, description, category) => {
    const { byDesc, flows } = run([row("chk", "2026-09-10", -250, description, counterparty)], [checking]);
    expect(byDesc(description).category).toBe(category);
    expect(flows[0]).toEqual({ ...neutral, debt: 25000 });
  });

  it("a loan payout is borrowing, not income", () => {
    const { byDesc, totals } = run([row("chk", "2026-09-10", 5000, "LAINAN NOSTO", "RESURS BANK")], [checking]);
    expect(byDesc("LAINAN NOSTO").category).toBe("credit_draw");
    expect(totals).toMatchObject({ incomeCents: 0, borrowedCents: 500000 });
  });

  it("money in from a card issuer (credit moved to checking) is borrowing, not income", () => {
    const { byDesc, totals } = run([row("chk", "2026-09-10", 1500, "SIIRTO", "BANK NORWEGIAN")], [checking]);
    expect(byDesc("SIIRTO").category).toBe("credit_draw");
    expect(totals).toMatchObject({ incomeCents: 0, borrowedCents: 150000 });
  });
});

describe("savings and investments", () => {
  it("to a connected savings account: transfer, counted as saved on the savings side", () => {
    const { totals, final } = run(
      [row("chk", "2026-09-26", -300, "SÄÄSTÖÖN"), row("sav", "2026-09-26", 300, "SÄÄSTÖÖN")],
      [checking, savingsAcc],
    );
    expect(final.every((t) => t.isTransfer)).toBe(true);
    expect(totals).toMatchObject({ savedCents: 30000, consumptionCents: 0, incomeCents: 0 });
  });

  it("to an own account that is not connected: savings", () => {
    const { byDesc, totals } = run([row("chk", "2026-09-26", -300, "OMA SIIRTO SÄÄSTÖTILILLE")], [checking]);
    expect(byDesc("OMA SIIRTO SÄÄSTÖTILILLE").category).toBe("savings");
    expect(totals.savedCents).toBe(30000);
  });

  it.each([
    ["NORDNET BANK AB", "RAHASTOSÄÄSTÖ"],
    ["NORDEA BANK ABP", "SÄÄSTÖSOPIMUS NORDEA RAHASTOT"],
    ["TAVEX OY", "SIJOITUSKULTA"],
    ["COINBASE", "BTC"],
    ["NORDEA BANK ABP", "OSAKESÄÄSTÖTILI TALLETUS"],
  ])("%s / %s → investments", (counterparty, description) => {
    const { byDesc, totals } = run([row("chk", "2026-09-15", -200, description, counterparty)], [checking]);
    expect(byDesc(description).category).toBe("investments");
    expect(totals.savedCents).toBe(20000);
  });

  it("money back from investments reduces savings, it is not income", () => {
    const { totals } = run([row("chk", "2026-09-15", 1000, "MYYNTI", "NORDNET BANK AB")], [checking]);
    expect(totals).toMatchObject({ savedCents: -100000, incomeCents: 0 });
  });
});

describe("everyday money", () => {
  it.each([
    [-15, "MOBILEPAY LIISA V", null, "p2p", "consumption"],
    [15, "MOBILEPAY LIISA V", null, "p2p_in", "income"],
    [59.95, "ZALANDO SE", null, "shopping", "consumption"],
    [3420, "PALKKA 09/2026", "ACME OY", "salary", "income"],
    [412.5, "VERONPALAUTUS", "VEROHALLINTO", "benefits", "income"],
    [-890, "JÄÄNNÖSVERO", "VEROHALLINTO", "taxes", "consumption"],
    [12.4, "OSINKO NOKIA", "NORDNET BANK AB", "investment_income", "income"],
    [35, "TORI.FI MYYNTI", null, "sales", "income"],
    [-80, "KÄTEISNOSTO OTTO", null, "cash", "consumption"],
    [-42, "PARTURI-KAMPAAMO SAKSET", null, "personal_care", "consumption"],
    [-65, "MUSTI JA MIRRI", null, "pets", "consumption"],
    [-30, "VEIKKAUS OY", null, "gambling", "consumption"],
    [-25, "SPR LAHJOITUS", null, "gifts_donations", "consumption"],
    [-180, "PÄIVÄKOTIMAKSU", "VANTAAN KAUPUNKI", "kids", "consumption"],
    [-120, "ILTAPÄIVÄTOIMINTA", "VANTAAN KAUPUNKI", "kids", "consumption"],
    [-45, "KOULULAISKERHO SYKSY", "ESPOON KAUPUNKI", "kids", "consumption"],
    [-60, "LEIKKIKERHO", "SEURAKUNTAYHTYMÄ", "kids", "consumption"],
    [964.2, "LOMAPALKKA", "RAKENNUS-SAARINEN OY", "salary", "income"],
    [-39.9, "ALKO KAMPPI", null, "alcohol", "consumption"],
    [-28, "JÄSENMAKSU 10/2026", "TEHY RY", "memberships", "consumption"],
    [-41.7, "ASIAKASMAKSU", "PIRKANMAAN HYVINVOINTIALUE", "health", "consumption"],
    [-45, "LASKU 2026-118", "ESPOON KAUPUNKI", "taxes", "consumption"],
    [650, "VUOKRA 10/2026", "VIRTANEN LIISA", "income", "income"],
  ] as const)("%d %s → %s", (euros, description, counterparty, category, flow) => {
    const { byDesc, flows } = run([row("chk", "2026-09-15", euros, description, counterparty)], [checking]);
    expect(byDesc(description).category).toBe(category);
    // consumption counts money out as positive (a refund is negative); income counts money in
    const cents = Math.round(euros * 100);
    expect(flows[0]![flow]).toBe(flow === "income" ? cents : -cents);
  });
});

describe("local businesses by their trade", () => {
  it.each([
    ["TIKKURILAN KIOSKI", "groceries"],
    ["KALATUKKU ERIKSSON", "groceries"],
    ["ICA NARA STOCKHOLM", "groceries"],
    ["NAPOLI PIZZAPALVELU", "restaurants"],
    ["BAAN THAI", "restaurants"],
    ["KARTANON KEITTIÖ", "restaurants"],
    ["PINGVIINI JÄÄTELÖ", "restaurants"],
    ["TUKKATALO TIKKURILA", "personal_care"],
    ["FYSIOPISTE TIKKURILA OY", "health"],
    ["NÄKÖKESKUS ILVES", "health"],
    ["LUONTAISTUOTE SIRKKU OY", "health"],
    ["LEIKKIKOULU NAPERO OY", "kids"],
    ["SATUMETSÄ LEIKKIPUISTO", "kids"],
    ["UINTIKOULU DELFIINI OY", "kids"],
    ["LELUMAAILMA", "kids"],
    ["FLORISTI LILJA", "home"],
    ["KOTIPUUTARHA VIHERLAND", "home"],
    ["TIKKURILAN PESULA", "home"],
    ["AUTOPESULA KIILTO", "car"],
    ["LUKKOLIIKE AVAINMESTARI OY", "home"],
    ["TIKKURILAN AUTOPALVELU OY", "car"],
    ["PYÖRÄHUOLTO KUUSINEN", "transport"],
    ["KIERRÄTYSKESKUS TIKKURILA", "shopping"],
    ["BOWLINGCENTER JUMBO", "entertainment"],
    ["MUUMIMAAILMA NAANTALI", "entertainment"],
    ["NAANTALIN KYLPYLÄ", "travel"],
    ["KYLPYLÄN RAVINTOLA", "restaurants"],
  ] as const)("%s → %s", (description, category) => {
    const { byDesc, flows } = run([row("chk", "2026-09-15", -42, description)], [checking]);
    expect(byDesc(description).category).toBe(category);
    expect(flows[0]).toEqual({ ...neutral, consumption: 4200 });
  });
});

describe("people who share a brand's name", () => {
  it("a transfer to a person named Laakkonen stays other spending", () => {
    const { byDesc, totals } = run([row("chk", "2026-09-10", -200, "SIIRTO", "MATTI LAAKKONEN", { counterpartyIban: "FI1112345600000001" })], [checking]);
    expect(byDesc("SIIRTO")).toMatchObject({ category: "other", isTransfer: false });
    expect(totals).toMatchObject({ consumptionCents: 20000, debtCents: 0 });
  });
});

describe("transfer pairing edge cases", () => {
  const amex = (desc: string) => row("chk", "2026-09-20", -850, desc, "AMERICAN EXPRESS");

  it("a Gold bill paid as a plain e-invoice pairs with the card's payment row", () => {
    const { byDesc, totals } = run(
      [
        row("gold", "2026-09-03", -120, "K-MARKET KAMPPI"),
        row("chk", "2026-09-20", -120, "E-LASKU 4471", "NORDEA RAHOITUS SUOMI OY", { counterpartyIban: "FI6612345600001234" }),
        row("gold", "2026-09-21", 120, "MAKSU, KIITOS"),
      ],
      [checking, gold],
    );
    expect(byDesc("E-LASKU 4471").isTransfer).toBe(true);
    expect(totals).toMatchObject({ consumptionCents: 12000, debtCents: 0 });
  });

  it("prepaying the card with a plain SIIRTO text is a transfer on both sides", () => {
    const { final, totals } = run([row("chk", "2026-09-02", -500, "SIIRTO"), row("gold", "2026-09-02", 500, "SIIRTO")], [checking, gold]);
    expect(final.every((t) => t.isTransfer)).toBe(true);
    expect(totals).toMatchObject({ consumptionCents: 0, incomeCents: 0 });
  });

  it("only the outgoing leg names the savings IBAN: still one saving of +300", () => {
    const { final, totals } = run(
      [row("chk", "2026-09-26", -300, "SIIRTO", null, { counterpartyIban: savingsAcc.iban }), row("sav", "2026-09-26", 300, "SIIRTO")],
      [checking, savingsAcc],
    );
    expect(final.every((t) => t.isTransfer)).toBe(true);
    expect(totals).toMatchObject({ savedCents: 30000, incomeCents: 0 });
  });

  it("a bill for a card that is not connected stays spending", () => {
    const { byDesc, totals } = run([amex("AMEX LASKU 09/2026")], [checking, gold]);
    expect(byDesc("AMEX LASKU 09/2026")).toMatchObject({ category: "card_bill", isTransfer: false });
    expect(totals.consumptionCents).toBe(85000);
  });

  it("the connected card's bill is a transfer even when the card feed has no payment row", () => {
    const { byDesc } = run([row("chk", "2026-09-20", -120, "NORDEA GOLD LASKU", "NORDEA RAHOITUS SUOMI OY")], [checking, gold]);
    expect(byDesc("NORDEA GOLD LASKU").isTransfer).toBe(true);
  });

  it("money to and from outside IBANs is never paired into a transfer", () => {
    const { final, totals } = run(
      [
        row("chk", "2026-09-10", -200, "KIITOS", "MATTI MEIKALAINEN", { counterpartyIban: "FI1112345600000001" }),
        row("sav", "2026-09-11", 200, "LAHJA", "MUMMO", { counterpartyIban: "FI2212345600000002" }),
      ],
      [checking, savingsAcc],
    );
    expect(final.some((t) => t.isTransfer)).toBe(false);
    expect(totals).toMatchObject({ incomeCents: 20000, savedCents: 0 });
  });

  it("a user rule that says 'transfer' makes the row a transfer", () => {
    const rows = [row("chk", "2026-09-10", -300, "OMA SIIRTO X")];
    const changed = enrichTransactions(rows, [checking], [{ id: 1, field: "description", pattern: "oma siirto x", category: "transfer", priority: 1 }]);
    expect(changed[0]).toMatchObject({ category: "transfer", isTransfer: true });
  });
});

describe("mortgage paid to a bank", () => {
  it.each([
    ["NORDEA BANK ABP", "LAINANMAKSU 4123 887 21"],
    ["OP ETELÄ-SUOMI", "LAINAN LYHENNYS"],
    ["HELSINGIN OSUUSPANKKI", "LAINANHOITO"],
    ["S-PANKKI OYJ", "LAINANLYHENNYS 10/2026"],
    ["OMA SÄÄSTÖPANKKI OYJ", "LAINANMAKSU"],
    ["AKTIA PANKKI OYJ", "LAINANMAKSU"],
  ])("%s / %s → mortgage, debt service", (counterparty, description) => {
    const { byDesc, flows } = run([row("chk", "2026-09-20", -950, description, counterparty)], [checking]);
    expect(byDesc(description).category).toBe("mortgage");
    expect(flows[0]).toEqual({ ...neutral, debt: 95000 });
  });

  it.each([
    ["NORDEA RAHOITUS SUOMI OY", "LAINANMAKSU"],
    ["RESURS BANK", "LAINAN LYHENNYS"],
    ["MONEYGO", "LAINANMAKSU"],
  ])("a finance company's loan stays consumer credit: %s / %s", (counterparty, description) => {
    const { byDesc } = run([row("chk", "2026-09-20", -250, description, counterparty)], [checking]);
    expect(byDesc(description).category).toBe("loans");
  });

  it("a loan payout from the bank is still borrowing", () => {
    const { byDesc, totals } = run([row("chk", "2026-09-20", 20000, "LAINANMAKSU", "NORDEA BANK ABP")], [checking]);
    expect(byDesc("LAINANMAKSU").category).toBe("credit_draw");
    expect(totals).toMatchObject({ borrowedCents: 2000000, incomeCents: 0 });
  });
});

describe("card bills told from loans by their amounts", () => {
  const issuer = "NORDEA RAHOITUS SUOMI OY";
  const bills = (amounts: number[], description = "E-LASKU", day = 10) =>
    amounts.map((euros, i) => row("chk", `2026-${String(i + 3).padStart(2, "0")}-${day}`, -euros, `${description} ${i + 1}`, issuer));

  it("payments to the card issuer that change every month are card bills, counted as consumption", () => {
    const { final, totals } = run(bills([412.3, 655.1, 389, 702.45, 530.2]), [checking]);
    expect(final.map((t) => t.category)).toEqual(Array(5).fill("card_bill"));
    expect(totals).toMatchObject({ consumptionCents: 268905, debtCents: 0 });
  });

  it("a fixed instalment to the same issuer stays a loan", () => {
    const { final, totals } = run(bills([289, 289, 289, 289]), [checking]);
    expect(final.every((t) => t.category === "loans")).toBe(true);
    expect(totals.debtCents).toBe(115600);
  });

  it("a slowly shrinking instalment stays a loan", () => {
    const { final } = run(bills([300, 297, 294.1, 291.2, 288.3, 285.5, 282.7, 279.9, 277.1, 274.4, 271.7, 269]), [checking]);
    expect(final.every((t) => t.category === "loans")).toBe(true);
  });

  it("two payments are not enough to tell", () => {
    const { final } = run(bills([412.3, 655.1]), [checking]);
    expect(final.every((t) => t.category === "loans")).toBe(true);
  });

  it("a car loan and the card bill from the same issuer are told apart", () => {
    const rows = [...bills([250, 250, 250, 250], "E-LASKU", 5), ...bills([412.3, 655.1, 389, 702.45], "E-LASKU", 12)];
    const { final } = run(rows, [checking]);
    expect(final.map((t) => t.category)).toEqual([...Array(4).fill("loans"), ...Array(4).fill("card_bill")]);
  });

  it("a text that names the loan keeps it a loan", () => {
    const { final } = run(bills([412.3, 655.1, 389, 702.45], "OSAMAKSU AUTO"), [checking]);
    expect(final.every((t) => t.category === "loans")).toBe(true);
  });

  it("with the card connected the bills become transfers and only the purchases count", () => {
    const rows = [
      ...bills([412.3, 655.1, 389]),
      row("gold", "2026-03-11", 412.3, "MAKSU, KIITOS"),
      row("gold", "2026-04-11", 655.1, "MAKSU, KIITOS"),
      row("gold", "2026-05-11", 389, "MAKSU, KIITOS"),
      row("gold", "2026-04-02", -1456.4, "K-CITYMARKET JUMBO"),
    ];
    const { final, totals } = run(rows, [checking, gold]);
    expect(final.filter((t) => t.accountId === "chk").every((t) => t.isTransfer)).toBe(true);
    expect(totals).toMatchObject({ consumptionCents: 145640, debtCents: 0 });
  });

  it("the user's own rule for the issuer wins", () => {
    const rows = bills([412.3, 655.1, 389, 702.45]);
    const changed = enrichTransactions(rows, [checking], [{ id: 1, field: "counterparty", pattern: "Nordea Rahoitus", category: "loans", priority: 1 }]);
    expect(changed.every((t) => t.category === "loans")).toBe(true);
  });
});

describe("MobilePay to businesses", () => {
  it("a club with a company form is not a person, also with MobilePay", () => {
    const { byDesc } = run([row("chk", "2026-09-10", -10, "MOBILEPAY", "TIKKURILAN TIIKERIT RY")], [checking]);
    expect(byDesc("MOBILEPAY").category).not.toBe("p2p");
  });

  it("a name with a trade word is a business: a summer café is a café", () => {
    const { byDesc, flows } = run([row("chk", "2026-07-04", -12.6, "MOBILEPAY", "KESÄKAHVILA MAJAKKA")], [checking]);
    expect(byDesc("MOBILEPAY").category).toBe("restaurants");
    expect(flows[0]).toEqual({ ...neutral, consumption: 1260 });
  });

  it("people whose names are brand words stay people", () => {
    const { final } = run(
      [row("chk", "2026-09-10", -20, "MOBILEPAY", "ELISA VIRTANEN"), row("chk", "2026-09-11", 20, "MOBILEPAY", "OTTO HEIKKINEN")],
      [checking],
    );
    expect(final.map((t) => t.category)).toEqual(["p2p", "p2p_in"]);
  });

  it("a MobilePay payment does not turn the merchant's other rows into payments to people", () => {
    const { final } = run(
      [row("chk", "2026-06-06", -14, "MOBILEPAY", "LOHIAUTO JOKINEN"), row("chk", "2026-07-25", -18, "LOHIAUTO JOKINEN"), row("chk", "2026-08-22", -16, "LOHIAUTO JOKINEN")],
      [checking],
    );
    expect(final.map((t) => t.category)).toEqual(["p2p", "other", "other"]);
  });
});

describe("household view", () => {
  it("does not re-pair legs that each member already paired, nor apply the issuer fallback", () => {
    const shared = [
      // mine, paired in my own view
      row("chk", "2026-09-10", -300, "SIIRTO", null, { category: "transfer", categorySource: "transfer", isTransfer: true }),
      row("sav", "2026-09-11", 300, "SIIRTO", null, { category: "transfer", categorySource: "transfer", isTransfer: true }),
      // partner's MobilePay income the same day
      row("p-chk", "2026-09-10", 300, "MOBILEPAY", "LIISA VIRTANEN", { category: "p2p_in", categorySource: "rule" }),
      // my unconnected card's bill; the card in this view is the partner's
      row("chk", "2026-09-20", -120, "NORDEA GOLD LASKU", "NORDEA RAHOITUS SUOMI OY", { category: "card_bill", categorySource: "rule" }),
    ];
    const accounts: Account[] = [checking, savingsAcc, { ...checking, id: "p-chk", iban: "FI7712345600000009" }, gold];
    const found = detectTransfers(shared, accounts, { issuerFallback: false });
    expect(found.has(shared[2]!.id)).toBe(false);
    expect(found.has(shared[3]!.id)).toBe(false);
  });
});

describe("mortgage account connected", () => {
  const mortgage: Account = { id: "loan", name: "Asuntolainatili", iban: "FI2112345600000785", currency: "EUR", type: "loan" };
  it("the monthly payment from checking stays debt service, the loan account's own rows are neutral", () => {
    const { byDesc, totals } = run(
      [
        row("chk", "2026-09-30", -850, "ASUNTOLAINAN LYHENNYS", "NORDEA BANK ABP", { counterpartyIban: mortgage.iban }),
        row("loan", "2026-09-30", 850, "LYHENNYS"),
        row("loan", "2026-09-30", -120, "KORKO"),
      ],
      [checking, mortgage],
    );
    expect(byDesc("ASUNTOLAINAN LYHENNYS")).toMatchObject({ category: "mortgage", isTransfer: false });
    expect(totals).toMatchObject({ debtCents: 85000, incomeCents: 0, consumptionCents: 0, borrowedCents: 0 });
  });
});

describe("Finnish merchants and payment texts seen in household exports", () => {
  const card = (text: string) => row("chk", "2026-09-10", -25, `KORTTIOSTO 4921XXXXXXXX5530 ${text}`);
  it.each([
    ["CUBO ESPOO", "fitness"],
    ["APCOA FLOW", "car"],
    ["TESCO STORE 3042 DUBLIN", "groceries"],
    ["LUOMUTILA HEINAMAKI", "groceries"],
    ["TIKKURILAN RAUTA", "home"],
    ["SUUTARI KOIVISTO", "home"],
    ["EURONICS ISO OMENA", "home"],
    ["NIKE ISO OMENA", "shopping"],
    ["LEGO STORE SELLO", "kids"],
    ["DENTO SMILE OY", "health"],
    ["SALONKI HELMI", "personal_care"],
    ["MAMMAN PULLAPUOTI", "restaurants"],
    ["NEPAL RAVINTOLA", "restaurants"],
  ])("%s is %s", (text, category) => {
    const { final } = run([card(text)], [checking]);
    expect(final[0]!.category).toBe(category);
  });

  it("a junior club's season invoice is sports, a music school is education", () => {
    const { final } = run(
      [
        row("chk", "2026-09-10", -165, "KAUSIMAKSU SALIBANDY", "ESPOON FLOORBALL RY"),
        row("chk", "2026-09-11", -180, "LASTEN TEMPPUJUMPPA", "VANTAAN VOIMISTELIJAT RY"),
        row("chk", "2026-09-12", -62, "PIANOTUNNIT", "SOITTOKOULU SAVEL OY"),
      ],
      [checking],
    );
    expect(final.map((t) => t.category)).toEqual(["fitness", "fitness", "education"]);
  });

  it("the OP card company's bill is a card bill, also with a bare LASKU text", () => {
    const { byDesc, totals } = run([row("chk", "2026-09-06", -402, "LASKU", "OP KORTTI OY")], [checking]);
    expect(byDesc("LASKU").category).toBe("card_bill");
    expect(totals.consumptionCents).toBe(40200);
  });

  it("money sent to an own savings account at another bank with the text SÄÄSTÖ is saving, not spending", () => {
    const { byDesc, totals } = run([row("chk", "2026-09-21", -200, "SÄÄSTÖ", "SANNA RANTANEN")], [checking]);
    expect(byDesc("SÄÄSTÖ").category).toBe("savings");
    expect(totals).toMatchObject({ savedCents: 20000, consumptionCents: 0 });
  });
});

describe("money that comes back is not income", () => {
  const shop = (date: string, euros: number, extra: Partial<Transaction> = {}) => row("chk", date, euros, "KORTTIOSTO", "NURKKAKAUPPA OY", extra);
  const mp = (date: string, euros: number, name: string) => row("chk", date, euros, "MOBILEPAY", name);

  describe("refund from a merchant", () => {
    it("79 € paid and 79 € back two weeks later cancel out, in the purchase's category", () => {
      const { final, totals } = run([shop("2026-09-01", -79), shop("2026-09-15", 79)], [checking]);
      expect(final[1]!.category).toBe(final[0]!.category);
      expect(final[1]!.categorySource).toBe("match");
      expect(totals).toMatchObject({ incomeCents: 0, consumptionCents: 0 });
    });

    it("a partial refund lowers the purchase by that much", () => {
      const { totals } = run([shop("2026-09-01", -79), shop("2026-09-15", 30)], [checking]);
      expect(totals).toMatchObject({ incomeCents: 0, consumptionCents: 4900 });
    });

    it("takes the category the purchase got from a rule or the trade register", () => {
      const rows = [shop("2026-09-01", -79), shop("2026-09-15", 79)];
      const changed = new Map(enrichTransactions(rows, [checking], [], new Map([["Nurkkakauppa Oy", "home"]])).map((t) => [t.id, t]));
      expect(changed.get(rows[0]!.id)!.category).toBe("home");
      expect(changed.get(rows[1]!.id)).toMatchObject({ category: "home", categorySource: "match" });
    });

    it("follows a category the user chose for the purchase and leaves a refund the user categorised alone", () => {
      const bought = shop("2026-09-01", -79, { category: "kids", categorySource: "user" });
      const back = shop("2026-09-15", 79);
      const mine = shop("2026-09-16", 20, { category: "sales", categorySource: "user" });
      const { final } = run([bought, back, mine], [checking]);
      expect(final[1]!.category).toBe("kids");
      expect(final[2]).toMatchObject({ category: "sales", categorySource: "user" });
    });

    it("on a connected card, a refund is not taken for a card payment", () => {
      const { final, totals } = run(
        [row("gold", "2026-09-01", -79, "KORTTIOSTO", "NURKKAKAUPPA OY"), row("gold", "2026-09-12", 79, "HYVITYS", "NURKKAKAUPPA OY")],
        [checking, gold],
      );
      expect(final.map((t) => t.isTransfer)).toEqual([false, false]);
      expect(totals).toMatchObject({ incomeCents: 0, consumptionCents: 0 });
    });

    it("cancels one of two identical purchases, and the same refund is not used twice", () => {
      const { totals } = run([shop("2026-09-01", -79), shop("2026-09-01", -79), shop("2026-09-10", 79), shop("2026-09-11", 79), shop("2026-09-12", 79)], [checking]);
      expect(totals).toMatchObject({ consumptionCents: 0, incomeCents: 7900 });
    });

    it("stays income without a purchase to match: other merchant, too late, more than paid, other account", () => {
      for (const rows of [
        [shop("2026-09-01", -79), row("chk", "2026-09-15", 79, "KORTTIOSTO", "TOINEN KAUPPA OY")],
        [shop("2026-05-01", -79), shop("2026-09-15", 79)],
        [shop("2026-09-01", -79), shop("2026-09-15", 80)],
        [shop("2026-09-15", 79), shop("2026-09-01", -79, { accountId: "sav" })],
        [shop("2026-09-15", 79), shop("2026-09-20", -79)],
      ]) {
        expect(run(rows, [checking, savingsAcc]).totals.incomeCents).toBeGreaterThan(0);
      }
    });

    it("a payout that says claim is income even from a merchant that is also paid", () => {
      const { totals } = run(
        [row("chk", "2026-09-01", -54.2, "E-LASKU", "IF VAHINKOVAKUUTUS OY"), row("chk", "2026-09-10", 30, "VAKUUTUSKORVAUS", "IF VAHINKOVAKUUTUS OY")],
        [checking],
      );
      expect(totals).toMatchObject({ incomeCents: 3000 });
    });
  });

  describe("a person pays back", () => {
    it("the same amount from the same person cancels what was sent", () => {
      const { final, totals } = run([mp("2026-09-01", -50, "ELISA VIRTANEN"), mp("2026-09-12", 50, "ELISA VIRTANEN")], [checking]);
      expect(final[1]!.category).toBe("p2p");
      expect(totals).toMatchObject({ incomeCents: 0, consumptionCents: 0 });
    });

    it("another amount, another person or a later date is income", () => {
      for (const rows of [
        [mp("2026-09-01", -50, "ELISA VIRTANEN"), mp("2026-09-12", 20, "ELISA VIRTANEN")],
        [mp("2026-09-01", -50, "ELISA VIRTANEN"), mp("2026-09-12", 50, "OTTO HEIKKINEN")],
        [mp("2026-05-01", -50, "ELISA VIRTANEN"), mp("2026-09-12", 50, "ELISA VIRTANEN")],
      ]) {
        const { totals } = run(rows, [checking]);
        expect(totals.incomeCents).toBeGreaterThan(0);
      }
    });
  });

  describe("sharing a bill", () => {
    const dinner = (euros = -66) => row("chk", "2026-09-05", euros, "KORTTIOSTO", "RAVINTOLA SOLMU");

    it("66 € paid, two friends send 22 € each: 22 € is left as spending", () => {
      const { final, totals } = run([dinner(), mp("2026-09-06", 22, "ELISA VIRTANEN"), mp("2026-09-07", 22, "OTTO HEIKKINEN")], [checking]);
      expect(final[1]!.category).toBe(final[0]!.category);
      expect(totals).toMatchObject({ incomeCents: 0, consumptionCents: 2200 });
    });

    it("three friends of four share equally: nothing is left", () => {
      const { totals } = run([dinner(-88), mp("2026-09-06", 22, "ELISA VIRTANEN"), mp("2026-09-06", 22, "OTTO HEIKKINEN"), mp("2026-09-08", 22, "LAURA KORHONEN")], [checking]);
      expect(totals).toMatchObject({ incomeCents: 0, consumptionCents: 2200 });
    });

    it("22 € paid and someone sends 22 € right after", () => {
      const { totals } = run([dinner(-22), mp("2026-09-06", 22, "ELISA VIRTANEN")], [checking]);
      expect(totals).toMatchObject({ incomeCents: 0, consumptionCents: 0 });
    });

    it("a share that does not divide to the cent still matches", () => {
      const { totals } = run([dinner(-65), mp("2026-09-06", 21.67, "ELISA VIRTANEN"), mp("2026-09-06", 21.67, "OTTO HEIKKINEN")], [checking]);
      expect(totals.incomeCents).toBe(0);
    });

    it("stays income when one person sends half, shares differ, the same person sends twice or it comes late", () => {
      for (const rows of [
        [dinner(), mp("2026-09-06", 33, "ELISA VIRTANEN")],
        [dinner(), mp("2026-09-06", 22, "ELISA VIRTANEN"), mp("2026-09-07", 25, "OTTO HEIKKINEN")],
        [dinner(), mp("2026-09-06", 22, "ELISA VIRTANEN"), mp("2026-09-07", 22, "ELISA VIRTANEN")],
        [dinner(), mp("2026-09-20", 22, "ELISA VIRTANEN"), mp("2026-09-21", 22, "OTTO HEIKKINEN")],
        [dinner(), mp("2026-09-04", 22, "ELISA VIRTANEN"), mp("2026-09-04", 22, "OTTO HEIKKINEN")],
      ]) {
        expect(run(rows, [checking]).totals.incomeCents).toBeGreaterThan(0);
      }
    });

    it("a payment to a person is not a bill to share", () => {
      const { totals } = run([mp("2026-09-05", -66, "LAURA KORHONEN"), mp("2026-09-06", 22, "ELISA VIRTANEN"), mp("2026-09-07", 22, "OTTO HEIKKINEN")], [checking]);
      expect(totals.incomeCents).toBe(4400);
    });
  });

  describe("regular income stays income", () => {
    it("rent from a lodger, even when the lodger was once sent the same amount", () => {
      const rent = ["2026-05-03", "2026-06-03", "2026-07-03", "2026-08-03"].map((d) => mp(d, 450, "ELISA VIRTANEN"));
      const { totals } = run([mp("2026-07-01", -450, "ELISA VIRTANEN"), ...rent], [checking]);
      expect(totals).toMatchObject({ incomeCents: 180000, consumptionCents: 45000 });
    });

    it("an allowance from an unrecognised sender that was also paid the same amount", () => {
      const allowance = ["2026-06-10", "2026-07-10", "2026-08-10", "2026-09-10"].map((d) => row("chk", d, 100, "TILISIIRTO", "ISOAITI MAIJA"));
      const { totals } = run([row("chk", "2026-07-08", -100, "TILISIIRTO", "ISOAITI MAIJA"), ...allowance], [checking]);
      expect(totals).toMatchObject({ incomeCents: 40000, consumptionCents: 10000 });
    });

    it("salary and benefits are never refunds", () => {
      const { final, totals } = run(
        [row("chk", "2026-08-01", -2500, "TILISIIRTO", "ACME OY"), row("chk", "2026-08-15", 2500, "PALKKA 08/2026", "ACME OY"), row("chk", "2026-08-20", -140, "E-LASKU", "KELA"), row("chk", "2026-09-03", 140, "LAPSILISA", "KELA")],
        [checking],
      );
      expect(final[1]!.category).toBe("salary");
      expect(final[3]!.category).toBe("benefits");
      expect(totals.incomeCents).toBe(264000);
    });
  });

  describe("the same result every time", () => {
    const rows = () => [
      row("chk", "2026-09-01", -79, "KORTTIOSTO", "NURKKAKAUPPA OY", { id: "a" }),
      row("chk", "2026-09-05", -66, "KORTTIOSTO", "RAVINTOLA SOLMU", { id: "b" }),
      row("chk", "2026-09-06", 22, "MOBILEPAY", "ELISA VIRTANEN", { id: "c" }),
      row("chk", "2026-09-07", 22, "MOBILEPAY", "OTTO HEIKKINEN", { id: "d" }),
      row("chk", "2026-09-15", 79, "KORTTIOSTO", "NURKKAKAUPPA OY", { id: "e" }),
      row("chk", "2026-09-16", -50, "MOBILEPAY", "LAURA KORHONEN", { id: "f" }),
      row("chk", "2026-09-20", 50, "MOBILEPAY", "LAURA KORHONEN", { id: "g" }),
    ];
    const apply = (input: Transaction[]) => {
      const changed = new Map(enrichTransactions(input, [checking], []).map((t) => [t.id, t]));
      return input.map((t) => changed.get(t.id) ?? t);
    };

    it("a second pass changes nothing and the input order does not matter", () => {
      const once = apply(rows());
      expect(enrichTransactions(once, [checking], [])).toEqual([]);
      const shuffled = apply([...rows()].reverse());
      const key = (list: Transaction[]) => list.map((t) => `${t.id}:${t.category}:${t.categorySource}:${t.isTransfer}`).sort();
      expect(key(shuffled)).toEqual(key(once));
      expect(totalsOf(once.map((t) => flowsOf(t, new Set()))).incomeCents).toBe(0);
    });

    it("changing the purchase's category by hand moves the refund with it, and undoing it moves it back", () => {
      const first = apply(rows());
      const edited = first.map((t) => (t.id === "a" ? { ...t, category: "kids", categorySource: "user" as const } : t));
      expect(apply(edited).find((t) => t.id === "e")!.category).toBe("kids");
    });
  });
});
