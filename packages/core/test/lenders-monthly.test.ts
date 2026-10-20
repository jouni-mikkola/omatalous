/**
 * Every lender paid each month is a debt the household sees: four made-up lenders, one by the word list, one by the
 * shape of its name, one small and one paid on no steady day, each get a proposal, count in the fixed costs and stand
 * beside the debt total until saved. An ended run tells its first and last row and their sum. Made-up names and sums.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { formatEur } from "../src/analysis/format.ts";
import { stoppedPayments } from "../src/analysis/insights/stopped.ts";
import type { InsightArgs } from "../src/analysis/insights/types.ts";
import { addMonths } from "../src/dates.ts";
import { lenderInstalments, loanProposals, notLoanMark } from "../src/loan-detect.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { type Account, type Loan, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { withoutSwedishTwin } from "../src/wording-lenders.ts";
import { tx } from "./helpers.ts";

const TODAY = "2026-10-18";
const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking", holder: "ESIMERKKI ERKKI" };

/** A row as the server stores it: the reference is a field of its own, which the core type does not name. */
function row(counterparty: string, description: string | null, euros: number, date: string, reference: string | null): Transaction {
  const t = tx({ accountId: "chk", bookingDate: date, amountCents: Math.round(euros * 100), counterparty, counterpartyIban: "FI4950009420028731", description, merchant: normalizeMerchant(counterparty, description) });
  return { ...t, reference } as Transaction;
}

/** One payment a month, the last `count - 1 + ended` months after the first and `ended` months before October 2026. */
const monthly = (count: number, euros: number, counterparty: string, description: string | null, x: { reference?: (i: number) => string | null; day?: (i: number) => number; ended?: number } = {}) =>
  Array.from({ length: count }, (_, i) =>
    row(counterparty, description, euros, `${addMonths("2026-10", i - (count - 1) - (x.ended ?? 0))}-${String(x.day?.(i) ?? 15).padStart(2, "0")}`, x.reference?.(i) ?? null),
  );

/** A consumer lender of the word list: its invoice brings a new reference each month. */
const listed = monthly(10, -120, "IKANO BANK AB", "LASKU", { reference: (i) => `1000${i}3` });
/** A bank's loan payee known by the shape of its name, with the bank's Swedish word beside the Finnish one. */
const shaped = monthly(18, -421.82, "ESIMERKKI LAINAT LÅN", null, { reference: (i) => `2000${i}6` });
/** A small instalment to a finance company. */
const small = monthly(12, -46, "MALLI RAHOITUS OY", "LASKU", { reference: () => "00000 44512 00019" });
/** A finance company paid each month on no steady day: the 2nd one month, the 27th the next. */
const uneven = monthly(12, -215.8, "ESIMERKKI FINANS AB", null, { day: (i) => (i % 2 ? 2 : 27) });

function contextOf(rows: Transaction[]) {
  const accounts = [checking];
  const changed = new Map(enrichTransactions(rows, accounts, []).map((t) => [t.id, t]));
  return createContext(rows.map((t) => changed.get(t.id) ?? t), accounts, TODAY);
}

const all = [...listed, ...shaped, ...small, ...uneven];
const MONTHLY = 12000 + 42182 + 4600 + 21580;

describe("lenders paid each month", () => {
  it("proposes a loan for each of the four lenders", () => {
    const proposals = loanProposals(contextOf(all), NO_INPUTS);
    expect(proposals.map((p) => [p.payee, p.paymentCents])).toEqual([
      ["Esimerkki Lainat", 42182],
      ["Esimerkki Finans Ab", 21580],
      ["Ikano Bank Ab", 12000],
      ["Malli Rahoitus Oy", 4600],
    ]);
  });

  it("counts every lender in the fixed costs", () => {
    const ctx = contextOf(all);
    expect(buildDashboard(ctx, { from: "2026-10-01", to: TODAY }).fixedMonthlyCents).toBe(MONTHLY);
  });

  it("tells the four beside the debt total until they are saved or marked", () => {
    const ctx = contextOf(all);
    expect(buildDashboard(ctx, { from: "2026-10-01", to: TODAY }).holdings.unsavedLoans).toEqual({ count: 4, paymentCents: MONTHLY });
    const marked: UserInputs = { ...NO_INPUTS, marks: loanProposals(ctx, NO_INPUTS).map((p) => ({ ...notLoanMark(p), markedAt: "2026-10-18T10:00:00Z" })) };
    expect(buildDashboard(ctx, { from: "2026-10-01", to: TODAY }, [], marked).holdings.unsavedLoans).toBeUndefined();
  });

  it("reads a lender on no steady day as one monthly run, and none of a lender paid twice in most months", () => {
    expect(lenderInstalments(contextOf(uneven)).map((s) => [s.typicalAmountCents, s.occurrences, s.active])).toEqual([[21580, 12, true]]);
    const twice = [...uneven, ...monthly(12, -215.8, "ESIMERKKI FINANS AB", null, { day: (i) => (i % 2 ? 9 : 20) })];
    expect(lenderInstalments(contextOf(twice))).toEqual([]);
  });

  it("asks for one reference of a payee that is no lender", () => {
    const shop = monthly(10, -120, "ESIMERKKI KAUPPA OY", "LAINA", { reference: (i) => `1000${i}3` });
    expect(loanProposals(contextOf(shop), NO_INPUTS)).toEqual([]);
  });

  it("proposes a loan for Resurs Bank paid monthly with a new reference each time, and none for an instalment service of varying sums", () => {
    const resurs = monthly(10, -80, "RESURS BANK AB", "LASKU", { reference: (i) => `3000${i}1` });
    expect(loanProposals(contextOf(resurs), NO_INPUTS).map((p) => p.paymentCents)).toEqual([8000]);
    const service = Array.from({ length: 10 }, (_, i) => row("KLARNA BANK AB", "LASKU", -(60 + 7 * i), `${addMonths("2026-10", i - 9)}-15`, `3000${i}1`));
    expect(loanProposals(contextOf(service), NO_INPUTS)).toEqual([]);
  });
});

describe("a saved loan with a typed payment and no series linked", () => {
  const rows = monthly(12, -300, "ESIMERKKI RAHOITUS OY", "LAINA", { reference: () => "11112" });
  const saved = (paymentCents: number): Loan => ({
    id: "l1", name: "Autolaina", lender: "Esimerkki Rahoitus", kind: "car", grantedCents: null, balanceCents: 500_000, balanceDate: "2026-10-01",
    rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents, endDate: null, limitCents: null, seriesKey: null,
  });

  it("takes the series its payment fits: no proposal and no loan without a balance beside the debt", () => {
    const ctx = contextOf(rows);
    const inputs: UserInputs = { ...NO_INPUTS, loans: [saved(30_000)] };
    expect(loanProposals(ctx, inputs)).toEqual([]);
    expect(buildDashboard(ctx, { from: "2026-10-01", to: TODAY }, [], inputs).holdings.unsavedLoans).toBeUndefined();
  });

  it("leaves a series of another payment proposed", () => {
    const ctx = contextOf(rows);
    const inputs: UserInputs = { ...NO_INPUTS, loans: [saved(45_000)] };
    expect(loanProposals(ctx, inputs).map((p) => p.paymentCents)).toEqual([30_000]);
    expect(buildDashboard(ctx, { from: "2026-10-01", to: TODAY }, [], inputs).holdings.unsavedLoans).toEqual({ count: 1, paymentCents: 30_000 });
  });

  it("takes one series of two that fit", () => {
    const other = monthly(12, -300, "MALLI RAHOITUS OY", "LAINA", { reference: () => "22223", day: () => 20 });
    expect(loanProposals(contextOf([...rows, ...other]), { ...NO_INPUTS, loans: [saved(30_000)] })).toHaveLength(1);
  });
});

describe("an ended lender", () => {
  // one lender, two loans: 300 € since May 2025 and 450 € since December 2025, both last paid in July 2026
  const first = monthly(15, -300, "ESIMERKKI RAHOITUS OY", "LAINA 1", { ended: 3, reference: () => "11112" });
  const second = monthly(8, -450, "ESIMERKKI RAHOITUS OY", "LAINA 2", { ended: 3, day: () => 20, reference: () => "22223" });

  it("tells the run's first and last row and the sum of all of them, once", () => {
    // the account books on after the last payment: a stop is counted to its last row
    const ctx = contextOf([...first, ...second, row("ESIMERKKIMARKET", "OSTO", -42.5, "2026-10-16", null)]);
    const found = stoppedPayments({ ctx, end: TODAY, gateMonthlyCents: 0 } as unknown as InsightArgs);
    expect(found).toHaveLength(1);
    expect(found[0]!.detail).toBe(`Viimeinen maksu 20.7.2026, 23 maksua 15.5.2025 alkaen, yhteensä ${formatEur(15 * 30000 + 8 * 45000)}.`);
    expect(found[0]!.rows).toHaveLength(23);
  });

  it("counts no loan of the same lender that ended years before", () => {
    // 300 € a month through 2021, then 450 € a month from May 2025 to July 2026
    const old = Array.from({ length: 12 }, (_, i) => row("ESIMERKKI RAHOITUS OY", "LAINA", -300, `2021-${String(i + 1).padStart(2, "0")}-15`, "11112"));
    const ctx = contextOf([...old, ...monthly(15, -450, "ESIMERKKI RAHOITUS OY", "LAINA", { ended: 3, reference: () => "11112" }), row("ESIMERKKIMARKET", "OSTO", -42.5, "2026-10-16", null)]);
    const found = stoppedPayments({ ctx, end: TODAY, gateMonthlyCents: 0 } as unknown as InsightArgs);
    expect(found.map((i) => i.detail)).toEqual([`Viimeinen maksu 15.7.2026, 15 maksua 15.5.2025 alkaen, yhteensä ${formatEur(15 * 45000)}.`]);
  });

  it("keeps a run whole across a payment skipped once", () => {
    const run = monthly(15, -450, "ESIMERKKI RAHOITUS OY", "LAINA", { ended: 3, reference: () => "11112" }).filter((_, i) => i !== 6);
    const ctx = contextOf([...run, row("ESIMERKKIMARKET", "OSTO", -42.5, "2026-10-16", null)]);
    const found = stoppedPayments({ ctx, end: TODAY, gateMonthlyCents: 0 } as unknown as InsightArgs);
    expect(found.map((i) => i.detail)).toEqual([`Viimeinen maksu 15.7.2026, 14 maksua 15.5.2025 alkaen, yhteensä ${formatEur(14 * 45000)}.`]);
  });
});

describe("a payee's Swedish twin word", () => {
  it("drops the bank's Swedish word beside the Finnish one", () => {
    expect(withoutSwedishTwin("Esimerkki Lainat Lån")).toBe("Esimerkki Lainat");
    expect(withoutSwedishTwin("Esimerkki Luotto Kredit")).toBe("Esimerkki Luotto");
  });
  it("keeps a Swedish word that stands alone", () => {
    expect(withoutSwedishTwin("Esimerkki Lån")).toBe("Esimerkki Lån");
    expect(withoutSwedishTwin("Lån")).toBe("Lån");
  });
});
