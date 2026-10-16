/**
 * Lenders the word lists do not name, and the bank's own rows. A finance company on no list is debt when it is paid and
 * borrowed money when it pays out, one payout makes a payee a lender, a credit institution of the trade register is a
 * lender off a card, and a row with no payee is cash, interest, a tax or a fee by its text. Every row is made up.
 */
import { describe, expect, it } from "vitest";
import { seededHousehold } from "../../../tools/findings/households.ts";
import { flowsOf, totalsOf } from "../src/analysis/flows.ts";
import { bankRowRules } from "../src/categorize-bank-rows.ts";
import { categoryForIndustry } from "../src/industry.ts";
import { fold, normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, CategoryRule, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const LENDER = "ESIMERKKIRAHOITUS OY";
/** A bank named by a compound, which is no lender by its name, and a bank with the word of its own, which is one when paid. */
const BANK = "ESIMERKKIPANKKI OYJ";
const BANK_AB = "ESIMERKKI BANK AB";
const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
const card: Account = { id: "card", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };

type Extra = { mcc?: string; bankTxnCode?: string; accountId?: string; date?: string };
const row = (counterparty: string | null, description: string | null, euros: number, extra: Extra = {}) =>
  tx({
    accountId: extra.accountId ?? "chk",
    bookingDate: extra.date ?? "2026-09-05",
    amountCents: Math.round(euros * 100),
    counterparty,
    description,
    mcc: extra.mcc ?? null,
    bankTxnCode: extra.bankTxnCode ?? null,
    merchant: normalizeMerchant(counterparty, description),
  });
/** A row as the server stores it: the reference number is a field of its own, which the core type does not name. */
const withReference = (t: Transaction, reference: string) => ({ ...t, reference }) as Transaction;

/** The rows through the whole enrichment, and the totals of a month. */
function run(rows: Transaction[], opts: { rules?: CategoryRule[]; industries?: Map<string, string>; accounts?: Account[] } = {}) {
  const changed = new Map(enrichTransactions(rows, opts.accounts ?? [checking, card], opts.rules ?? [], opts.industries).map((t) => [t.id, t]));
  const final = rows.map((t) => changed.get(t.id) ?? t);
  const totals = (month: string) => totalsOf(final.filter((t) => t.bookingDate.startsWith(month)).map((t) => flowsOf(t, new Set())));
  return { final, totals, categories: final.map((t) => t.category) };
}
const one = (counterparty: string | null, description: string | null, euros: number, extra: Extra = {}) => run([row(counterparty, description, euros, extra)]).final[0]!.category;

describe("a lender on no list, by the shape of its name", () => {
  it("twelve equal payments with a reference to a finance company are loans, and the month's debt payments count them", () => {
    const months = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
    const { categories, totals } = run(months.map((m) => withReference(row(LENDER, "12345 67890", -152, { date: `${m}-04` }), "1234567890")));
    expect(new Set(categories)).toEqual(new Set(["loans"]));
    expect(totals("2026-09")).toMatchObject({ debtCents: 15_200, consumptionCents: 0 });
  });

  it("a payout from the same company is credit drawn: the month's borrowed counts it and its income does not", () => {
    const { categories, totals } = run([row(LENDER, "SOPIMUS 880123", 4000), row(LENDER, "880123", -152, { date: "2026-09-28" })]);
    expect(categories).toEqual(["credit_draw", "loans"]);
    expect(totals("2026-09")).toMatchObject({ borrowedCents: 400_000, incomeCents: 0, debtCents: 15_200 });
  });

  it.each([
    ["ESIMERKKI FINANS AB", "88 123"],
    ["ESIMERKKI CREDIT LTD", "88 123"],
    ["ESIMERKKI FINANCE OY", "88 123"],
    ["ESIMERKKIKREDIT AB", "88 123"],
  ])("%s is a lender: a form of a limited company and a word of lending, wherever the form stands", (payee, text) => {
    expect(one(payee, text, -99)).toBe("loans");
    expect(one(payee, text, 2500)).toBe("credit_draw");
  });

  // a bank, or a payment firm, is debt when it is paid; what it sends is what it was, since a bank also pays bonuses and pay
  it.each([
    ["ESIMERKKI BANK ASA", "20260115 4X1"],
    ["ESIMERKKI KORT BANK AB (PUBL), HELSINGIN SIVULIIKE", "1234 5678"],
    ["ESIMERKKI BANK A/S, SUOMEN SIVULIIKE", "88 123"],
    ["SPAREBANK ESIMERKKI AB", "88 123"],
    ["ESIMERKKI HYPOPANKKI OY", "88 123"],
    ["ESIMERKKI FINANCIAL SERVICES LTD", "PAYOUT 5512"],
  ])("%s is a lender when paid, and money in from it is no credit unless its text says so", (payee, text) => {
    expect(one(payee, text, -99)).toBe("loans");
    expect(one(payee, text, 2500)).toBe("income");
  });

  it("a payout from a bank whose text says loan is credit drawn, as it was", () => {
    expect(one(BANK_AB, "LAINAN NOSTO 880123", 4000)).toBe("credit_draw");
  });

  // each row keeps what it was before the rule: [payee, text, euros, card evidence, category]
  it.each<[string, string | null, number, Extra, string]>([
    // a card purchase at a restaurant whose name has a bank word: by the bank's code, by the card's code, by the terminal's text
    ["RAVINTOLA THE BANK OY", "HELSINKI", -42, { bankTxnCode: "PMNT-CCRD-POSD" }, "restaurants"],
    ["THE BANK OY", null, -42, { mcc: "5812" }, "restaurants"],
    ["THE BANK OY", "12345678 HELSINKI", -42, {}, "other"],
    // a restaurant by its trade word, with no card evidence at all
    ["RAVINTOLA THE BANK OY", "LASKU 123", -42, {}, "restaurants"],
    // pay from an employer that is a bank or a finance company, by the word and by the bank's code
    [BANK_AB, "PALKKA 9/2026", 3100, {}, "salary"],
    [LENDER, "PALKKA 9/2026", 3100, {}, "salary"],
    [BANK_AB, null, 3100, { bankTxnCode: "PMNT-RCDT-SALA" }, "salary"],
    // what else a bank or a finance company sends and takes
    [BANK_AB, "HYVITYS 123", 15, {}, "reimbursements"],
    [LENDER, "HYVITYS 123", 15, {}, "reimbursements"],
    [BANK_AB, "TALLETUSKORKO", 15, {}, "investment_income"],
    [BANK_AB, "SÄÄSTÖTILI", -200, {}, "savings"],
    // what the text says the money is: a lease, a bond, a card's credit; and a purchase through a payment service
    ["ESIMERKKIRAHOITUS OY", "HUOLTOLEASING", -420, {}, "leasing"],
    [BANK_AB, "JOUKKOLAINA", -1000, {}, "other"],
    [BANK_AB, "KORTTILUOTTO", -250, {}, "other"],
    ["KLARNA BANK AB", "LASKU 99887766", -250, {}, "shopping"],
    // an insurer under a bank's name, an association, a housing company, a bank that only takes deposits
    ["ESIMERKKIPANKKI HENKIVAKUUTUS OY", "1234 5678", -31, {}, "insurance"],
    ["RUOKAPANKKI RY", "LAHJOITUS", -20, {}, "gifts_donations"],
    ["AS OY PANKKITALO", "VASTIKE", -300, {}, "housing"],
    ["ESIMERKKIBANK AS", "1234", -99, {}, "other"],
    // a transfer to a person, with a free message and with the bank's own word
    ["MEIKALAINEN MATTI", "kiitos", -50, {}, "other"],
    ["MEIKALAINEN MATTI", "MOBIILIMAKSU", -50, {}, "p2p"],
  ])("near miss: %s, %s (%d €) stays what it was", (payee, text, euros, extra, category) => {
    expect(one(payee, text, euros, extra)).toBe(category);
  });

  it("a row under the user's own rule keeps the user's category", () => {
    const rules: CategoryRule[] = [{ field: "counterparty", pattern: "ESIMERKKIRAHOITUS", category: "car", priority: 10 }];
    expect(run([row(LENDER, "12345 67890", -152)], { rules }).categories).toEqual(["car"]);
  });
});

describe("one payee, one answer", () => {
  // the name says nothing of lending: only the payout's text does
  const PAYEE = "ESIMERKKI NORDIC OY";
  const payout = row(PAYEE, "LUOTON NOSTO 880123", 4000, { date: "2026-03-02" });
  const payment = () => row(PAYEE, "880123", -152);

  it("a payee that paid credit out is a lender, so a payment to it with no word of lending is a loan payment", () => {
    const { final, totals } = run([payout, payment()]);
    expect(final.map((t) => [t.category, t.categorySource])).toEqual([["credit_draw", "rule"], ["loans", "merchant"]]);
    expect(totals("2026-09")).toMatchObject({ debtCents: 15_200, consumptionCents: 0 });
  });

  it("without a payout the payment is no loan, and a purchase on a card from the lender is none either", () => {
    expect(run([payment()]).categories).toEqual(["other"]);
    expect(run([payout, row(PAYEE, "880123", -152, { accountId: "card" })]).categories).toEqual(["credit_draw", "other"]);
  });
});

describe("a credit institution of the trade register", () => {
  it("the codes of banks and of other credit granting are loans, and a holding company and a fund are nothing", () => {
    expect([categoryForIndustry("64190", "TOL2008"), categoryForIndustry("64920", "TOL2025")]).toEqual(["loans", "loans"]);
    expect([categoryForIndustry("64200", "TOL2008"), categoryForIndustry("64300", "TOL2025"), categoryForIndustry("66190", "TOL2008")]).toEqual([null, null, null]);
  });

  it("a payment to one is a loan payment, and a card purchase at a shop of the same name is not", () => {
    const invoice = row("ESIMERKKI NORDIC OY", "10016", -152);
    const purchase = row("ESIMERKKI NORDIC OY", null, -42, { accountId: "card" });
    const { final } = run([invoice, purchase], { industries: new Map([[invoice.merchant, "loans"]]) });
    expect(final.map((t) => [t.category, t.categorySource])).toEqual([["loans", "industry"], ["other", "default"]]);
  });
});

describe("a row with no payee is the bank's own", () => {
  it("a street address is cash from a machine, not the pharmacy in the street's name or the resort the town is named like", () => {
    expect(one(null, "40100 APTEEKKIKUJA 3 ESIMERKKILA", -400)).toBe("cash");
    expect(one(null, "ASEMAKATU 1 RUKA", -60)).toBe("cash");
  });

  it("an address on a card purchase is the purchase's own: the code of a car park is a car, and the code of a cash machine is cash", () => {
    expect(one(null, "ASEMAKATU 1 HELSINKI", -4.2, { mcc: "7523" })).toBe("car");
    expect(one(null, "ASEMAKATU 1 HELSINKI", -60, { mcc: "6011" })).toBe("cash");
  });

  it("a shop before its address is the shop, and so is an address beside a payee's name", () => {
    expect(one(null, "K-MARKET ASEMAKATU 1 ESIMERKKILA", -25)).toBe("groceries");
    expect(one("ESIMERKIN APTEEKKI", "APTEEKKIKUJA 3 ESIMERKKILA", -25)).toBe("health");
  });

  it("an interest word is interest, in a compound too, and a payee with the word in its name is none", () => {
    expect(one(null, "KORKO 1.9.-30.9.2026", -12)).toBe("interest");
    expect(one(null, "VELKAKORKO 1.9.-30.9.2026", -12)).toBe("interest");
    expect(one("KORKOKENKÄ OY", "LASKU 123", -12)).not.toBe("interest");
  });

  it("the word of interest ends the word, so a surname or a shop that begins with it is none", () => {
    expect(one(null, "KUKKAKAUPPA KORKONEN", -25)).toBe("home");
    expect(one(null, "KORKOKENKA HELSINKI", -79)).toBe("other");
    expect(one(null, "VELKAKORKOA 9/2026", -12)).toBe("interest");
  });

  it("the Finnish forms of interest, Koron and Korot, are interest as Korko is, and a longer word is none", () => {
    expect(one(null, "KORON OSUUS 9/2026", -12)).toBe("interest");
    expect(one(null, "KOROT 1.9.-30.9.2026", -12)).toBe("interest");
    expect(one(null, "VELKAKOROT 9/2026", -12)).toBe("interest");
    expect(one(null, "KORONA 9/2026", -12)).not.toBe("interest");
    expect(one(null, "KORONEN HELSINKI", -25)).not.toBe("interest");
  });

  it("tax at source on interest is a tax, and the bank's monthly services are a fee with and without the bank as the payee", () => {
    expect(one(null, "Korkotulon lähdevero", -3)).toBe("taxes");
    expect(one(null, "Päivittäispalvelut 9/2026", -1.5)).toBe("fees");
    expect(one(BANK, "Päivittäispalvelut 9/2026", -1.5)).toBe("fees");
  });
});

describe("a bank by its name only", () => {
  it.each<[string, string, number]>([
    [BANK, "BONUS 9/2026", 12],
    [BANK, "KATEISPANO", 200],
    // pay with no word and no code
    [BANK, "9/2026", 2900],
    ["KUVAPANKKI OY", "ROYALTY 9/2026", 85],
    // a deposit coming home
    [BANK_AB, "TILIN LOPETUS", 4000],
  ])("%s, %s: money in is income, a bank is no lender for sending it", (payee, text, euros) => {
    expect(one(payee, text, euros)).toBe("income");
  });

  // the card is connected and no payment of its bill pairs, so its channel is not known; the bonus once made the bank a lender, and the issuer fallback spared its bills
  it("a bank's bonus does not take its card bills out of the transfers: June's spending is the card's 380", () => {
    const gold: Account = { id: "gold", name: "Esimerkkipankki Gold", iban: null, currency: "EUR", type: "credit_card" };
    const shop = (euros: number, date: string) => row("ESIMERKIN KAUPPA OY", null, euros, { accountId: "gold", date, mcc: "5411" });
    const rows = [
      row(BANK, "BONUS 3/2026", 12, { date: "2026-03-30" }),
      shop(-420, "2026-05-20"),
      shop(-380, "2026-06-20"),
      row(BANK, "KORTTILASKU", -420, { date: "2026-06-14" }),
      row(BANK, "KORTTILASKU", -380, { date: "2026-07-14" }),
    ];
    const { final, totals } = run(rows, { accounts: [checking, gold] });
    expect(totals("2026-06").consumptionCents).toBe(38_000);
    expect(final[0]!.category).toBe("income");
  });

  it("after a bonus its other rows are what they were: a card's credit and a lease are no loan payments", () => {
    const { categories } = run([row(BANK, "BONUS 3/2026", 12, { date: "2026-03-30" }), row(BANK, "KORTTILUOTTO", -250), row(BANK, "LEASING 5512", -380)]);
    expect(categories).toEqual(["income", "other", "other"]);
  });

  // a name that ends in the bank's word is a bank only when the word is its own or follows a known kind of bank
  it.each<[string, string, number]>([
    ["KUVAPANKKI OY", "LASKU 5567", -29],
    ["VARAOSAPANKKI OY", "LASKU 5567", -120],
    ["POWERBANK OY", "LASKU 5567", -35],
    ["DATABANK AB", "LASKU 5567", -60],
    // a person: Åsa Bank folds to BANK ASA, and ASA is a form of a company only behind a name
    ["BANK ÅSA", "LAHJA", -50],
    // a compound with the bank's word at its end is not told from VARAOSAPANKKI: that bank's rows are decided by their text
    [BANK, "LASKU 5567", -152],
  ])("%s, %s (%d €) is no lender by its name", (payee, text, euros) => {
    expect(one(payee, text, euros)).toBe("other");
  });
});

describe("the household's own bank", () => {
  const own: Account = { ...checking, bank: "Esimerkki Bank" };
  const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const monthly = (payee: string, reference: string, euros: number[]) => euros.map((e, i) => withReference(row(payee, null, e, { date: `${months[i]}-10` }), reference));

  it.each([
    ["TILIOTE PAPERINEN", -3],
    ["MERKINTA 4411", -100],
  ])("%s to the bank of a connected account is what it was", (text, euros) => {
    expect(run([row(BANK_AB, text, euros)], { accounts: [own, card] }).categories).toEqual(["other"]);
    expect(run([row(BANK_AB, text, euros)]).categories).toEqual(["loans"]);
  });

  it("a card's bill paid with a reference only, to the bank of the account, is what it was", () => {
    const bills = () => monthly(BANK_AB, "20028", [-312.4, -188.1, -540, -95.75, -410.2, -267.3]);
    expect(new Set(run(bills(), { accounts: [own, card] }).categories)).toEqual(new Set(["other"]));
  });

  it("another bank and a finance company are still debt: six equal payments under one reference are loans", () => {
    const other: Account = { ...checking, bank: "Toinen Pankki" };
    for (const payee of [BANK_AB, LENDER]) {
      expect(new Set(run(monthly(payee, "30031", Array(6).fill(-152)), { accounts: [other, card] }).categories), payee).toEqual(new Set(["loans"]));
    }
    expect(new Set(run(monthly(BANK_AB, "30031", Array(6).fill(-152))).categories)).toEqual(new Set(["loans"]));
    // the bank's own six equal payments under one reference are a loan by the contract, not by the name (source merchant)
    const ownLoan = run(monthly(BANK_AB, "30031", Array(6).fill(-152)), { accounts: [own, card] }).final;
    expect(new Set(ownLoan.map((t) => `${t.category}/${t.categorySource}`))).toEqual(new Set(["loans/merchant"]));
  });

  const cat = (rows: Transaction[], accounts: Account[] = [own, card]) => run(rows, { accounts }).final.map((t) => `${t.category}/${t.categorySource}`);

  // the contract is the bank's own: a payee that only shares a word with the bank's name, and a text that says what the money is, are none
  describe("the contract is asked of the bank itself and of a text with no word", () => {
    const sums = { equal: Array<number>(6).fill(-152), "three equal and three other": [-152, -152, -152, -98.2, -211.4, -175.9] };
    it.each<[string, string, string | null]>([
      ["Esimerkki Bank", "ESIMERKKI FUNDS OY", null],
      ["Oma Säästöpankki Oyj", "OMA TUPA OY", null],
      ["Esimerkkipankki Oyj", "ESIMERKKIPANKKI KIINTEISTOT OY", null],
      ["Esimerkkipankki Oyj", BANK, "TALLELOKERO"],
      ["Esimerkkipankki Oyj", BANK, "SOPIMUS 4411"],
    ])("bank %s, payee %s, text %s: six payments under one reference are no loan", (bank, payee, text) => {
      for (const [name, euros] of Object.entries(sums)) {
        const rows = euros.map((e, i) => withReference(row(payee, text, e, { date: `${months[i]}-10` }), "30031"));
        expect(new Set(cat(rows, [{ ...checking, bank }, card])), name).toEqual(new Set(["other/default"]));
      }
    });

    it("the bank itself with the number only as its text holds a loan: the extra payments are the loan's, and two payments are none", () => {
      for (const text of [null, "12345 67890"]) {
        const rows = [-152, -152, -152, -98.2, -211.4, -175.9].map((e, i) => withReference(row(BANK_AB, text, e, { date: `${months[i]}-10` }), "30031"));
        expect(new Set(cat(rows)), String(text)).toEqual(new Set(["loans/merchant"]));
      }
      expect(cat(monthly(BANK_AB, "30031", [-152, -152]))).toEqual(["other/default", "other/default"]);
    });

    it("a contract is one reference: a loan under one and bills under another are told apart", () => {
      const rows = [...monthly(BANK_AB, "30031", Array(6).fill(-152)), ...monthly(BANK_AB, "20028", [-312.4, -188.1, -540, -95.75, -410.2, -267.3])];
      expect(cat(rows)).toEqual([...Array(6).fill("loans/merchant"), ...Array(6).fill("other/default")]);
    });

    it("a payment that moves money to an account of the household is no instalment: three equal ones moved make no loan of three bills that vary", () => {
      const savings: Account = { ...checking, id: "sav", iban: "FI4950009420028730", type: "savings" };
      const moved = [-152, -152, -152].map((e, i) => withReference({ ...row(BANK_AB, null, e, { date: `${months[i]}-10` }), counterpartyIban: savings.iban }, "30031"));
      const bills = [-312.4, -188.1, -540].map((e, i) => withReference(row(BANK_AB, null, e, { date: `${months[i + 3]}-10` }), "30031"));
      const { final } = run([...moved, ...bills], { accounts: [own, savings, card] });
      expect(final.slice(0, 3).map((t) => t.isTransfer)).toEqual([true, true, true]);
      expect(final.slice(3).map((t) => t.category)).toEqual(["other", "other", "other"]);
    });

    it("a payment on a card's account is no instalment of the bank's contract", () => {
      const onCard = monthly(BANK_AB, "30031", Array(6).fill(-152)).map((t) => ({ ...t, accountId: "card" }));
      expect(new Set(cat(onCard))).toEqual(new Set(["other/default"]));
    });
  });

  it("a bank abroad whose account is connected is the household's own", () => {
    const n26: Account = { ...checking, bank: "N26" };
    expect(run([row("N26 BANK GMBH", null, -500)], { accounts: [n26, card] }).categories).toEqual(["other"]);
  });

  it("the form of a company in the bank's name names no bank", () => {
    const form: Account = { ...checking, bank: "Toinen Oyj" };
    expect(run([row("ESIMERKKI FINANCE OYJ", "LASKU 123", -152)], { accounts: [form, card] }).categories).toEqual(["loans"]);
  });

  // the bank's own finance company is a lender, as any other: only money out to the bank's plain name steps aside
  describe("with the bank's finance company", () => {
    const mine: Account = { ...checking, bank: "Esimerkkipankki Oyj" };
    const FINANCE = "ESIMERKKIPANKKI RAHOITUS OY";
    const categories = (rows: Transaction[], accounts: Account[] = [mine, card]) => run(rows, { accounts }).categories;

    it("is credit drawn when it pays out and a loan when it is paid, the bank's name in it or not", () => {
      expect(categories([row(FINANCE, "SOPIMUS 880123", 4000)])).toEqual(["credit_draw"]);
      expect(categories([row(FINANCE, null, -152)])).toEqual(["loans"]);
      expect(categories([row("ESIMERKKIPANKKI FINANCE OY", "SOPIMUS 880123", -152)])).toEqual(["loans"]);
      // the same with no account at that bank
      expect(categories([row(FINANCE, "SOPIMUS 880123", 4000), row(FINANCE, null, -152)], [checking, card])).toEqual(["credit_draw", "loans"]);
    });

    it("leaves the bank's own lines as they were: a statement fee, a bonus, a paid-in deposit", () => {
      expect(categories([row(BANK, "TILIOTE PAPERINEN", -3), row(BANK, "BONUS 9/2026", 12), row(BANK, "KATEISPANO", 200)])).toEqual(["other", "income", "income"]);
    });

    // the register names the bank a credit institution; a row has the answer it has without the register
    it("gives a row the same answer whether the register names the bank a credit institution or not", () => {
      const ownRows = () => [row(BANK, "TILIOTE PAPERINEN", -3), row(BANK, "MERKINTA 4411", -100), ...monthly(BANK, "30031", Array(6).fill(-152))];
      const register = (rows: Transaction[]) => new Map(rows.map((t) => [t.merchant, "loans"]));
      const rows = ownRows();
      // the fee and the subscription are no loan; the six equal payments under one reference are one, by the contract
      const want = ["other", "other", ...Array(6).fill("loans")];
      expect(categories(rows)).toEqual(want);
      expect(run(rows, { accounts: [mine, card], industries: register(rows) }).categories).toEqual(want);
      // not the household's bank: the register is heard
      expect(new Set(run(rows, { accounts: [checking, card], industries: register(rows) }).categories)).toEqual(new Set(["loans"]));
      // the bank's finance company is a loan with the register on, as with it off
      const finance = [row(FINANCE, null, -152)];
      expect(run(finance, { accounts: [mine, card], industries: register(finance) }).categories).toEqual(["loans"]);
    });
  });
});

describe("a person's payout", () => {
  const payout = row("MATTI JUHANI PEKKA ANTERO MEIKALAINEN", "LUOTON SIIRTO", 800, { date: "2026-03-02" });
  const person = (payee: string) => [row(payee, "LUOTON SIIRTO", 800, { date: "2026-03-02" }), row(payee, null, -200), row(payee, "VIIKKORAHA", -40)];

  it("a card's credit moved to the own account makes the holder no lender: the payer is the user's own name", () => {
    const held: Account = { ...checking, holder: "Matti Juhani Pekka Antero Meikalainen" };
    const rows = [payout, row(payout.counterparty, null, -200), row(payout.counterparty, "VIIKKORAHA", -40)];
    expect(run(rows, { accounts: [held, card] }).categories).toEqual(["credit_draw", "other", "other"]);
  });

  it("a payee shaped like a person is no lender by what it paid", () => {
    expect(run(person("LIISA VIRTANEN")).categories).toEqual(["credit_draw", "other", "other"]);
  });

  it("a company that paid credit out is still a lender", () => {
    expect(run(person("ESIMERKKI NORDIC OY")).categories).toEqual(["credit_draw", "loans", "loans"]);
  });
});

describe("an overpayment sent back", () => {
  it.each(["LIIKASUORITUS 880123", "YLISUORITUS 880123"])("%s from a finance company is a refund, not credit drawn", (text) => {
    expect(one(LENDER, text, 30)).toBe("reimbursements");
  });
});

describe("the seeded households", () => {
  const rules = bankRowRules(() => false, () => false);
  const reads = (t: Transaction, accounts: readonly Account[]) => {
    const text = fold([t.merchant, t.counterparty, t.description].filter(Boolean).join(" | "));
    return rules.some((r) => (!r.direction || t.amountCents < 0) && r.test(text, t, { user: null, others: [] }, accounts));
  };
  const households = [1, 2, 3, 4, 5].flatMap((seed) => [seededHousehold(seed, false), seededHousehold(seed, true)]);

  // the golden files did not move: this is why
  it.each(households.map((h) => [h.name, h] as const))("%s: no rule of this file reads a row and nobody paid credit out, so no row moves", (_name, h) => {
    expect(h.txs.filter((t) => reads(t, h.accounts)).map((t) => `${t.counterparty} | ${t.description}`)).toEqual([]);
    expect(enrichTransactions(h.txs, h.accounts, h.rules).filter((t) => t.category === "credit_draw")).toEqual([]);
  });
});
