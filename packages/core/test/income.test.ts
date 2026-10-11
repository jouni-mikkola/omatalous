import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { incomeTypeOf, incomeTypes, isBankingDay, payDate, type PayRule, payDayOf } from "../src/analysis/income.ts";
import { incomeBase, incomeChanges, incomeInsights } from "../src/analysis/income-changes.ts";
import { addDays, addMonths, daysInMonth } from "../src/dates.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";
import { incomeReport } from "../src/reports/income.ts";
import { type Account, NO_INPUTS, type Transaction } from "../src/types.ts";
import { series, tx } from "./helpers.ts";

const ACCOUNTS: Account[] = [{ id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" }];

/** Monthly payments on a pay day rule: `n` months from `first`, amount per index. */
function monthly(first: string, n: number, amount: number | ((i: number) => number), partial: Partial<Transaction>, day = 15, rule: PayRule = "prev"): Transaction[] {
  return Array.from({ length: n }, (_, i) =>
    tx({ ...partial, bookingDate: payDate(addMonths(first, i), { day, rule }), amountCents: typeof amount === "function" ? amount(i) : amount }),
  );
}

const salary = (merchant: string) => ({ merchant, counterparty: merchant, category: "salary", categorySource: "rule" as const });
const kela = (word: string) => ({ merchant: "Kela", counterparty: "KELA", description: `KELA ${word}`, category: "benefits", categorySource: "rule" as const });
/** Card purchases every other day up to `today`, so the sync covers every date the tests look at. */
const filler = (from: string, today: string) => series(from, 2, Math.floor((Date.parse(today) - Date.parse(from)) / 864e5 / 2) + 1, -2500, { merchant: "K-Market", category: "groceries", categorySource: "rule" });

const ctxOf = (rows: Transaction[], today: string) => createContext(rows, ACCOUNTS, today);
const range = (today: string) => ({ from: `${addMonths(today.slice(0, 7), -11)}-01`, to: today });

describe("income types", () => {
  const row = (category: string, text: string, amountCents = 10000) => incomeTypeOf({ category, merchant: text, counterparty: text, description: text, amountCents });

  it("tells every type from a constructed row", () => {
    expect(row("salary", "Yritys Oy PALKKA 09/2026")).toBe("salary");
    expect(row("salary", "Yritys Oy LOMARAHA")).toBe("holiday_pay");
    expect(row("salary", "Yritys Oy LOMAKORVAUS")).toBe("other_pay");
    expect(row("salary", "Hallitus KOKOUSPALKKIO")).toBe("other_pay");
    expect(row("benefits", "KELA ASUMISTUKI 10/2026")).toBe("kela_housing");
    expect(row("benefits", "Kansaneläkelaitos LAPSILISÄ")).toBe("kela_child");
    expect(row("benefits", "KELA OPINTORAHA")).toBe("kela_study");
    expect(row("benefits", "KELA YLEISTUKI")).toBe("kela_general");
    expect(row("benefits", "KELA TYÖMARKKINATUKI")).toBe("kela_general");
    expect(row("benefits", "KELA VANHEMPAINRAHA")).toBe("kela_parental");
    expect(row("benefits", "KELA SAIRAUSPÄIVÄRAHA")).toBe("kela_sickness");
    expect(row("benefits", "KELA KOTIHOIDON TUKI")).toBe("kela_homecare");
    expect(row("benefits", "KELA KANSANELÄKE")).toBe("kela_pension");
    expect(row("benefits", "ELÄKKEENSAAJAN ASUMISTUKI")).toBe("kela_housing");
    // "Kansaneläkelaitos" holds the word eläke: without a benefit word it is Kela's, not a pension
    expect(row("benefits", "Kansaneläkelaitos")).toBe("kela_other");
    expect(row("benefits", "Yleinen työttömyyskassa YTK")).toBe("unemployment_fund");
    expect(row("benefits", "Ilmarinen TYÖELÄKE")).toBe("earnings_pension");
    expect(row("benefits", "Keva")).toBe("earnings_pension");
    expect(row("benefits", "VEROHALLINTO PALAUTUS")).toBe("tax_refund");
    expect(row("benefits", "Kaupunki ELATUSAPU")).toBe("benefit_other");
    expect(row("investment_income", "Nordnet OSINKO")).toBe("investment");
    expect(row("sales", "Vinted")).toBe("sales");
    expect(row("p2p_in", "MobilePay Matti")).toBe("persons");
    expect(row("reimbursements", "Vakuutusyhtiö KORVAUS")).toBe("refunds");
    expect(row("income", "Vuokra")).toBe("other_income");
  });

  it("takes a pension company only as the payer's whole name, never a surname or a month", () => {
    const of = (merchant: string, counterparty: string | null, description: string | null) => incomeTypeOf({ category: "benefits", merchant, counterparty, description, amountCents: 10000 });
    expect(of("Elo Matti", "ELO MATTI", "ELATUSAPU")).toBe("benefit_other");
    expect(of("Kaupunki", "HELSINGIN KAUPUNKI", "TOIMEENTULOTUKI ELO-SYYS")).toBe("benefit_other");
    expect(of("Matti Ilmarinen", "MATTI ILMARINEN", "ELATUSAPU")).toBe("benefit_other");
    expect(of("Elo", "ELO", null)).toBe("earnings_pension");
    expect(of("Elo", "ELO KESKINÄINEN", "MAKSU")).toBe("earnings_pension");
    expect(of("Ilmarinen", "ILMARINEN", null)).toBe("earnings_pension");
    expect(of("Keskinäinen Työeläkevakuutusyhtiö Varma", null, null)).toBe("earnings_pension");
  });

  it("takes a tax refund only from Verohallinto as the payer", () => {
    const of = (merchant: string, counterparty: string | null, description: string | null) => incomeTypeOf({ category: "benefits", merchant, counterparty, description, amountCents: 10000 });
    expect(of("Liisa Virtanen", "LIISA VIRTANEN", "VERONPALAUTUS")).toBe("benefit_other");
    expect(of("Verohallinto", "VEROHALLINTO", "VERONPALAUTUS 2025")).toBe("tax_refund");
    expect(of("Skatteförvaltningen", "SKATTEFÖRVALTNINGEN", null)).toBe("tax_refund");
  });

  it("lets a category the user set win: a Kela row the user called salary is salary", () => {
    expect(row("salary", "KELA ASUMISTUKI")).toBe("salary");
  });

  it("types an extra June payment as holiday pay and a one-off far above the usual as other pay", () => {
    const rows = [
      ...monthly("2025-11", 11, 300000, salary("Yritys Oy")),
      tx({ ...salary("Yritys Oy"), bookingDate: "2026-06-26", amountCents: 145000 }),
    ];
    // March pays 1.6 times the usual; April is back to the usual
    rows.find((t) => t.bookingDate.startsWith("2026-03"))!.amountCents = 480000;
    const ctx = ctxOf(rows, "2026-10-20");
    const types = incomeTypes(ctx.txs);
    expect(types.get(rows.at(-1)!.id)).toBe("holiday_pay");
    expect(types.get(rows.find((t) => t.bookingDate.startsWith("2026-03"))!.id)).toBe("other_pay");
    expect([...types.values()].filter((t) => t === "salary")).toHaveLength(10);
  });

  it("knows Finnish banking days and learns a pay day moved back over a weekend", () => {
    expect(isBankingDay("2026-11-13")).toBe(true);
    expect(isBankingDay("2026-11-15")).toBe(false);
    expect(isBankingDay("2026-06-19")).toBe(false); // midsummer eve
    expect(isBankingDay("2026-04-03")).toBe(false); // good friday
    expect(payDate("2026-11", { day: 15, rule: "prev" })).toBe("2026-11-13");
    expect(payDate("2026-08", { day: 1, rule: "next" })).toBe("2026-08-03");
    const dates = Array.from({ length: 8 }, (_, i) => payDate(addMonths("2026-01", i), { day: 15, rule: "prev" }));
    expect(payDayOf(dates)).toMatchObject({ day: 15, rule: "prev", hits: 8 });
  });
});

describe("what changed", () => {
  const TODAY = "2026-10-20";
  const changesOf = (rows: Transaction[], today = TODAY) => {
    const ctx = ctxOf([...rows, ...filler("2025-06-01", today)], today);
    return incomeChanges(incomeBase(ctx, today), true);
  };

  it("finds a raise once, with the right amount", () => {
    const rows = monthly("2025-09", 14, (i) => (i < 9 ? 300000 : 320000), salary("Yritys Oy"));
    const changes = changesOf(rows).filter((c) => c.payer === "Yritys Oy");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "raise", monthlyCents: 20000, yearlyCents: 240000 });
    expect(changes[0]!.title).toBe("Palkka nousi 200 € kuussa");
  });

  it("finds a raise on net pay that wobbles about 1 %, and nothing in wobble alone", () => {
    const wobble = [0, 3000, -2000, 1500, -2500, 2000, -1000, 2500, 0, -1500, 3000, -2000, 1000, -500];
    const raised = monthly("2025-09", 14, (i) => (i < 9 ? 300000 : 310000) + wobble[i]!, salary("Yritys Oy"));
    expect(changesOf(raised).filter((c) => c.payer === "Yritys Oy").map((c) => c.kind)).toEqual(["raise"]);
    const flat = monthly("2025-09", 14, (i) => 300000 + wobble[i]!, salary("Yritys Oy"));
    expect(changesOf(flat).filter((c) => c.payer === "Yritys Oy" && (c.kind === "raise" || c.kind === "cut"))).toEqual([]);
  });

  it("reads the January of a tax card change by pay period: pay for 1.1.2027 is booked 31.12.2026", () => {
    const rows = monthly("2026-03", 15, (i) => (i < 10 ? 300000 : 310000), salary("Yritys Oy"), 1);
    expect(rows[10]!.bookingDate).toBe("2026-12-31");
    const kinds = changesOf(rows, "2027-05-20").filter((c) => c.payer === "Yritys Oy").map((c) => c.kind);
    expect(kinds).toEqual(["tax_card"]);
  });

  it("shows variable pay by its month-to-month change: an autumn income-limit drop is no range", () => {
    const limit = monthly("2025-08", 15, (i) => (i === 3 || i === 4 ? 260000 : 300000), salary("Yritys Oy"));
    expect(changesOf(limit).filter((c) => c.kind === "variable")).toEqual([]);
    const shifts = [300000, 284000, 341000, 296000, 330000, 288000, 337000, 290000, 325000, 286000, 340000, 300000, 290000, 335000];
    const variable = changesOf(monthly("2025-09", 14, (i) => shifts[i]!, salary("Vuoro Oy"))).find((c) => c.kind === "variable");
    expect(variable?.title).toBe("Palkka vaihteli 2 860–3 410 € kuussa");
  });

  it("calls a January net pay step a tax card change, never a raise", () => {
    const rows = monthly("2025-07", 16, (i) => (i < 6 ? 300000 : 290000), salary("Yritys Oy"));
    const ctx = ctxOf([...rows, ...filler("2025-06-01", TODAY)], TODAY);
    const changes = incomeChanges(incomeBase(ctx, TODAY), true);
    expect(changes.map((c) => c.kind)).toEqual(["tax_card"]);
    expect(changes[0]!.title).toBe("Nettopalkka pieneni 100 € kuussa");
    expect(incomeInsights(ctx, range(TODAY), NO_INPUTS)).toEqual([]);
  });

  it("tells a benefit that ended, with its pay day", () => {
    const rows = monthly("2025-12", 8, 31200, kela("ASUMISTUKI"), 1, "next");
    const ended = changesOf(rows).find((c) => c.kind === "benefit_ended");
    expect(ended).toMatchObject({ type: "kela_housing", monthlyCents: -31200 });
    expect(ended!.title).toBe("Asumistuki päättyi: −312 € kuussa");
    expect(ended!.detail).toBe("Viimeinen maksu 1.7.2026; tuki on tullut kuun ensimmäisenä pankkipäivänä.");
  });

  it("keeps työmarkkinatuki turning into yleistuki one benefit", () => {
    const rows = [...monthly("2025-10", 7, 70000, kela("TYÖMARKKINATUKI"), 7), ...monthly("2026-05", 6, 70000, kela("YLEISTUKI"), 7)];
    expect(changesOf(rows).filter((c) => c.type === "kela_general")).toEqual([]);
  });

  it("tells a payer that changed, not a missing salary or a new source", () => {
    const rows = [...monthly("2025-08", 12, 300000, salary("Vanha Oy"), 15), ...monthly("2026-08", 3, 310000, salary("Uusi Oy"), 25)];
    const changes = changesOf(rows);
    expect(changes.map((c) => c.kind)).toEqual(["payer_changed"]);
    expect(changes[0]).toMatchObject({ payer: "Uusi Oy", monthlyCents: 10000 });
  });

  it("tells a missing salary after its pay day and two banking days", () => {
    const rows = monthly("2025-09", 13, 300000, salary("Yritys Oy"));
    const missing = changesOf(rows).find((c) => c.kind === "missing");
    expect(missing).toBeDefined();
    expect(missing!.title).toBe("Palkka puuttuu, odotettu 15.10.");
    expect(missing!.detail).toContain("tilillä on tapahtumia 20.10.2026 asti");
  });

  it("raises nothing on a pay day moved to Friday, inside the grace or before the sync", () => {
    // 15.11.2026 is a Sunday: the pay came on Friday 13.11.
    const rows = monthly("2025-10", 14, 300000, salary("Yritys Oy"));
    expect(rows.at(-1)!.bookingDate).toBe("2026-11-13");
    expect(changesOf(rows, "2026-11-17").filter((c) => c.kind === "missing")).toEqual([]);
    // the December pay is not in yet on the 16th: two banking days of grace
    expect(changesOf(rows.slice(0, -1), "2026-11-16").filter((c) => c.kind === "missing")).toEqual([]);
    // the account has no rows after the 12th: the sync is behind, so nothing is missing yet
    const ctx = ctxOf([...rows.slice(0, -1), ...filler("2025-06-01", "2026-11-12")], "2026-11-20");
    expect(incomeChanges(incomeBase(ctx, "2026-11-20"), true).filter((c) => c.kind === "missing")).toEqual([]);
  });

  it("finds a new source, and gates small ones", () => {
    const base = monthly("2025-08", 15, 300000, salary("Yritys Oy"));
    const vinted = [tx({ merchant: "Vinted", category: "sales", categorySource: "rule", bookingDate: "2026-08-02", amountCents: 14000 }), tx({ merchant: "Vinted", category: "sales", categorySource: "rule", bookingDate: "2026-09-12", amountCents: 20000 })];
    const found = changesOf([...base, ...vinted]).find((c) => c.kind === "new_source");
    expect(found?.title).toBe("Uusi tulo: Vinted, 340 € kolmessa kuussa");
    const small = vinted.map((t) => ({ ...t, id: `${t.id}s`, amountCents: 2000 }));
    expect(changesOf([...base, ...small]).find((c) => c.kind === "new_source")).toBeUndefined();
  });
});

describe("income report", () => {
  const TODAY = "2026-10-20";
  const household = () => [
    ...monthly("2025-07", 16, 300000, salary("Yritys Oy")),
    ...monthly("2025-07", 16, 9400, kela("LAPSILISÄ"), 26),
    tx({ ...salary("Yritys Oy"), bookingDate: "2026-06-26", amountCents: 145000 }),
    tx({ merchant: "Verohallinto", counterparty: "VEROHALLINTO", category: "benefits", categorySource: "rule", bookingDate: "2026-08-04", amountCents: 64000 }),
    tx({ merchant: "Matti Meikäläinen", category: "p2p_in", categorySource: "rule", bookingDate: "2026-03-03", amountCents: 5000 }),
    tx({ merchant: "Vakuutusyhtiö", category: "reimbursements", categorySource: "rule", bookingDate: "2026-04-10", amountCents: 12000 }),
    tx({ merchant: "Nordnet", category: "investment_income", categorySource: "rule", bookingDate: "2026-05-20", amountCents: 3300 }),
    ...filler("2025-06-01", TODAY),
  ];

  it("leaves money from people and refunds out of earned income", () => {
    const r = incomeReport(ctxOf(household(), TODAY), range(TODAY));
    expect(r.notEarnedCents).toBe(17000);
    const all = r.months.reduce((s, m) => s + m.totalCents, 0);
    expect(r.earnedCents + r.notEarnedCents).toBe(all);
    // and the income of the same twelve months in the money flows: Ansiotulot and Tulot differ by what is not earned
    const ctx = ctxOf(household(), TODAY);
    const window = new Set(r.months.map((m) => m.month));
    expect(r.earnedCents + r.notEarnedCents).toBe(ctx.txs.filter((t) => window.has(t.bookingDate.slice(0, 7))).reduce((s, t) => s + t.flows.income, 0));
    expect(r.types.find((t) => t.type === "persons")).toMatchObject({ earned: false, share: null });
    expect(r.types.map((t) => t.type)).toEqual(["salary", "holiday_pay", "kela_child", "tax_refund", "investment", "persons", "refunds"]);
  });

  it("adds up to the cash flow income, month by month and over the year", () => {
    const ctx = ctxOf(household(), TODAY);
    const r = incomeReport(ctx, range(TODAY));
    const from = `${r.months[0]!.month}-01`;
    const last = r.months.at(-1)!.month;
    const cash = cashflowReport(ctx, { from, to: `${last}-${daysInMonth(last)}` });
    expect(r.months.map((m) => m.totalCents)).toEqual(cash.rows.map((x) => x.incomeCents));
    expect(r.months.reduce((s, m) => s + m.totalCents, 0)).toBe(cash.totals.incomeCents);
    for (const m of r.months) expect(Object.values(m.byGroup).reduce((s, v) => s + v, 0)).toBe(m.totalCents);
  });

  it("tells stability from regular income, the next twelve months and the pay days", () => {
    const r = incomeReport(ctxOf(household(), TODAY), range(TODAY));
    expect(r.stability).toMatchObject({ medianCents: 309400, spread: 0, lowShare: 0, worstRunWeeks: 0 });
    expect(r.projection).toHaveLength(12);
    expect(r.projection[0]).toMatchObject({ month: "2026-10", byGroup: { salary: 300000, kela: 9400 } });
    expect(r.markers.map((m) => [m.month, m.label])).toEqual([
      ["2027-06", "Lomaraha"],
      ["2027-08", "Veronpalautus"],
    ]);
    expect(r.payDays.map((p) => [p.label, p.text, p.nextDate])).toEqual([
      ["Palkka", "15. päivä tai sitä edeltävä pankkipäivä", "2026-11-13"],
      ["Lapsilisä", "26. päivä tai sitä edeltävä pankkipäivä", "2026-10-26"],
    ].sort((a, b) => (a[2]! < b[2]! ? -1 : 1)));
  });

  it("counts stability by pay period: pay for the 1st booked on the last day of the month before is no gap", () => {
    const rows = [...monthly("2025-07", 16, 300000, salary("Yritys Oy"), 1), ...filler("2025-06-01", TODAY)];
    expect(rows.some((t) => t.bookingDate.endsWith("-31") || t.bookingDate.endsWith("-30"))).toBe(true);
    const r = incomeReport(ctxOf(rows, TODAY), range(TODAY));
    expect(r.stability).toMatchObject({ medianCents: 300000, spread: 0, lowShare: 0, worstRunWeeks: 0 });
  });

  it("needs twelve complete months for stability and three for the composition", () => {
    const rows = [...monthly("2026-07", 4, 300000, salary("Yritys Oy")), ...filler("2026-07-01", TODAY)];
    const r = incomeReport(ctxOf(rows, TODAY), range(TODAY));
    expect(r.enough).toBe(true);
    expect(r.completeMonths).toBe(3);
    expect(r.stability).toBeNull();
    expect(r.previousEarnedCents).toBeNull();
    const early = incomeReport(ctxOf(rows.filter((t) => t.bookingDate >= "2026-08-01"), TODAY), range(TODAY));
    expect(early.enough).toBe(false);
  });

  it("splits by member only by whose account it is, and keeps a joint account whole", () => {
    const rows = [...monthly("2025-10", 13, 300000, salary("Yritys Oy")), ...monthly("2025-10", 13, 200000, { ...salary("Toinen Oy"), accountId: "acc-2" }), ...monthly("2025-10", 13, 9400, { ...kela("LAPSILISÄ"), accountId: "acc-3" }, 26)];
    const ctx = createContext([...rows, ...filler("2025-06-01", TODAY)], [...ACCOUNTS, { ...ACCOUNTS[0]!, id: "acc-2", name: "Maijan tili" }, { ...ACCOUNTS[0]!, id: "acc-3", name: "Käyttötili" }], TODAY);
    // the server appends the owner to a shared account's name and flags a joint account both partners linked
    const balances = [
      { id: "acc-1", name: "Käyttötili", type: "checking" as const, balanceCents: 0, ownerName: null, balanceAt: null },
      { id: "acc-2", name: "Maijan tili (Maija)", type: "checking" as const, balanceCents: 0, ownerName: "Maija", balanceAt: null },
      { id: "acc-3", name: "Käyttötili", type: "checking" as const, balanceCents: 0, ownerName: null, balanceAt: null, joint: true },
      { id: "acc-4", name: "Yhteinen tili (Maija)", type: "savings" as const, balanceCents: 0, ownerName: "Maija", balanceAt: null },
    ];
    const r = incomeReport(ctx, range(TODAY), balances);
    expect(r.members?.map((m) => [m.label, m.earnedCents])).toEqual([
      ["Omat tilit", 300000 * 12],
      ["Maija", 200000 * 12],
      ["Yhteinen tili", 9400 * 12],
    ]);
    expect(incomeReport(ctx, range(TODAY)).members).toBeNull();
  });

  it("writes titles with the number and no verdict words", () => {
    const ctx = ctxOf([...monthly("2025-09", 14, (i) => (i < 9 ? 300000 : 320000), salary("Yritys Oy")), ...filler("2025-06-01", TODAY)], TODAY);
    for (const c of incomeReport(ctx, range(TODAY)).changes) {
      expect(c.title).toMatch(/\d/);
      expect(c.title.split(" ").length).toBeLessThanOrEqual(8);
      expect(`${c.title} ${c.detail}`).not.toMatch(new RegExp(`kannattaa|muista|riittävä|paljon|${String.fromCharCode(0x2014)}`, "i"));
    }
  });
});

it("is pure: the same history gives the same answer", () => {
  const rows = [...monthly("2025-09", 14, 300000, salary("Yritys Oy")), ...filler("2025-06-01", "2026-10-20")];
  const a = incomeReport(ctxOf(rows, "2026-10-20"), range("2026-10-20"));
  const b = incomeReport(ctxOf(rows, "2026-10-20"), range("2026-10-20"));
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  expect(addDays("2026-10-20", 0)).toBe("2026-10-20");
});
