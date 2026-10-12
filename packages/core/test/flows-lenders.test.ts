/**
 * Money-flow scenarios for lenders, as in flows.test.ts: raw bank rows → categorise → flows. A payment to a lender and a
 * purchase paid in parts are debt, a shop with a loan word in its name is consumption, and what a peer-lending service
 * pays back is the loan given coming home.
 */
import { describe, expect, it } from "vitest";
import { type Flows, flowsOf, totalsOf } from "../src/analysis/flows.ts";
import { fold, normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, Transaction } from "../src/types.ts";
import { isCarFinanceText } from "../src/wording.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };

function row(accountId: string, bookingDate: string, euros: number, description: string, counterparty: string | null = null) {
  return tx({ accountId, bookingDate, amountCents: Math.round(euros * 100), description, counterparty, merchant: normalizeMerchant(counterparty, description) });
}

function run(rows: Transaction[], accounts: Account[]) {
  const changed = new Map(enrichTransactions(rows, accounts, []).map((t) => [t.id, t]));
  const final = rows.map((t) => changed.get(t.id) ?? t);
  const flows = final.map((t) => flowsOf(t, new Set(), new Set()));
  return { final, flows, totals: totalsOf(flows), byDesc: (d: string) => final.find((t) => t.description === d)! };
}

const neutral: Flows = { consumption: 0, debt: 0, saved: 0, income: 0, borrowed: 0 };

/** One row through the pipeline: its category and its flows. */
function one(counterparty: string | null, description: string, euros: number) {
  const { byDesc, flows } = run([row("chk", "2026-09-10", euros, description, counterparty)], [checking]);
  return { category: byDesc(description).category, flows: flows[0]! };
}

/** A row and what it must be: every flow the case does not name is zero. */
type Case = [counterparty: string | null, description: string, euros: number, category: string, flows: Partial<Flows>];
const check = ([counterparty, description, euros, category, flows]: Case) => expect(one(counterparty, description, euros)).toEqual({ category, flows: { ...neutral, ...flows } });

const CAR_FINANCIERS = ["TOYOTA FINANCE FINLAND OY", "TOYOTA FINANCIAL SERVICES", "TOYOTA RAHOITUS", "VOLKSWAGEN FINANS SVERIGE AB", "VOLKSWAGEN FINANCE", "VOLKSWAGEN FINANCIAL SERVICES", "VOLKSWAGEN RAHOITUS"];
const CONSUMER_LENDERS = ["SANTANDER CONSUMER FINANCE OY", "SVEA BANK AB", "SVEA EKONOMI AB", "COLLECTOR BANK AB", "INSTABANK ASA", "TF BANK AB", "IKANO BANK AB", "NORDAX BANK AB", "NOBA BANK GROUP AB"];
const LOAN_BROKERS = ["AVIDA FINANS AB", "NORTHMILL BANK AB", "FERRATUM FINLAND OY", "MONEYGO BANK AB", "EUROLOAN CONSUMER FINANCE OYJ", "AXO FINANS OY", "SAMBLA", "LENDO OY", "ZMARTA"];
const LOAN_PURPOSES = ["AUTO", "KULUTUS", "PANKKI", "REMONTTI", "VENE", "YHDISTELY", "PIKA", "JOUSTO", "KERTA", "LIMIITTI", "MÖKKI", "MOOTTORIPYÖRÄ", "VELKAKIRJA"];

describe("lenders and the words for credit", () => {
  // the finance companies of banks and car makers, then consumer lenders and loan brokers
  it.each([...CAR_FINANCIERS, "OP YRITYSPANKKI OYJ", "OP-RAHOITUS OY", "OP RAHOITUS OY", "OP-AUTORAHOITUS", "POHJOLA RAHOITUS OY", ...CONSUMER_LENDERS, ...LOAN_BROKERS])("a payment to %s is debt whatever its text", (counterparty) => {
    check([counterparty, "LASKU 44512", -250, "loans", { debt: 25000 }]);
  });

  it.each<[string, string, string]>([
    // credit named by a compound the whole words LUOTTO, LAINA and LYHENNYS do not read
    ["OP VÄHITTÄISASIAKKAAT OYJ", "JOUSTOLUOTTO", "loans"],
    ["S-PANKKI OYJ", "KERTALUOTTO 5566", "loans"],
    ["S-PANKKI OYJ", "LUOTONLYHENNYS", "loans"],
    ["S-PANKKI OYJ", "VELANLYHENNYS", "loans"],
    ["ALISA PANKKI OYJ", "AUTORAHOITUS 5566", "loans"],
    ["RAHALAITOS OY", "PIKAVIPPI 200", "loans"],
    // the loans a household takes, each named with its purpose
    ...LOAN_PURPOSES.map((purpose): [string, string, string] => ["ALISA PANKKI OYJ", `${purpose}LAINA 5566`, "loans"]),
    ["ALISA PANKKI OYJ", "AUTOLAINAN MAKSU", "loans"],
    ["ALISA PANKKI OYJ", "ASUNTOLAINA 5566", "mortgage"],
    // a purchase paid in parts through a payment service
    ["KLARNA BANK AB", "MAKSA OSISSA 4455", "loans"],
    ["KLARNA BANK AB", "OSAMAKSU 2", "loans"],
    ["KLARNA BANK AB", "MAKSUERÄ 2", "loans"],
    ["KLARNA BANK AB", "KUUKAUSIERÄ", "loans"],
    ["KLARNA BANK AB", "KOLMESSA ERÄSSÄ", "loans"],
    ["KLARNA BANK AB", "FINANCING 4455", "loans"],
    ["KLARNA BANK AB", "DELBETALNING", "loans"],
    ["KLARNA BANK AB", "PART PAYMENT", "loans"],
    ["WALLEY", "ERÄMAKSU", "loans"],
    ["WALLEY", "RAHOITUS 4455", "loans"],
    ["RIVERTY FINLAND OY", "ERÄ 2/4", "loans"],
    ["AFTERPAY", "ERÄMAKSU", "loans"],
    ["ANYDAY A/S", "VERKKOKAUPPA", "loans"],
    // a bank that also takes deposits is a lender only when the text names the credit
    ["BIGBANK AS SUOMEN SIVULIIKE", "KULUTUSLUOTTO 5521", "loans"],
  ])("%s / %s is debt (%s)", (counterparty, description, category) => {
    check([counterparty, description, -250, category, { debt: 25000 }]);
  });

  it.each<Case>([
    // a shop whose name holds the word
    ["RAVINTOLA LUOTTOMIES", "KORTTIOSTO", -250, "restaurants", { consumption: 25000 }],
    ["LUOTTOKAUPPA OY", "KORTTIOSTO", -250, "other", { consumption: 25000 }],
    ["SUKSILAINAAMO OY", "KORTTIOSTO", -250, "other", { consumption: 25000 }],
    ["ANYDAYS CAFE", "KORTTIOSTO", -250, "restaurants", { consumption: 25000 }],
    ["SUOMEN ASIAKASTIETO OY", "LUOTTOTIEDOT", -250, "other", { consumption: 25000 }],
    ["HOTEL TESSIN", "KORTTIOSTO", -140, "travel", { consumption: 14000 }],
    // a person whose name ends like a loan word
    ["ELAINA SMITH", "KIITOS", -50, "other", { consumption: 5000 }],
    // a purchase through Klarna paid at once, by invoice or with a card
    ["KLARNA BANK AB", "LASKU 99887766", -250, "shopping", { consumption: 25000 }],
    [null, "KLARNA*ZALANDO", -250, "shopping", { consumption: 25000 }],
    // the insurer of the same group
    ["POHJOLA VAKUUTUS OY", "VAKUUTUSMAKSU", -250, "insurance", { consumption: 25000 }],
    // a deposit bank's rows without a credit word: a deposit, a withdrawal, a reference alone
    ["MATTI MEIKÄLÄINEN", "SÄÄSTÖÖN BIGBANK", -500, "savings", { saved: 50000 }],
    ["BIGBANK AS SUOMEN SIVULIIKE", "MÄÄRÄAIKAISTALLETUS", -250, "savings", { saved: 25000 }],
    ["BIGBANK AS SUOMEN SIVULIIKE", "", -200, "other", { consumption: 20000 }],
    ["BIGBANK AS SUOMEN SIVULIIKE", "LASKU 44512", -250, "other", { consumption: 25000 }],
    ["BIGBANK AS SUOMEN SIVULIIKE", "TALLETUS", -5000, "other", { consumption: 500000 }],
    ["BIGBANK AS SUOMEN SIVULIIKE", "FI12 3456 7890 1234 56", 5000, "income", { income: 500000 }],
    ["BIGBANK AS SUOMEN SIVULIIKE", "NOSTO", 1000, "income", { income: 100000 }],
    ["BIGBANK AS SUOMEN SIVULIIKE", "TALLETUKSEN PALAUTUS", 1000, "reimbursements", { income: 100000 }],
    // a lease is rent for the car
    ["VOLKSWAGEN FINANCIAL SERVICES", "YKSITYISLEASING 123", -399, "other", { consumption: 39900 }],
    ["TOYOTA FINANCE FINLAND OY", "HUOLTOLEASING", -420, "other", { consumption: 42000 }],
    // a refund from a finance company, and of a credit named by a compound
    ["TOYOTA FINANCE FINLAND OY", "HYVITYS", 60, "reimbursements", { income: 6000 }],
    ["POHJOLA RAHOITUS OY", "PALAUTUS", 60, "reimbursements", { income: 6000 }],
    ["OP VÄHITTÄISASIAKKAAT OYJ", "JOUSTOLUOTTO HYVITYS", 60, "reimbursements", { income: 6000 }],
    // a refund from a payment service is a purchase coming back
    ["KLARNA BANK AB", "HYVITYS", 120, "shopping", { consumption: -12000 }],
    ["WALLEY", "PALAUTUS ERÄMAKSU", 120, "shopping", { consumption: -12000 }],
    // a housing company's charge for its own loan is a cost of living there
    ["AS OY KOTIKATU", "RAHOITUSVASTIKE YHTIÖLAINA", -310, "housing", { consumption: 31000 }],
    ["AS OY KOTIKATU", "YHTIÖLAINA", -310, "housing", { consumption: 31000 }],
    ["AS OY KOTIKATU", "RAHOITUSVASTIKE PANKKILAINA", -310, "housing", { consumption: 31000 }],
    ["KIINTEISTÖ OY KOTIKATU", "REMONTTILAINA", -310, "housing", { consumption: 31000 }],
  ])("%s / %s / %d is no debt and nothing borrowed (%s)", (...row) => {
    check(row);
  });

  it.each<Case>([
    // a library's loan, a card's credit and a loan taken to invest
    ["HELSINGIN KAUPUNGINKIRJASTO", "KAUKOLAINA", -250, "other", { consumption: 25000 }],
    ["S-PANKKI OYJ", "KORTTILUOTTO", -250, "other", { consumption: 25000 }],
    ["NORDEA BANK ABP", "SIJOITUSLAINA", -300, "investments", { saved: 30000 }],
    // a row the earlier rules read as a loan stays one: the new lists and their guards move nothing decided before them
    ["LAINA KORHONEN", "VIIKKORAHA", -50, "loans", { debt: 5000 }],
    ["AS OY KOTIKATU", "LAINAOSUUS", -310, "loans", { debt: 31000 }],
    ["SANTANDER CONSUMER FINANCE OY", "LEASINGVUOKRA", -300, "loans", { debt: 30000 }],
    ["SANTANDER CONSUMER FINANCE OY", "HYVITYS", 60, "credit_draw", { borrowed: 6000 }],
    ["KLARNA BANK AB", "OSAMAKSU HYVITYS", 80, "credit_draw", { borrowed: 8000 }],
  ])("%s / %s / %d is as it was before the new lists (%s)", (...row) => {
    check(row);
  });

  // a bond or a capital loan is money the household lends: no debt when bought, nothing borrowed when it comes back
  it.each(["OSAKEINDEKSILAINA", "INDEKSILAINAN", "DEBENTUURILAINAN", "DEBENTUURI", "PÄÄOMALAINA", "JOUKKOLAINA", "JOUKKOVELKAKIRJA", "VAIHTOVELKAKIRJALAINA", "VALTIONLAINA", "TUOTTO-OBLIGAATIO"])(
    "%s is no debt and nothing borrowed, at a bank and at a finance company",
    (word) => {
      for (const payee of ["NORDEA BANK ABP", "OP YRITYSPANKKI OYJ"]) {
        check([payee, `${word} MERKINTÄ`, -5000, "other", { consumption: 500000 }]);
        check([payee, `${word} ERÄÄNTYMINEN`, 5000, "income", { income: 500000 }]);
      }
    },
  );

  it("money in from a flexible credit or a lender is borrowed", () => {
    check(["OP VÄHITTÄISASIAKKAAT OYJ", "JOUSTOLUOTTO NOSTO", 300, "credit_draw", { borrowed: 30000 }]);
    check(["BIGBANK AS SUOMEN SIVULIIKE", "LAINA 5521", 3000, "credit_draw", { borrowed: 300000 }]);
    check(["TOYOTA FINANCE FINLAND OY", "RAHOITUS 44512", 12000, "credit_draw", { borrowed: 1200000 }]);
  });

  it("a flexible credit named in the text stays a loan at a card issuer though its payments change", () => {
    const rows = [412.3, 655.1, 389, 702.45].map((euros, i) => row("chk", `2026-0${i + 3}-10`, -euros, `JOUSTOLUOTTO ${i + 1}`, "NORDEA RAHOITUS SUOMI OY"));
    const { final, totals } = run(rows, [checking]);
    expect(final.map((t) => t.category)).toEqual(Array(4).fill("loans"));
    expect(totals).toMatchObject({ consumptionCents: 0, debtCents: 215885 });
  });

  it.each(CAR_FINANCIERS)("%s is car finance for Optimoi too: one list names the financiers (ADR 0008)", (name) => {
    expect(isCarFinanceText(fold(`${name} LASKU 44512`))).toBe(true);
  });
});

describe("peer lending", () => {
  const OTHER_SERVICES = ["PEERBERRY", "ROBOCASH", "LENDERMARKET", "ESKETIT", "SWAPER", "IUVO", "VIAINVEST", "REINVEST24", "TESSIN NORDIC AB", "VAURAUS SUOMI OYJ"];

  it.each<[string, string]>([
    ["FELLOW FINANCE OYJ", "TAKAISINMAKSU"],
    ["ESTATEGURU OU", "KORKO"],
    ["INVESDOR OY", "OSINKO"],
    ["MINTOS MARKETPLACE AS", "REPAYMENT"],
    ["TWINO", "WITHDRAWAL"],
    ...OTHER_SERVICES.map((name): [string, string] => [name, "WITHDRAWAL"]),
  ])("a repayment from %s (%s) is the loan given coming back: no income, nothing borrowed", (counterparty, description) => {
    check([counterparty, description, 212.5, "investments", { saved: -21250 }]);
  });

  it("money lent through the service is saved", () => {
    check(["MINTOS MARKETPLACE AS", "DEPOSIT", -500, "investments", { saved: 50000 }]);
    check(["TESSIN NORDIC AB", "MERKINTÄ 5521", -500, "investments", { saved: 50000 }]);
  });

  // such a service also lends to households: a row that names a loan or a credit is the household's own borrowing
  it.each<Case>([
    ["FELLOW FINANCE OYJ", "LAINAN NOSTO", 3000, "credit_draw", { borrowed: 300000 }],
    ["FELLOW FINANCE OYJ", "LAINA MAKSETTU TILILLE", 3000, "credit_draw", { borrowed: 300000 }],
    ["FELLOW FINANCE OYJ", "LAINAN MAKSATUS", 3000, "credit_draw", { borrowed: 300000 }],
    ["FELLOW FINANCE OYJ", "LAINAN LYHENNYS", 212.5, "credit_draw", { borrowed: 21250 }],
    ["FELLOW FINANCE OYJ", "LUOTON NOSTO", 3000, "credit_draw", { borrowed: 300000 }],
    ["FELLOW FINANCE OYJ", "LUOTTO MAKSETTU", 3000, "credit_draw", { borrowed: 300000 }],
    ["FELLOW FINANCE OYJ", "JOUSTOLUOTTO 5521", 3000, "credit_draw", { borrowed: 300000 }],
    ["FELLOW FINANCE OYJ", "LAINAN LYHENNYS", -140, "loans", { debt: 14000 }],
    // interest named with a loan word is read as it was before the service's repayments were
    ["FELLOW FINANCE OYJ", "LAINAN LYHENNYS JA KORKO", 212.5, "investment_income", { income: 21250 }],
  ])("%s / %s / %d names a loan (%s)", (...row) => {
    check(row);
  });

  it("interest and dividends from anyone else stay investment income", () => {
    check(["NORDNET BANK AB", "OSINKO", 80, "investment_income", { income: 8000 }]);
    check(["S-PANKKI OYJ", "TALLETUSKORKO", 12, "investment_income", { income: 1200 }]);
  });
});
