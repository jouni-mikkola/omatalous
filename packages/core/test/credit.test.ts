/**
 * What a connected credit card costs (analysis/credit.ts), the insight that tells the interest
 * (analysis/insights/credit.ts) and the other sentences that must not tell it again. The sums are worked out by hand
 * in each case. How full a card is belongs to loans.ts and is tested in loans.test.ts.
 */
import { describe, expect, it } from "vitest";
import { type AnalysisContext, createContext } from "../src/analysis/context.ts";
import { CARD_COST_MONTHS, cardCosts, isConnectedCard } from "../src/analysis/credit.ts";
import { isBankFee } from "../src/analysis/fees.ts";
import { type Insight, insightInputOf, rankInsights } from "../src/analysis/insights/index.ts";
import type { DateRange } from "../src/analysis/period.ts";
import { addMonths } from "../src/dates.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { type Account, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const today = "2026-10-12";
const checking: Account = { id: "chk", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const gold: Account = { id: "card", name: "Nordea Gold", iban: null, currency: "EUR", type: "credit_card" };
const running: DateRange = { from: "2026-10-01", to: today };
const year: DateRange = { from: "2025-10-01", to: "2026-09-30" };

const on = (month: string, day: number) => `${month}-${String(day).padStart(2, "0")}`;

/**
 * Pay and rent on checking and 400 € of groceries on the card each month from `first` on, the card's bill paid in full
 * on the 10th. From September 2025 the twelve months October 2025 to September 2026 are complete.
 */
function household(first = "2025-09", card = "card"): Transaction[] {
  const out: Transaction[] = [];
  for (let m = first; m <= today.slice(0, 7); m = addMonths(m, 1)) {
    out.push(
      tx({ accountId: "chk", bookingDate: on(m, 1), amountCents: 320000, merchant: "Työnantaja Oy", category: "salary" }),
      tx({ accountId: "chk", bookingDate: on(m, 2), amountCents: -90000, merchant: "Vuokranantaja", category: "housing" }),
      tx({ accountId: card, bookingDate: on(m, 5), amountCents: -40000, merchant: "Prisma", category: "groceries" }),
      tx({ accountId: "chk", bookingDate: on(m, 10), amountCents: -40000, merchant: "Nordea Rahoitus", category: "transfer", isTransfer: true }),
      tx({ accountId: card, bookingDate: on(m, 10), amountCents: 40000, merchant: "Nordea Rahoitus", category: "transfer", isTransfer: true }),
    );
  }
  return out.filter((t) => t.bookingDate <= today);
}

/** Interest on the card on the 3rd of `month`, as the categoriser leaves a row the bank words KORKO. */
const interest = (month: string, cents: number, partial: Partial<Transaction> = {}) =>
  tx({ accountId: "card", bookingDate: on(month, 3), amountCents: -cents, description: "KORKO", merchant: "Korko", category: "interest", ...partial });

/** April to September 2026: six months of interest, 135 € in all. */
const SIX = [1500, 1800, 2100, 2400, 2700, 3000];
const sixMonths = () => SIX.map((cents, i) => interest(addMonths("2026-04", i), cents));

const contextOf = (txs: Transaction[], accounts: Account[] = [checking, gold]) => createContext(txs, accounts, today);
const insightsOf = (ctx: AnalysisContext, range: DateRange = running): Insight[] => rankInsights(insightInputOf(ctx, range, NO_INPUTS));
const insightOf = (ctx: AnalysisContext, range: DateRange = running) => insightsOf(ctx, range).find((i) => i.id === "card-interest");
/** Texts with plain spaces: euro amounts carry no-break spaces. */
const plain = (s: string | undefined) => s?.replace(/[  ]/g, " ");

describe("what a card costs", () => {
  it("a card paid in full every month costs nothing and says nothing", () => {
    const ctx = contextOf(household());
    const { months, cards } = cardCosts(ctx, today);
    expect(months).toHaveLength(CARD_COST_MONTHS);
    expect([months[0], months[11]]).toEqual(["2025-10", "2026-09"]);
    expect(cards).toEqual([{ accountId: "card", name: "Nordea Gold", interestCents: 0, feeCents: 0, interestByMonth: [], carriedMonths: [], interestRows: [], feeRows: [] }]);
    expect(insightOf(ctx)).toBeUndefined();
  });

  it("a card that carries a balance six months: the interest of the six rows", () => {
    const rows = sixMonths();
    const ctx = contextOf([...household(), ...rows]);
    const [card] = cardCosts(ctx, today).cards;
    // 15 + 18 + 21 + 24 + 27 + 30
    expect(card!.interestCents).toBe(13500);
    expect(card!.feeCents).toBe(0);
    expect(card!.carriedMonths).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(card!.interestByMonth).toEqual(SIX.map((cents, i) => ({ month: addMonths("2026-04", i), cents })));
    expect(card!.interestRows).toEqual(rows.map((t) => t.id));

    const i = insightOf(ctx)!;
    expect(plain(i.title)).toBe("Luottokortin korot maksoivat 135 € vuodessa");
    expect(plain(i.detail)).toBe("Nordea Gold: korkoa veloitettiin kuutena kuukautena, lokakuu 2025 – syyskuu 2026.");
    expect(i.yearlyCents).toBe(13500);
    expect(i.tone).toBe("warning");
    expect(i.rows).toEqual(rows.map((t) => t.id));
  });

  it("two interest rows in one month are one carried month", () => {
    const ctx = contextOf([...household(), interest("2026-06", 7000), interest("2026-06", 6000, { bookingDate: "2026-06-28" })]);
    const [card] = cardCosts(ctx, today).cards;
    expect(card!.interestCents).toBe(13000);
    expect(card!.carriedMonths).toEqual(["2026-06"]);
    expect(plain(insightOf(ctx)!.detail)).toBe("Nordea Gold: korkoa veloitettiin yhtenä kuukautena, lokakuu 2025 – syyskuu 2026.");
  });

  it("interest the bank takes back lowers the sum, whatever the row was sorted as", () => {
    const back = (bookingDate: string, cents: number) => tx({ accountId: "card", bookingDate, amountCents: cents, description: "KORKO", merchant: "Korko", category: "other" });
    // July's 24 € comes back in July: the month carried nothing, and 135 € less 24 € is under the insight's gate
    const whole = contextOf([...household(), ...sixMonths(), back("2026-07-15", 2400)]);
    const [card] = cardCosts(whole, today).cards;
    expect(card!.interestCents).toBe(11100);
    expect(card!.carriedMonths).toEqual(["2026-04", "2026-05", "2026-06", "2026-08", "2026-09"]);
    expect(insightOf(whole)).toBeUndefined();
    // a part comes back a month later: the sum is less, the month of the charge still carried
    const late = cardCosts(contextOf([...household(), ...sixMonths(), back("2026-08-20", 1000)]), today).cards[0]!;
    expect(late.interestCents).toBe(12500);
    expect(late.carriedMonths).toHaveLength(6);
    // each month is its charges less what came back in it, so the months add up to the sum: August is 27 € less 10 €
    expect(late.interestByMonth.map((m) => m.cents)).toEqual([1500, 1800, 2100, 2400, 1700, 3000]);
    // more back than was charged is no negative cost, and the month carried nothing
    const over = cardCosts(contextOf([...household(), interest("2026-06", 500), back("2026-06-20", 900)]), today).cards[0]!;
    expect([over.interestCents, over.carriedMonths, over.interestByMonth]).toEqual([0, [], [{ month: "2026-06", cents: -400 }]]);
    // a bill paid into the card is no interest returned
    expect(cardCosts(contextOf([...household(), ...sixMonths()]), today).cards[0]!.interestCents).toBe(13500);
  });

  it("interest worded two ways is interest, a yearly fee and a withdrawal fee are fees, late interest is neither", () => {
    const raw = (month: string, cents: number, description: string) => tx({ accountId: "card", bookingDate: on(month, 3), amountCents: -cents, description, merchant: description });
    const plainKorko = raw("2026-05", 2200, "KORKO");
    const luottokorko = raw("2026-06", 2600, "LUOTTOKORKO 05/2026");
    const yearly = raw("2026-02", 4500, "KORTIN VUOSIMAKSU");
    const withdrawal = raw("2026-07", 300, "NOSTOPALKKIO");
    const late = raw("2026-08", 500, "VIIVÄSTYSKORKO");
    const accounts = [checking, gold];
    const txs = enrichTransactions([...household(), plainKorko, luottokorko, yearly, withdrawal, late], accounts, [], new Map());
    const categoryOf = (t: Transaction) => txs.find((x) => x.id === t.id)!.category;
    expect([plainKorko, luottokorko, yearly, withdrawal].map(categoryOf)).toEqual(["interest", "interest", "fees", "interest"]);

    const ctx = contextOf(txs, accounts);
    const [card] = cardCosts(ctx, today).cards;
    expect(card!.interestCents).toBe(2200 + 2600);
    expect(card!.interestRows).toEqual([plainKorko.id, luottokorko.id]);
    expect(card!.carriedMonths).toEqual(["2026-05", "2026-06"]);
    expect(card!.feeCents).toBe(4500 + 300);
    expect(card!.feeRows).toEqual([yearly.id, withdrawal.id]);
    expect([...card!.interestRows, ...card!.feeRows]).not.toContain(late.id);
  });

  it("counts only rows the fees owner calls a bank charge, each once", () => {
    const ctx = contextOf([...household(), ...sixMonths(), tx({ accountId: "card", bookingDate: "2026-03-03", amountCents: -4500, description: "KORTIN VUOSIMAKSU", merchant: "Nordea", category: "fees" })]);
    const [card] = cardCosts(ctx, today).cards;
    const counted = [...card!.interestRows, ...card!.feeRows];
    expect(counted).toHaveLength(7);
    expect(new Set(counted).size).toBe(7);
    for (const id of counted) expect(isBankFee(ctx.txs.find((t) => t.id === id)!)).toBe(true);
    expect(card!.interestCents + card!.feeCents).toBe(13500 + 4500);
  });

  it("interest of the running month and of a month before the twelve is not counted", () => {
    const ctx = contextOf([...household("2025-08"), interest("2025-09", 9000), interest("2026-10", 9000), interest("2026-01", 2000)]);
    const [card] = cardCosts(ctx, today).cards;
    expect(card!.interestCents).toBe(2000);
    expect(card!.carriedMonths).toEqual(["2026-01"]);
  });

  it("an account that is no card has no card cost: interest on a checking account's credit", () => {
    const overdraft = SIX.map((cents, i) => interest(addMonths("2026-04", i), cents, { accountId: "chk" }));
    const withCard = contextOf([...household(), ...overdraft]);
    expect(cardCosts(withCard, today).cards.map((c) => c.interestCents)).toEqual([0]);
    expect(insightOf(withCard)).toBeUndefined();

    const noCard = contextOf([...household("2025-09", "chk"), ...overdraft], [checking]);
    expect(cardCosts(noCard, today).cards).toEqual([]);
    expect(insightOf(noCard)).toBeUndefined();
  });
});

describe("the card interest insight", () => {
  it("is quiet under 120 € and shows from 120 €", () => {
    expect(insightOf(contextOf([...household(), interest("2026-06", 11999)]))).toBeUndefined();
    const shown = insightOf(contextOf([...household(), interest("2026-06", 12000)]))!;
    expect(plain(shown.title)).toBe("Luottokortin korot maksoivat 120 € vuodessa");
    expect(shown.yearlyCents).toBe(12000);
  });

  it("with fewer complete months names their number and scales nothing up", () => {
    // history from 1.5.2026: May to September are complete
    const ctx = contextOf([...household("2026-05"), ...[6, 7, 8, 9].map((m) => interest(`2026-0${m}`, 3500))]);
    expect(cardCosts(ctx, today).months).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    const i = insightOf(ctx)!;
    expect(plain(i.title)).toBe("Luottokortin korot maksoivat 140 € 5 kuukaudessa");
    expect(plain(i.detail)).toBe("Nordea Gold: korkoa veloitettiin neljänä kuukautena, touko–syyskuu 2026.");
    expect(i.yearlyCents).toBe(14000);
  });

  it("two cards are one line with one sum", () => {
    const visa: Account = { id: "visa", name: "S-Etukortti Visa", iban: null, currency: "EUR", type: "credit_card" };
    const ctx = contextOf([...household(), ...sixMonths(), interest("2026-08", 4000, { accountId: "visa" }), interest("2026-09", 4100, { accountId: "visa" })], [checking, gold, visa]);
    const i = insightOf(ctx)!;
    expect(plain(i.title)).toBe("Luottokorttien korot maksoivat 216 € vuodessa");
    expect(plain(i.detail)).toBe("Nordea Gold ja S-Etukortti Visa: korkoa veloitettiin kuutena kuukautena, lokakuu 2025 – syyskuu 2026.");
    expect(i.yearlyCents).toBe(13500 + 8100);
    expect(i.rows).toHaveLength(8);
  });

  it("ranks by its yearly figure among the others", () => {
    const list = insightsOf(contextOf([...household(), ...sixMonths()]));
    expect(list.map((i) => i.yearlyCents)).toEqual([...list.map((i) => i.yearlyCents)].sort((a, b) => b - a));
    expect(list.some((i) => i.id === "card-interest")).toBe(true);
  });

});

describe("card interest is told once", () => {
  const hasFeesAlert = (range: DateRange, ctx: AnalysisContext) => insightInputOf(ctx, range, NO_INPUTS).alerts!.some((a) => a.kind === "fees");
  /** 10 € a month for the account on checking: with it a period of half a year or more has a bank fees alert. */
  const accountFees = () => household().filter((t) => t.category === "salary").map((t) => tx({ accountId: "chk", bookingDate: `${t.bookingDate.slice(0, 7)}-15`, amountCents: -1000, description: "PALVELUMAKSU", merchant: "Nordea", category: "fees" }));
  /** October 2025 to February 2026: five months of interest, 150 € in all. */
  const winter = () => [0, 1, 2, 3, 4].map((i) => interest(addMonths("2025-10", i), 3000));

  it("the bank fees alert tells the interest when over half of the insight's rows are in its period, and only then", () => {
    const ctx = contextOf([...household(), ...accountFees(), ...winter(), interest("2026-09", 500)]);
    // April to September: the alert sums the account's fees and September's interest, none of the winter's rows
    const half: DateRange = { from: "2026-04-01", to: "2026-09-30" };
    expect(hasFeesAlert(half, ctx)).toBe(true);
    expect(plain(insightOf(ctx, half)?.title)).toBe("Luottokortin korot maksoivat 150 € vuodessa");
    // from January the alert's period holds two of the five rows, from December three
    expect(hasFeesAlert({ from: "2026-01-01", to: "2026-09-30" }, ctx)).toBe(true);
    expect(insightOf(ctx, { from: "2026-01-01", to: "2026-09-30" })).toBeDefined();
    expect(hasFeesAlert({ from: "2025-12-01", to: "2026-09-30" }, ctx)).toBe(true);
    expect(insightOf(ctx, { from: "2025-12-01", to: "2026-09-30" })).toBeUndefined();
    // the whole year: every row is the alert's
    expect(hasFeesAlert(year, ctx)).toBe(true);
    expect(insightOf(ctx, year)).toBeUndefined();
    // the running month has no bank fees alert, so the insight tells it
    expect(hasFeesAlert(running, ctx)).toBe(false);
    expect(insightOf(ctx)).toBeDefined();
  });

  it("has no link: the transaction list cannot be opened on one card's interest rows", () => {
    // a loan's interest paid from checking is in the same category and the same months
    const loanInterest = tx({ accountId: "chk", bookingDate: "2026-06-30", amountCents: -800, description: "LAINAN KORKO", merchant: "Nordea", category: "interest" });
    const rows = sixMonths();
    const i = insightOf(contextOf([...household(), ...rows, loanInterest]))!;
    expect(i.yearlyCents).toBe(13500);
    expect(i.rows).toEqual(rows.map((t) => t.id));
    expect(i.link).toBeUndefined();
  });

  it("the instalments insight leaves the card's interest to the card interest insight", () => {
    const klarna = ["2026-07", "2026-08", "2026-09"].map((m) => tx({ accountId: "chk", bookingDate: on(m, 20), amountCents: -4500, merchant: "Klarna", category: "shopping" }));
    // 24 € of interest on the checking account's credit: no card's, so it stays in the plan's detail
    const overdraft = interest("2026-08", 2400, { accountId: "chk" });
    const list = insightsOf(contextOf([...household(), ...sixMonths(), ...klarna, overdraft]));
    expect(plain(list.find((i) => i.id === "card-interest")?.title)).toBe("Luottokortin korot maksoivat 135 € vuodessa");
    const plan = list.find((i) => i.id === "instalments")!;
    expect(plain(plan.title)).toBe("Klarna: osamaksuja 45 € kuussa");
    // 24 € over 12 months; with the card's 135 € it would read 13 € a month
    expect(plain(plan.detail)).toBe("Sama erä vähintään kolmena kuukautena peräkkäin; korkoja ja luottokuluja 2 € kuussa.");
  });
});

describe("a typed loan and a connected card", () => {
  it("a typed loan is the connected card when it is a card of the same name", () => {
    const account = { type: "credit_card", name: "Nordea Gold", bankName: "NORDEA GOLD MASTERCARD" } as const;
    expect(isConnectedCard({ kind: "card", name: "nordea  gold" }, account)).toBe(true);
    expect(isConnectedCard({ kind: "card", name: "Nordea Gold Mastercard" }, account)).toBe(true);
    expect(isConnectedCard({ kind: "card", name: "Bank Norwegian" }, account)).toBe(false);
    expect(isConnectedCard({ kind: "credit_line", name: "Nordea Gold" }, account)).toBe(false);
    expect(isConnectedCard({ kind: "card", name: "Käyttötili" }, { type: "checking", name: "Käyttötili" })).toBe(false);
  });
});
