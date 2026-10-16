/**
 * MS1 probe: edge cases that try to break filedWithoutAsking (the share of 12 months' spending filed without asking).
 * Written from the brief before the code; copy to packages/core/test/ms1-probe.test.ts. Made-up rows only.
 * Every place the shape was guessed is marked `// API: adjust name`. Cases that rest on a reading of the brief the
 * lead must confirm are marked `DECIDE:`.
 */
import { describe, expect, it } from "vitest";
import * as core from "../src/index.ts";
import * as dq from "../src/analysis/data-quality.ts"; // API: adjust name (module that holds filedWithoutAsking)
import { createContext } from "../src/analysis/context.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

interface Filed {
  share: number;
  guessShare: number;
  userShare: number;
  cents: number;
  totalCents: number;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = { ...core, ...dq } as any;
const filedWithoutAsking = (ctx: unknown): Filed | null => api.filedWithoutAsking(ctx);
/** The text of the lines is in apps/web/test/ms1-probe.test.ts: here only that a range with no spending has no figure. */
const filedLines = (r: Filed | null): string[] => (r ? ["a line"] : []);

const today = "2026-10-16";
/** DECIDE: 12 months back from today, today included: the first day in is 2025-10-17. If the window is whole months, adjust. */
const FIRST_DAY = "2025-10-17";
const DAY_BEFORE = "2025-10-16";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const savings: Account = { id: "sav", name: "Säästötili", iban: null, currency: "EUR", type: "savings" };
const card: Account = { id: "card", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };
const ACCOUNTS = [checking, savings, card];

const ctxOf = (rows: Transaction[], accounts: Account[] = ACCOUNTS) => createContext(rows, accounts, today);
const run = (rows: Transaction[], accounts?: Account[]) => filedWithoutAsking(ctxOf(rows, accounts))!;

/** A purchase on the checking account: money out, filed by `source`. */
const buy = (cents: number, source: Transaction["categorySource"], partial: Partial<Transaction> = {}) =>
  tx({ bookingDate: "2026-06-10", amountCents: -cents, category: source === "default" ? "other" : "groceries", categorySource: source, merchant: "Kauppa Testi Oy", ...partial });

function expectConsistent(r: Filed) {
  expect(Number.isFinite(r.share)).toBe(true);
  expect(r.share).toBeGreaterThanOrEqual(0);
  expect(r.share).toBeLessThanOrEqual(1);
  expect(r.guessShare).toBeGreaterThanOrEqual(0);
  expect(r.userShare).toBeGreaterThanOrEqual(0);
  expect(r.share + r.userShare).toBeLessThanOrEqual(1 + 1e-9);
  expect(r.cents).toBeLessThanOrEqual(r.totalCents);
  if (r.totalCents > 0) expect(r.share).toBeCloseTo(r.cents / r.totalCents, 10);
}

describe("MS1 brief cases", () => {
  it("all filed: share 1, no user part", () => {
    const r = run([buy(10_000, "mcc"), buy(5_000, "rule"), buy(2_500, "merchant")]);
    expectConsistent(r);
    expect(r.share).toBe(1);
    expect(r.cents).toBe(17_500);
    expect(r.totalCents).toBe(17_500);
    expect(r.userShare).toBe(0);
    expect(r.guessShare).toBe(0);
  });

  it("none filed: share 0 of a real total", () => {
    const r = run([buy(10_000, "default"), buy(4_000, "default")]);
    expectConsistent(r);
    expect(r.share).toBe(0);
    expect(r.cents).toBe(0);
    expect(r.totalCents).toBe(14_000);
  });

  it("a user-answered row counts in userShare, not in share", () => {
    const r = run([buy(10_000, "user"), buy(10_000, "rule")]);
    expectConsistent(r);
    expect(r.share).toBeCloseTo(0.5, 10);
    expect(r.userShare).toBeCloseTo(0.5, 10);
    expect(r.cents).toBe(10_000);
    expect(r.totalCents).toBe(20_000);
  });

  it("a row a rule filed and the user then changed counts as the user's", () => {
    // the store keeps one source: the user's change overwrites "rule" with "user"
    const r = run([buy(6_000, "user", { category: "restaurants" }), buy(4_000, "mcc")]);
    expect(r.userShare).toBeCloseTo(0.6, 10);
    expect(r.share).toBeCloseTo(0.4, 10);
  });

  it("an industry (register code or trade word) row counts in share and in guessShare", () => {
    const r = run([buy(10_000, "industry"), buy(10_000, "mcc"), buy(20_000, "default")]);
    expectConsistent(r);
    expect(r.share).toBeCloseTo(0.5, 10);
    expect(r.cents).toBe(20_000);
    // DECIDE: "Näistä arvioita {y} %" reads y as a part of the filed cents (10 000 / 20 000), not of all (0.25)
    expect(r.guessShare).toBeCloseTo(0.5, 10);
  });

  it("every source other than default and user is filed; only industry is a guess", () => {
    const sources: Transaction["categorySource"][] = ["rule", "mcc", "merchant", "industry", "match", "payer"];
    const r = run(sources.map((s) => buy(1_000, s)));
    expect(r.share).toBe(1);
    expect(r.cents).toBe(6_000);
    expect(r.guessShare).toBeCloseTo(1 / 6, 10);
  });

  it("a range with no spending: no share and no line at all", () => {
    const salary = tx({ bookingDate: "2026-06-01", amountCents: 300_000, category: "salary", categorySource: "rule", merchant: "Työnantaja Oy" });
    const r = filedWithoutAsking(ctxOf([salary]));
    if (r) {
      expect(r.totalCents).toBe(0);
      expect(r.share).toBe(0); // never NaN
      expect(Number.isNaN(r.guessShare)).toBe(false);
      expect(Number.isNaN(r.userShare)).toBe(false);
    }
    expect(filedLines(r)).toEqual([]);
    expect(filedLines(filedWithoutAsking(ctxOf([])))).toEqual([]);
  });
});

describe("rows that are not spending stay out of both sums", () => {
  it("an own transfer between accounts is in neither sum", () => {
    const out = tx({ bookingDate: "2026-06-05", amountCents: -50_000, category: "transfer", categorySource: "transfer", isTransfer: true, merchant: "Oma siirto" });
    const r = run([out, buy(10_000, "default"), buy(10_000, "mcc")]);
    expect(r.totalCents).toBe(20_000);
    expect(r.share).toBeCloseTo(0.5, 10);
  });

  it("a savings transfer and a row in a savings category are not spending", () => {
    const out = tx({ bookingDate: "2026-06-05", amountCents: -40_000, category: "transfer", categorySource: "transfer", isTransfer: true, merchant: "Säästöön" });
    const into = tx({ accountId: "sav", bookingDate: "2026-06-05", amountCents: 40_000, category: "transfer", categorySource: "transfer", isTransfer: true, merchant: "Säästöön" });
    const fund = tx({ bookingDate: "2026-06-07", amountCents: -20_000, category: "investments", categorySource: "rule", merchant: "Rahasto Testi" });
    const r = run([out, into, fund, buy(10_000, "default")]);
    expect(r.totalCents).toBe(10_000);
    expect(r.cents).toBe(0);
    expect(r.share).toBe(0);
  });

  it("a connected card: its bill is out and its purchases are in, never both", () => {
    const bill = tx({ bookingDate: "2026-06-20", amountCents: -30_000, category: "card_bill", categorySource: "transfer", isTransfer: true, merchant: "Luottokortin lasku" });
    const paid = tx({ accountId: "card", bookingDate: "2026-06-20", amountCents: 30_000, category: "transfer", categorySource: "transfer", isTransfer: true, merchant: "Maksu" });
    const p1 = tx({ accountId: "card", bookingDate: "2026-06-02", amountCents: -10_000, category: "groceries", categorySource: "mcc", merchant: "Ruokakauppa Testi" });
    const p2 = tx({ accountId: "card", bookingDate: "2026-06-03", amountCents: -20_000, category: "other", categorySource: "default", merchant: "Tuntematon Oy" });
    const r = run([bill, paid, p1, p2]);
    expectConsistent(r);
    expect(r.totalCents).toBe(30_000); // not 60 000
    expect(r.cents).toBe(10_000);
    expect(r.share).toBeCloseTo(1 / 3, 10);
  });

  it("DECIDE: a card bill of a card that is not connected stays in the total but is not filed spending", () => {
    // its purchases are unknown (unknownSpending names it so); a rule that put it in card_bill says nothing of what was bought
    const bill = tx({ bookingDate: "2026-06-20", amountCents: -15_000, category: "card_bill", categorySource: "rule", merchant: "Korttiyhtiö Testi" });
    const r = run([bill, buy(5_000, "mcc")], [checking]);
    expect(r.totalCents).toBe(20_000);
    expect(r.cents).toBe(5_000);
  });

  it("a row a source filed into Muut menot is not filed", () => {
    // "uncategorised" is the category, whatever source left it there
    const r = run([buy(10_000, "mcc", { category: "other" }), buy(10_000, "mcc")]);
    expect(r.cents).toBe(10_000);
    expect(r.share).toBeCloseTo(0.5, 10);
  });
});

describe("money in against a purchase", () => {
  it("a refund of a filed purchase is never counted as unfiled spending", () => {
    const a = buy(10_000, "mcc", { merchant: "Vaatekauppa Testi", category: "shopping", bookingDate: "2026-06-01" });
    const back = tx({ bookingDate: "2026-06-08", amountCents: 10_000, category: "shopping", categorySource: "default", merchant: "Vaatekauppa Testi" });
    const b = buy(5_000, "rule", { bookingDate: "2026-06-02" });
    const r = run([a, back, b]);
    expectConsistent(r);
    expect(r.share).toBe(1);
    expect([15_000, 5_000]).toContain(r.totalCents); // gross or net of the refund
  });

  it("a part refund of an unfiled purchase: the share is of gross or of net, never above 1", () => {
    const c = buy(10_000, "default", { merchant: "Kodinkone Testi", bookingDate: "2026-06-01" });
    const back = tx({ bookingDate: "2026-06-09", amountCents: 4_000, category: "other", categorySource: "default", merchant: "Kodinkone Testi" });
    const b = buy(6_000, "mcc", { bookingDate: "2026-06-02" });
    const r = run([c, back, b]);
    expectConsistent(r);
    expect(r.cents).toBe(6_000);
    expect([16_000, 12_000]).toContain(r.totalCents);
  });

  it("friends' MobilePay shares netted against a filed restaurant bill leave it filed", () => {
    const meal = tx({ bookingDate: "2026-06-12", amountCents: -9_000, category: "restaurants", categorySource: "mcc", merchant: "Ravintola Testi", mcc: "5812" });
    const share1 = tx({ bookingDate: "2026-06-12", amountCents: 3_000, category: "p2p_in", categorySource: "default", merchant: "MobilePay Testi Henkilö", counterparty: "Testi Henkilö", description: "MobilePay ruoka" });
    const share2 = tx({ bookingDate: "2026-06-13", amountCents: 3_000, category: "p2p_in", categorySource: "default", merchant: "MobilePay Toinen Henkilö", counterparty: "Toinen Henkilö", description: "MobilePay ruoka" });
    const r = run([meal, share1, share2]);
    expectConsistent(r);
    expect(r.share).toBe(1);
    expect(r.userShare).toBe(0);
    expect([9_000, 3_000]).toContain(r.totalCents);
  });
});

describe("the 12-month window", () => {
  it("a row on the first day is in, a row on the day before is out", () => {
    const inside = buy(10_000, "default", { bookingDate: FIRST_DAY });
    const outside = buy(99_000, "default", { bookingDate: DAY_BEFORE });
    const r = run([inside, outside, buy(10_000, "mcc", { bookingDate: today })]);
    expect(r.totalCents).toBe(20_000);
    expect(r.share).toBeCloseTo(0.5, 10);
  });

  it("only rows before the window: no spending, no line", () => {
    const r = filedWithoutAsking(ctxOf([buy(10_000, "mcc", { bookingDate: DAY_BEFORE })]));
    if (r) expect(r.totalCents).toBe(0);
    expect(filedLines(r)).toEqual([]);
  });

  it("DECIDE: a pending row counts like a booked one or not at all, never twice", () => {
    const pending = buy(10_000, "default", { status: "pending", bookingDate: "2026-10-15" });
    const r = run([pending, buy(10_000, "mcc")]);
    expectConsistent(r);
    expect([20_000, 10_000]).toContain(r.totalCents);
    expect(r.cents).toBe(10_000);
  });
});

describe("Oma vs Koko talous with a joint account", () => {
  const joint: Account = { id: "joint", name: "Yhteinen", iban: null, currency: "EUR", type: "checking" };
  const theirs: Account = { id: "theirs", name: "Puolison tili", iban: null, currency: "EUR", type: "checking" };
  const whole = () => [
    buy(10_000, "mcc", { accountId: "acc-1" }),
    buy(30_000, "default", { accountId: "theirs" }),
    buy(20_000, "mcc", { accountId: "joint" }),
    buy(10_000, "default", { accountId: "joint" }),
  ];

  it("Koko talous: every account whole", () => {
    const r = run(whole(), [checking, joint, theirs]);
    expect(r.totalCents).toBe(70_000);
    expect(r.cents).toBe(30_000);
    expect(r.share).toBeCloseTo(3 / 7, 10);
  });

  it("Oma talous: the joint account's split rows at the viewer's half, the partner's own account out", () => {
    // a split row: amountCents is the viewer's part, wholeCents the bank's (applyUse cuts it so)
    const own = whole()
      .filter((t) => t.accountId !== "theirs")
      .map((t) => (t.accountId === "joint" ? { ...t, amountCents: t.amountCents / 2, wholeCents: t.amountCents } : t));
    const r = run(own, [checking, joint]);
    expectConsistent(r);
    expect(r.totalCents).toBe(25_000); // 100 + 100 + 50, never the whole 300 of the joint rows
    expect(r.cents).toBe(20_000);
    expect(r.share).toBeCloseTo(0.8, 10);
  });
});
