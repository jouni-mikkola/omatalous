/**
 * Loans and savings (O3): the day walk, then each finding on a household small enough to work out by hand. Every
 * month repeats the same rows, so the usual spending is the month's sum and the walks are sums of whole months.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../../src/analysis/context.ts";
import { cardCosts } from "../../src/analysis/credit.ts";
import { dayNumber, monthRange } from "../../src/dates.ts";
import { loans } from "../../src/optimise/areas/loans.ts";
import { savings } from "../../src/optimise/areas/savings.ts";
import {
  allFindings,
  type AreaResult,
  areaInputOf,
  buildOptimise,
  type FindingDraft,
  type InputValues,
  type LoanReference,
  type OptimiseInput,
} from "../../src/optimise/index.ts";
import { balanceReport, balanceWalk, lowestDayBalance } from "../../src/reports/balances.ts";
import type { Account, BalanceInput, Transaction } from "../../src/types.ts";
import { enrich, FRAME, type Household, household, householdInput, joinHousehold } from "./household.ts";
import * as loansPart from "./parts/loans.ts";
import * as savingsPart from "./parts/savings.ts";

const TODAY = "2026-10-15";
const ASOF = "2026-10-14";
const IBAN = { chk: "FI2112345600000785", sav: "FI1410093000123458", loan: "FI5512345600000123" };
const ACCOUNTS: Account[] = [
  { id: "chk", name: "Käyttötili", iban: IBAN.chk, currency: "EUR", type: "checking" },
  { id: "sav", name: "Säästötili", iban: IBAN.sav, currency: "EUR", type: "savings" },
  { id: "loan", name: "Asuntolaina", iban: IBAN.loan, currency: "EUR", type: "loan" },
  { id: "card", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" },
];

interface Opts {
  pay: number;
  /** Moved from checking to savings on the 16th. */
  toSavings: number;
  mortgage: boolean;
  /** Card purchases of 4 × 50 € and a monthly interest of 15 €, the bill paid in full on the 25th. */
  card: boolean;
  /** Interest paid to savings on 31.12.2025. */
  savingsInterest: number;
  /** Months (YYYY-MM) whose card interest is left out. */
  noInterestIn?: string[];
  /** The text of the card charge on the 28th in place of LUOTTOKORKO. */
  cardCharge?: string;
  balances: { chk: number | null; sav: number | null; loan?: number | null; card?: number | null };
  balanceAt?: string;
  loanRate?: { marginBp: number; reference: LoanReference };
  extra?: (add: (p: Partial<Transaction> & Pick<Transaction, "bookingDate" | "amountCents" | "merchant">) => void) => void;
}

/** Groceries 3 × 250 € a month, pay on the 15th, and what the options add, from 1.10.2024 to today. */
function build(o: Opts): OptimiseInput {
  const txs: Transaction[] = [];
  const add = (p: Partial<Transaction> & Pick<Transaction, "bookingDate" | "amountCents" | "merchant">) => {
    if (p.bookingDate > TODAY) return;
    txs.push({
      id: `m-${String(txs.length).padStart(5, "0")}`,
      accountId: "chk",
      currency: "EUR",
      status: "booked",
      counterparty: null,
      counterpartyIban: null,
      description: null,
      mcc: null,
      category: "other",
      categorySource: "default",
      isTransfer: false,
      ...p,
    });
  };
  for (const month of monthRange("2024-10", "2026-10")) {
    const on = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
    for (const d of [1, 8, 22]) add({ bookingDate: on(d), amountCents: -25000, merchant: "K-Market Kamppi", description: "K-MARKET KAMPPI", mcc: "5411" });
    add({ bookingDate: on(15), amountCents: o.pay, merchant: "Työnantaja Oy", counterparty: "TYÖNANTAJA OY", description: "PALKKA" });
    add({ bookingDate: on(16), amountCents: -o.toSavings, merchant: "Siirto", description: "OMA SIIRTO", counterpartyIban: IBAN.sav });
    add({ bookingDate: on(16), amountCents: o.toSavings, merchant: "Siirto", description: "OMA SIIRTO", accountId: "sav", counterpartyIban: IBAN.chk });
    if (o.mortgage) add({ bookingDate: on(5), amountCents: -90000, merchant: "Nordea", description: "ASUNTOLAINA", counterpartyIban: IBAN.loan });
    if (o.card) {
      for (const d of [2, 9, 16, 23]) add({ bookingDate: on(d), amountCents: -5000, merchant: "Tokmanni", description: "TOKMANNI", accountId: "card" });
      add({ bookingDate: on(25), amountCents: -21500, merchant: "Luottokortti", description: "LUOTTOKORTIN LASKU" });
      add({ bookingDate: on(25), amountCents: 21500, merchant: "Luottokortti", description: "MAKSU KIITOS", accountId: "card" });
      // the interest the bill pays next month: 15 € in a month that has it, else the 15 € comes back as a purchase
      const interest = !o.noInterestIn?.includes(month);
      const text = o.cardCharge ?? "LUOTTOKORKO";
      add({ bookingDate: on(28), amountCents: -1500, merchant: interest ? (o.cardCharge ? "Nordea" : "Luottokorko") : "Tokmanni", description: interest ? text : "TOKMANNI", accountId: "card" });
    }
  }
  if (o.savingsInterest) add({ bookingDate: "2025-12-31", amountCents: o.savingsInterest, merchant: "Talletuskorko", description: "TALLETUSKORKO", accountId: "sav" });
  o.extra?.(add);
  txs.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate) || a.id.localeCompare(b.id));
  const at = o.balanceAt ?? ASOF;
  const balance = (id: keyof typeof IBAN | "card", cents: number | null | undefined): BalanceInput[] =>
    cents === undefined ? [] : [{ id, name: ACCOUNTS.find((a) => a.id === id)!.name, type: ACCOUNTS.find((a) => a.id === id)!.type, balanceCents: cents, ownerName: null, balanceAt: at }];
  const accounts = ACCOUNTS.filter((a) => (a.id !== "loan" || o.balances.loan !== undefined || o.mortgage) && (a.id !== "card" || o.card));
  const values: InputValues = o.loanRate ? { loan_rate: { value: o.loanRate, asOf: "2026-09-01" } } : {};
  return {
    ctx: createContext(enrich(txs, accounts), accounts, TODAY),
    balances: [...balance("chk", o.balances.chk), ...balance("sav", o.balances.sav), ...balance("loan", o.balances.loan), ...balance("card", o.balances.card)],
    values,
  };
}

/** The loans household: a 150 000 € mortgage at 1,10 % over 12 month Euribor, 15 000 € saved, card interest every month. */
const LOANS: Opts = {
  pay: 400000,
  toSavings: 30000,
  mortgage: true,
  card: true,
  savingsInterest: 12000,
  balances: { chk: 3000000, sav: 1500000, loan: -15000000, card: -120000 },
  loanRate: { marginBp: 110, reference: "euribor_12" },
};

/** The savings household: 17 000 € never left the checking account, 50 000 € on savings that paid 600 €. */
const SAVINGS: Opts = { pay: 300000, toSavings: 200000, mortgage: false, card: false, savingsInterest: 60000, balances: { chk: 2000000, sav: 5000000 } };

const assess = (o: Opts) => {
  const input = build(o);
  const a = areaInputOf(input);
  return { input, loans: loans.assess(a), savings: savings.assess(a) };
};
const draft = (r: AreaResult, kind: string): FindingDraft | undefined => r.findings.find((f) => f.kind === kind);
const status = (r: AreaResult, kind: string) => r.checks.find((c) => c.id.endsWith(`:${kind}`));
const euros = (f: FindingDraft | undefined) => (f?.euros ? [f.euros.lowCents, f.euros.midCents, f.euros.highCents] : null);
const calc = (f: FindingDraft | undefined) => Object.fromEntries((f?.calc ?? []).map((c) => [c.label, c.value.replace(/[\u00a0\u202f]/g, " ")]));
const plain = (s: string | undefined) => (s ?? "").replace(/[\u00a0\u202f]/g, " ");
const shown = (input: OptimiseInput) => buildOptimise(input).areas.flatMap((v) => v.findings.map((f) => f.id));

describe("the day walk", () => {
  const day = (iso: string) => dayNumber(iso);
  const tx = (id: string, bookingDate: string, amountCents: number, accountId = "chk", status: "booked" | "pending" = "booked"): Transaction => ({
    id,
    accountId,
    bookingDate,
    amountCents,
    currency: "EUR",
    status,
    merchant: "X",
    counterparty: null,
    counterpartyIban: null,
    description: null,
    mcc: null,
    category: "other",
    categorySource: "default",
    isTransfer: false,
  });
  const ctx = createContext(
    [tx("1", "2026-09-01", -10000), tx("2", "2026-09-10", 50000), tx("3", "2026-09-20", -70000), tx("4", "2026-10-02", 1000), tx("5", "2026-10-03", -500, "chk", "pending"), tx("6", "2026-09-12", -20000, "sav")],
    ACCOUNTS.slice(0, 2),
    "2026-10-05",
  );
  const chk: BalanceInput = { id: "chk", name: "Käyttötili", type: "checking", balanceCents: 100000, ownerName: null, balanceAt: "2026-10-01" };

  it("walks back and forward from the given balance, booked rows only", () => {
    const w = balanceWalk(ctx, chk)!;
    // 1 000 € at the end of 1.10.; the row of 2.10. is newer than the balance, the pending row of 3.10. is not counted
    expect([w.at(day("2026-10-01")), w.at(day("2026-10-02")), w.at(day("2026-10-05"))]).toEqual([100000, 101000, 101000]);
    expect([w.at(day("2026-09-19")), w.at(day("2026-09-20")), w.at(day("2026-09-01"))]).toEqual([170000, 100000, 120000]);
    expect(w.at(day("2026-08-31"))).toBeNull();
    expect(balanceWalk(ctx, { ...chk, balanceCents: null })).toBeNull();
    // a balance dated in the future stands for today
    expect(balanceWalk(ctx, { ...chk, balanceAt: "2026-12-01" })!.asOfDay).toBe(day("2026-10-05"));
  });

  it("finds the lowest end-of-day sum and the first day it was reached", () => {
    const w = balanceWalk(ctx, chk)!;
    const sav = balanceWalk(ctx, { ...chk, id: "sav", type: "savings", balanceCents: 30000 })!;
    expect(lowestDayBalance([w], day("2026-09-01"), day("2026-10-05"))).toEqual({ cents: 100000, day: day("2026-09-20") });
    // the start day counts with its own rows
    expect(lowestDayBalance([w], day("2026-09-21"), day("2026-10-05"))).toEqual({ cents: 100000, day: day("2026-09-21") });
    // the savings account is known from its row on 12.9.: 1 700 + 300 then, 1 000 + 300 after 20.9.
    expect(lowestDayBalance([w, sav], day("2026-09-12"), day("2026-10-05"))).toEqual({ cents: 130000, day: day("2026-09-20") });
    expect(lowestDayBalance([w, sav], day("2026-09-11"), day("2026-10-05"))).toBeNull();
    // before its first row an account is unknown, so the lowest is too
    expect(lowestDayBalance([w], day("2026-08-31"), day("2026-10-05"))).toBeNull();
  });

  it("gives the month ends the balance report always gave", () => {
    const report = balanceReport(ctx, { from: "2026-08-01", to: "2026-10-05" }, [chk]);
    expect(report.accounts[0]!.values).toEqual([null, 100000, 101000]);
    expect(report.accounts[0]!.asOf).toBe("2026-10-01");
    expect(report.total).toEqual([null, 100000, 101000]);
  });
});

describe("loans", () => {
  const { input, loans: r } = assess(LOANS);

  it("prices the margin over the sample offers", () => {
    const f = draft(r, "margin")!;
    // 150 000 € × 0,30 / 0,45 / 0,60 points, rounded to 10 €
    expect(euros(f)).toEqual([45000, 68000, 90000]);
    expect(plain(f.title)).toBe("Asuntolainan marginaali 1,1 %, esimerkkitarjouksissa 0,5–0,8 %. Lainaa on jäljellä 150 000 €.");
    expect(calc(f)["Marginaalin 0,1 prosenttiyksikköä"]).toBe("150 € vuodessa");
    expect(calc(f)["Esimerkkitarjousten marginaali (Taloustaito 16.9.2026)"]).toBe("0,5–0,8 %");
    expect(f.weaknesses.map((w) => w.id)).toEqual(["sample"]);
    expect(f.facts).toEqual(["mortgage_margin_sample_low", "mortgage_margin_sample_high"]);
    expect(f.id).toBe(`loans:margin:${f.subject}`);
    expect(f.rows).toHaveLength(12);
  });

  it("prices a prepayment from savings beyond three months of spending", () => {
    const f = draft(r, "prepay")!;
    // usual spending 750 + 900 + 200 + 15 = 1 865 €, so 15 000 − 5 595 = 9 405 € is prepaid. The yield is 120 € over a
    // mean of 13 330 € (0,90 %), the loan 2,187–3,247 % + 1,10 % (mean 2,592 %): 2,387 / 2,792 / 3,447 points
    expect(calc(f)["Ylimääräiset säästöt"]).toBe("9 405 €");
    expect(calc(f)["Säästötilien tuotto"]).toBe("0,9 %");
    expect(calc(f)["Lainan korko"]).toBe("3,29–4,35 %");
    expect(calc(f)["12 kuukauden Euribor 10/2025–9/2026"]).toBe("2,19–3,25 %");
    expect(euros(f)).toEqual([22000, 26000, 32000]);
    expect(plain(f.title)).toBe("Säästötilillä on 9 405 € yli kolmen kuukauden menojen. Lainan korko on 3,29–4,35 %, säästöjen tuotto 0,9 %.");
    expect(f.weaknesses.map((w) => w.id)).toEqual(["estimate"]);
    expect(f.facts).toHaveLength(12);
  });

  it("counts card interest in months the checking account held the whole debt", () => {
    const f = draft(r, "card_interest")!;
    expect(euros(f)).toEqual([18000, 18000, 18000]);
    expect(plain(f.title)).toBe("Luottokortin korkoja maksettiin 180 € 12 kuukautena, joiden alussa ja lopussa käyttötilin saldo kattoi kortin velan.");
    expect(calc(f)["Kortin velka kuun vaihteessa enintään"]).toBe("1 100 €");
    expect(f.rows).toHaveLength(12);
  });

  it("counts purchase interest only, never withdrawal fees or late interest", () => {
    for (const cardCharge of ["NOSTOPALKKIO", "VIIVÄSTYSKORKO", "VIIVASTYSKORKO"]) {
      const r2 = assess({ ...LOANS, cardCharge }).loans;
      expect(draft(r2, "card_interest"), cardCharge).toBeUndefined();
      expect(status(r2, "card_interest")?.status).toBe("clear");
    }
  });

  it("reads the card's interest from its owner: one sum for a card whose rows a second definition would sum otherwise", () => {
    // beside the 15 € of LUOTTOKORKO a month, all in months the checking account covered the card's debt
    const made = assess({
      ...LOANS,
      extra: (add) => {
        // interest the household sorted under bank fees: interest by the bank's word, whatever the category
        add({ bookingDate: "2026-03-12", amountCents: -2200, merchant: "Nordea", description: "KORKO", accountId: "card", category: "fees", categorySource: "user" });
        // 10 € of June's interest the bank took back
        add({ bookingDate: "2026-06-20", amountCents: 1000, merchant: "Nordea", description: "KORKO", accountId: "card" });
        // a bank fee in the interest category that is no interest
        add({ bookingDate: "2026-04-12", amountCents: -300, merchant: "Nordea", description: "NOSTOPALKKIO", accountId: "card" });
      },
    });
    const a = areaInputOf(made.input);
    const costs = cardCosts(a.ctx, a.today);
    expect(costs.months).toEqual(a.months);
    const [card] = costs.cards;
    // 12 × 15 € + 22 € − 10 €; the same rows by category `interest` alone sum to 180 €
    expect(card!.interestCents).toBe(19200);
    expect(card!.feeCents).toBe(300);
    const f = draft(made.loans, "card_interest")!;
    expect(calc(f)["Korot näinä kuukausina"]).toBe("192 €");
    expect(calc(f).Kuukausia).toBe("12");
    expect(euros(f)).toEqual([19200, 19200, 19200]);
    expect(f.rows).toEqual(card!.interestRows);
    expect(f.rows).toHaveLength(13);
  });

  it("sums the margin or the prepayment in the headline, never both: they are the same loan", () => {
    const data = buildOptimise(input);
    expect(draft(r, "prepay")!.claims).toEqual(draft(r, "margin")!.claims);
    // margin 680 € and card interest 180 €; the prepayment's 260 € is the same loan
    expect(data.headline).toMatchObject({ midCents: 68000 + 18000, count: 2 });
  });

  it("shows the three, the margin and the prepayment at keskitaso", () => {
    const data = buildOptimise(input);
    const view = data.areas.find((v) => v.id === "loans")!;
    expect(view.findings.map((f) => [f.kind, f.certainty.level])).toEqual([
      ["margin", "keskitaso"],
      ["card_interest", "korkea"],
      ["prepay", "keskitaso"],
    ]);
  });

  it("stays quiet at a margin of 0,9 % and on a fixed rate", () => {
    expect(draft(assess({ ...LOANS, loanRate: { marginBp: 90, reference: "euribor_12" } }).loans, "margin")).toBeUndefined();
    expect(draft(assess({ ...LOANS, loanRate: { marginBp: 100, reference: "euribor_12" } }).loans, "margin")).toBeDefined();
    const fixed = assess({ ...LOANS, loanRate: { marginBp: 150, reference: "fixed" } }).loans;
    expect([draft(fixed, "margin"), draft(fixed, "prepay")]).toEqual([undefined, undefined]);
    expect(status(fixed, "margin")?.status).toBe("clear");
  });

  it("stays quiet when the savings beyond the buffer are 1 900 €", () => {
    // 3 × 1 865 € + 1 900 € on savings that paid no interest, so only the excess decides
    expect(draft(assess({ ...LOANS, savingsInterest: 0, balances: { ...LOANS.balances, sav: 749500 } }).loans, "prepay")).toBeUndefined();
    expect(draft(assess({ ...LOANS, savingsInterest: 0, balances: { ...LOANS.balances, sav: 759500 } }).loans, "prepay")).toBeDefined();
  });

  it("leaves out interest of months the checking account could not cover", () => {
    // with 14 000 € today the checking account held less than the card's 1 100 € until the end of February 2026
    const low = assess({ ...LOANS, balances: { ...LOANS.balances, chk: 1400000 } });
    const f = draft(low.loans, "card_interest")!;
    expect(euros(f)).toEqual([10500, 10500, 10500]);
    expect(calc(f).Kuukausia).toBe("7");
    // 105 € is under the gate
    expect(shown(low.input)).not.toContain("loans:card_interest");
    // interest only in the months it could not cover: nothing is counted
    const early = assess({ ...LOANS, balances: { ...LOANS.balances, chk: 1400000 }, noInterestIn: monthRange("2026-03", "2026-10") });
    expect(draft(early.loans, "card_interest")).toBeUndefined();
  });

  it("asks for the rate and the loan balance", () => {
    const none = assess({ ...LOANS, loanRate: undefined }).loans;
    expect(status(none, "margin")).toMatchObject({ status: "needs_input", input: "loan_rate" });
    expect(status(none, "prepay")).toMatchObject({ status: "needs_input", input: "loan_rate" });
    const noBalance = assess({ ...LOANS, balances: { ...LOANS.balances, loan: null } }).loans;
    expect(status(noBalance, "margin")).toMatchObject({ status: "no_data", hint: "Lisää lainatilin saldo kohdassa Asetukset > Tilit." });
    expect(draft(noBalance, "margin")).toBeUndefined();
    const noCardBalance = assess({ ...LOANS, balances: { ...LOANS.balances, card: null } }).loans;
    expect(status(noCardBalance, "card_interest")?.status).toBe("no_data");
  });

  it("stays quiet without a mortgage", () => {
    const r2 = assess(SAVINGS).loans;
    expect(r2.findings).toEqual([]);
    expect(r2.checks.map((c) => c.status)).toEqual(["clear", "clear", "clear"]);
  });
});

describe("savings", () => {
  const { input, savings: r } = assess(SAVINGS);

  it("prices the idle checking balance at the household's own yield", () => {
    const f = draft(r, "idle_cash")!;
    // lowest 17 000 € on 8.10.2025, less 750 € of usual spending: 16 250 € × 600 / 38 900 € = 251 €
    expect(calc(f)["Käyttötilien pienin saldo (8.10.2025)"]).toBe("17 000 €");
    expect(calc(f)["Säästötilien keskisaldo kuun lopussa"]).toBe("38 900 €");
    expect(calc(f)["Säästötilien tuotto"]).toBe("1,54 %");
    expect(euros(f)).toEqual([25100, 25100, 25100]);
    expect(plain(f.title)).toBe("Käyttötilillä on ollut 1.10.2025 alkaen vähintään 17 000 €, ja menot ovat tavallisesti 750 € kuussa. Säästötilin tuotto oli 1,54 %.");
    expect(f.weaknesses).toEqual([]);
    expect(buildOptimise(input).areas.find((v) => v.id === "savings")!.findings.map((x) => x.certainty.level)).toEqual(["korkea"]);
  });

  it("counts money spent since the window ended", () => {
    // 18 000 € paid on 2.10.2026 leaves 2 000 € on the account, 1 250 € beyond a month of spending
    const spent = assess({
      ...SAVINGS,
      balances: { ...SAVINGS.balances, chk: 200000 },
      extra: (add) => add({ bookingDate: "2026-10-02", amountCents: -1800000, merchant: "Autoliike Oy", description: "AUTO" }),
    });
    expect(draft(spent.savings, "idle_cash")).toBeUndefined();
  });

  it("stays quiet at 1 900 € idle, a yield under 0,5 %, a stale balance and a gap", () => {
    // the lowest moves with the balance: 17 000 € − 14 350 € = 2 650 € lowest, 1 900 € idle
    expect(draft(assess({ ...SAVINGS, balances: { ...SAVINGS.balances, chk: 2000000 - 1435000 } }).savings, "idle_cash")).toBeUndefined();
    expect(draft(assess({ ...SAVINGS, balances: { ...SAVINGS.balances, chk: 2000000 - 1425000 } }).savings, "idle_cash")).toBeDefined();
    // 150 € over a mean of 38 975 € is 0,38 %
    expect(draft(assess({ ...SAVINGS, savingsInterest: 15000 }).savings, "idle_cash")).toBeUndefined();
    const stale = assess({ ...SAVINGS, balanceAt: "2026-10-07" }).savings;
    expect(status(stale, "idle_cash")).toMatchObject({ status: "no_data", hint: "Käyttötilin saldo on yli 7 päivää vanha." });
    expect(draft(assess({ ...SAVINGS, balanceAt: "2026-10-08" }).savings, "idle_cash")).toBeDefined();
    // three weeks without a row on the checking account in March 2026
    const gap = build({ ...SAVINGS });
    const holed = { ...gap, ctx: createContext(gap.ctx.txs.filter((t) => !(t.accountId === "chk" && t.bookingDate >= "2026-03-02" && t.bookingDate <= "2026-03-21")), ACCOUNTS.slice(0, 2), TODAY) };
    const r2 = savings.assess(areaInputOf(holed));
    expect(status(r2, "idle_cash")?.status).toBe("no_data");
    expect(status(r2, "idle_cash")?.hint).toBe("Tilin Käyttötili tiedoissa on tauko.");
    // a card left unused for three weeks says nothing about the checking account
    const card = build({ ...SAVINGS, card: true, balances: { ...SAVINGS.balances, card: -120000 } });
    const quietCard = { ...card, ctx: createContext(card.ctx.txs.filter((t) => !(t.accountId === "card" && t.bookingDate >= "2026-03-02" && t.bookingDate <= "2026-03-21")), ACCOUNTS.filter((x) => x.id !== "loan"), TODAY) };
    expect(draft(savings.assess(areaInputOf(quietCard)), "idle_cash")).toBeDefined();
  });

  it("never takes the savings leg of a move for interest when only the other leg names the account", () => {
    // the checking leg carries the savings IBAN and is a transfer; the savings leg says KORKO and has no IBAN
    const moved = assess({
      ...SAVINGS,
      savingsInterest: 0,
      extra: (add) => {
        add({ bookingDate: "2025-12-29", amountCents: -60000, merchant: "Siirto", description: "OMA SIIRTO", counterpartyIban: IBAN.sav });
        add({ bookingDate: "2025-12-31", amountCents: 60000, merchant: "Korko", description: "KORKO", accountId: "sav" });
      },
    });
    expect(draft(moved.savings, "idle_cash")).toBeUndefined();
    expect(shown(moved.input)).toEqual([]);
  });

  it("gives no yield over 5 %", () => {
    // 2 000 € over a mean of about 38 700 € is 5,2 %: no deposit account pays that
    const r2 = assess({ ...SAVINGS, savingsInterest: 200000 }).savings;
    expect(draft(r2, "idle_cash")).toBeUndefined();
    expect(status(r2, "idle_cash")?.status).toBe("no_data");
    expect(draft(assess({ ...SAVINGS, savingsInterest: 190000 }).savings, "idle_cash")).toBeDefined();
  });

  it("never takes a move from an own account for interest, and takes off a withholding tax row", () => {
    const moved = assess({
      ...SAVINGS,
      savingsInterest: 0,
      extra: (add) => {
        add({ bookingDate: "2025-12-31", amountCents: -60000, merchant: "Korko", description: "KORKO", counterpartyIban: IBAN.sav });
        add({ bookingDate: "2025-12-31", amountCents: 60000, merchant: "Korko", description: "KORKO", accountId: "sav", counterpartyIban: IBAN.chk });
      },
    });
    expect(draft(moved.savings, "idle_cash")).toBeUndefined();
    // gross 857 € and a withholding row of 257 €: the same 600 € after tax
    const gross = assess({
      ...SAVINGS,
      savingsInterest: 85700,
      extra: (add) => add({ bookingDate: "2025-12-31", amountCents: -25700, merchant: "Lähdevero", description: "LÄHDEVERO", accountId: "sav" }),
    });
    expect(calc(draft(gross.savings, "idle_cash"))["Säästötileille maksettu korko 12 kuukaudessa"]).toBe("600 €");
    expect(euros(draft(gross.savings, "idle_cash"))).toEqual([25100, 25100, 25100]);
  });

  it("asks for the checking balance", () => {
    const r2 = assess({ ...SAVINGS, balances: { chk: null, sav: 5000000 } }).savings;
    expect(status(r2, "idle_cash")).toMatchObject({ status: "no_data", hint: "Lisää käyttötilin saldo kohdassa Asetukset > Tilit." });
  });
});

describe("the loans and savings parts", () => {
  const ids = (h: Household) => allFindings(buildOptimise(householdInput(h))).map((f) => `${f.id.split(":").slice(0, 2).join(":")} ${f.euros?.midCents ?? ""} ${f.certainty.level}`);
  const kinds = (h: Household) => ids(h).map((x) => x.split(" ")[0]!);

  it("each hit makes its findings on the base", () => {
    expect(kinds(joinHousehold([loansPart.hit(FRAME)])).sort()).toEqual(["loans:card_interest", "loans:margin", "loans:prepay"]);
    expect(kinds(joinHousehold([savingsPart.hit(FRAME)]))).toEqual(["savings:idle_cash"]);
  });

  it("the joined household has all four", () => {
    const found = kinds(household());
    for (const id of ["loans:card_interest", "loans:margin", "loans:prepay", "savings:idle_cash"]) expect(found).toContain(id);
  });

  it("every near miss is quiet in every area", () => {
    for (const part of [loansPart, savingsPart]) {
      for (const [i, miss] of part.nearMiss(FRAME).entries()) expect(ids(joinHousehold([miss])), `near miss ${i}`).toEqual([]);
    }
  });
});
