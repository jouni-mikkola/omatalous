/**
 * Edge cases of coverage judged per account: "no earlier row" and "a year ago" are read from the accounts of the rows
 * a finding is about, not from the oldest row of the whole household. An account connected eight months after another
 * holds no history from before it was connected, so a payer or a subscription on it is neither new nor compared with
 * a year ago. Made-up payees and sums only.
 *
 * A line marked `API: adjust name` guesses a name the change adds: adapt the call there, never the expectation.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import * as coverageApi from "../src/analysis/coverage.ts";
import { incomeBase, incomeChanges } from "../src/analysis/income-changes.ts";
import { commitmentsShare, commitmentsShareOf } from "../src/analysis/insights/commitments.ts";
import { subscriptionChanges } from "../src/analysis/insights/subscriptions.ts";
import type { InsightArgs } from "../src/analysis/insights/types.ts";
import { type Account, NO_INPUTS, type Transaction } from "../src/types.ts";
import { series, tx } from "./helpers.ts";

const today = "2026-10-16";
const A: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const B: Account = { id: "acc-2", name: "Maijan tili", iban: null, currency: "EUR", type: "checking" };
const CARD: Account = { id: "card-1", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };
const ACCOUNTS = [A, B, CARD];

/** One charge or payment on the same day of each month from `first` (YYYY-MM-DD), nothing after today. */
function monthly(first: string, count: number, amountCents: number, partial: Partial<Transaction>): Transaction[] {
  const [y, m, d] = first.split("-").map(Number) as [number, number, number];
  return Array.from({ length: count }, (_, i) => {
    const month = m - 1 + i;
    const date = `${y + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return tx({ ...partial, bookingDate: date, amountCents });
  }).filter((t) => t.bookingDate <= today);
}

/** Groceries every third day on the account from `from` to today: the account's first row is `from`, and it is synced up to today. */
const filler = (accountId: string, from: string) =>
  series(from, 3, Math.floor((Date.parse(today) - Date.parse(from)) / 864e5 / 3) + 1, -3500, { accountId, merchant: "K-Market", category: "groceries", categorySource: "rule" });

const salary = (accountId: string, from: string) =>
  monthly(`${from.slice(0, 7)}-15`, 24, 300000, { accountId, merchant: "Esimerkki Oy", counterparty: "ESIMERKKI OY", description: "PALKKA", category: "salary", categorySource: "rule" });

const ctxOf = (rows: Transaction[]) => createContext(rows, ACCOUNTS, today);
const changesOf = (rows: Transaction[]) => incomeChanges(incomeBase(ctxOf(rows), today), true);
const args = (rows: Transaction[]) => ({ ctx: ctxOf(rows), end: today, inputs: NO_INPUTS, gateMonthlyCents: 1000 }) as unknown as InsightArgs;

describe("accountCovers", () => {
  // A from December 2025, B connected eight months later (its first row 3.8.2026)
  const rows = [...filler("acc-1", "2025-12-01"), ...filler("acc-2", "2026-08-03")];
  const covers = (ids: string[], from: string) => coverageApi.accountCovers(ctxOf(rows), ids, from); // API: adjust name

  it("reads each account from its own first day, with the slack of three days", () => {
    expect(covers(["acc-1"], "2026-01-01")).toBe(true);
    expect(covers(["acc-2"], "2026-01-01")).toBe(false);
    // the first row on the 3rd still covers the month from the 1st; a day in July does not
    expect(covers(["acc-2"], "2026-08-01")).toBe(true);
    expect(covers(["acc-2"], "2026-07-28")).toBe(false);
  });

  it("asks every account it is given: one connected late is enough to say no (the safe side)", () => {
    expect(covers(["acc-1", "acc-2"], "2026-03-01")).toBe(false);
    expect(covers(["acc-1", "acc-2"], "2026-09-01")).toBe(true);
  });

  it("says no for an account with no row at all", () => {
    expect(covers(["card-1"], "2026-09-01")).toBe(false);
  });

  it("follows coverage(): an older deposit account of the same bank vouches for a later one", () => {
    const banked = [{ ...A, bank: "Esimerkkipankki" }, { ...B, bank: "Esimerkkipankki" }, CARD];
    const ctx = createContext(rows, banked, today);
    expect(coverageApi.accountCovers(ctx, ["acc-2"], "2026-01-01")).toBe(true); // API: adjust name
    // a card is never vouched for by a deposit account
    const card = createContext([...rows, ...filler("card-1", "2026-08-03")], [...banked.slice(0, 2), { ...CARD, bank: "Esimerkkipankki" }], today);
    expect(coverageApi.accountCovers(card, ["card-1"], "2026-01-01")).toBe(false); // API: adjust name
  });
});

describe("income events on an account connected later", () => {
  // A from December 2025 with the pay; B connected 3.8.2026
  const base = [...filler("acc-1", "2025-12-01"), ...salary("acc-1", "2025-12-01"), ...filler("acc-2", "2026-08-03")];
  const rent = (accountId: string) => monthly("2026-08-05", 3, 45000, { accountId, merchant: "Esimerkki Asunnot Oy", counterparty: "ESIMERKKI ASUNNOT OY", description: "VUOKRA", category: "income", categorySource: "rule" });

  it("tells no new source for a payer whose only account was connected after its first payment could have been seen", () => {
    expect(changesOf([...base, ...rent("acc-2")]).filter((c) => c.kind === "new_source")).toEqual([]);
  });

  it("near miss: the same payer on the old account is new", () => {
    expect(changesOf([...base, ...rent("acc-1")]).find((c) => c.kind === "new_source")?.payer).toBe("Esimerkki Asunnot Oy");
  });

  const kela = (accountId: string) => monthly("2026-08-26", 2, 30000, { accountId, merchant: "Kela", counterparty: "KELA", description: "KELA ASUMISTUKI", category: "benefits", categorySource: "rule" });

  it("tells no started benefit on the late account, and does not tell it as a new source instead", () => {
    const found = changesOf([...base, ...kela("acc-2")]).filter((c) => c.kind === "benefit_started" || c.kind === "new_source");
    expect(found).toEqual([]);
  });

  it("near miss: the benefit on the old account has started", () => {
    expect(changesOf([...base, ...kela("acc-1")]).some((c) => c.kind === "benefit_started")).toBe(true);
  });

  // a year-ago comparison needs the account from early 2025: A from April 2025, B connected eight months later
  const older = [...filler("acc-1", "2025-04-01"), ...salary("acc-1", "2025-04-01"), ...filler("acc-2", "2025-12-01")];
  const holiday = (accountId: string) => tx({ accountId, merchant: "Esimerkki Oy", counterparty: "ESIMERKKI OY", description: "LOMARAHA", category: "salary", categorySource: "rule", bookingDate: "2026-08-20", amountCents: 200000 });

  it("does not say last year had no holiday pay when the account it came to was not connected a year ago", () => {
    const w = changesOf([...older, holiday("acc-2")]).find((c) => c.kind === "windfall");
    expect(w).toBeDefined();
    expect(w!.detail).not.toBe("Viime vuonna samaan aikaan ei vastaavaa.");
  });

  it("near miss: on the old account it does say so", () => {
    expect(changesOf([...older, holiday("acc-1")]).find((c) => c.kind === "windfall")?.detail).toBe("Viime vuonna samaan aikaan ei vastaavaa.");
  });

  // residual tax: A from May 2025 covers last August; B connected eight months later, 2.1.2026
  const taxBase = [...filler("acc-1", "2025-05-01"), ...salary("acc-1", "2025-05-01"), ...filler("acc-2", "2026-01-02")];
  const tax = (accountId: string) =>
    ["2026-08-10", "2026-10-01"].map((bookingDate) => tx({ accountId, merchant: "Verohallinto", counterparty: "VEROHALLINTO", description: "JÄÄNNÖSVERO 2025", category: "taxes", categorySource: "rule", bookingDate, amountCents: -50000 }));

  it("does not say there was no residual tax last year when the paying account was connected after last August", () => {
    const t = changesOf([...taxBase, ...tax("acc-2")]).find((c) => c.kind === "residual_tax");
    expect(t).toBeDefined();
    expect(t!.detail).not.toBe("Viime vuonna ei jäännösveroa.");
    expect(t!.detail).toMatch(/^Viimeinen erä /);
  });

  it("near miss: paid from the old account, last year is known to have had none", () => {
    expect(changesOf([...taxBase, ...tax("acc-1")]).find((c) => c.kind === "residual_tax")?.detail).toBe("Viime vuonna ei jäännösveroa.");
  });
});

describe("subscriptions on a card connected this year", () => {
  // A from June 2025 (it covers the year and 75 days the comparison needs); the card connected 1.2.2026
  const base = [...filler("acc-1", "2025-06-01"), ...salary("acc-1", "2025-06-01"), ...monthly("2025-06-04", 17, -1199, { merchant: "Spotify", category: "subscriptions", categorySource: "rule" }), ...filler("card-1", "2026-02-01")];
  const subs = (accountId: string) => [
    ...monthly("2026-02-05", 9, -1599, { accountId, merchant: "Netflix", category: "subscriptions", categorySource: "rule" }),
    ...monthly("2026-02-07", 9, -2999, { accountId, merchant: "Storytel", category: "subscriptions", categorySource: "rule" }),
  ];

  it("gives no year comparison that counts the card's subscriptions as added", () => {
    const added = subscriptionChanges(args([...base, ...subs("card-1")])).find((i) => i.id === "subscriptions-added");
    // either no comparison, or one that does not name the card's subscriptions as new
    if (added) expect(added.detail).not.toMatch(/Netflix|Storytel/);
  });

  it("near miss: the same two subscriptions on the old account are added since a year ago", () => {
    const added = subscriptionChanges(args([...base, ...subs("acc-1")])).find((i) => i.id === "subscriptions-added");
    expect(added?.title.replace(/\s/g, " ")).toBe("Tilauksia 3, vuosi sitten 1: +46 € kuussa");
  });

  // the start of the card's own history: its first charges there are not new
  const viaplay = monthly("2026-08-03", 3, -1299, { accountId: "card-1", merchant: "Viaplay", category: "subscriptions", categorySource: "rule" });
  const early = [...filler("acc-1", "2025-06-01"), ...salary("acc-1", "2025-06-01")];

  it("tells no new subscription that began in the first 45 days of the card's history", () => {
    const rows = [...early, ...filler("card-1", "2026-08-01"), ...viaplay];
    expect(subscriptionChanges(args(rows)).filter((i) => i.id.startsWith("new:"))).toEqual([]);
  });

  it("near miss: on a card connected two months before its first charge it is new", () => {
    const rows = [...early, ...filler("card-1", "2026-06-01"), ...viaplay];
    expect(subscriptionChanges(args(rows)).map((i) => i.title.replace(/\s/g, " "))).toContain("Uusi toistuva maksu: Viaplay 12,99 € kuussa");
  });
});

describe("fixed costs a year ago with a card connected later", () => {
  // A from March 2025 with pay and rent; the card connected eight months later, 1.11.2025, pays two insurances from then on
  const base = [
    ...filler("acc-1", "2025-03-01"),
    ...salary("acc-1", "2025-03-01"),
    ...monthly("2025-03-02", 20, -90000, { merchant: "Esimerkki Asunnot Oy", category: "housing", categorySource: "rule" }),
    ...filler("card-1", "2025-11-01"),
  ];
  const bills = (accountId: string) => [
    ...monthly("2025-11-10", 12, -15000, { accountId, merchant: "Esimerkki Vakuutus", category: "insurance", categorySource: "rule" }),
    ...monthly("2025-11-12", 12, -15000, { accountId, merchant: "Esimerkki Netti", category: "telecom", categorySource: "rule" }),
  ];

  it("does not read the card's bills as fixed costs that rose since a year ago", () => {
    expect(commitmentsShare(args([...base, ...bills("card-1")]))).toEqual([]);
    const share = commitmentsShareOf(ctxOf([...base, ...bills("card-1")]), today, NO_INPUTS);
    // a year ago is not told on an account that was not there; when told, it holds the same bills as now
    if (share.then) expect(share.now!.fixedCents - share.then.fixedCents).toBeLessThan(30000);
  });

  it("near miss: the same bills started on the old account are a rise", () => {
    const found = commitmentsShare(args([...base, ...bills("acc-1")]));
    expect(found.map((i) => i.id)).toEqual(["commitments-share"]);
  });
});

// Covers: accountCovers itself (own first day, slack, several accounts, no rows, same-bank vouching, card not vouched).
// Covers: new source, started benefit (and no fall-through to new source), windfall and residual tax on a late account.
// Covers: subscription year count and "new" settle days on a late card, fixed-cost share with a late card; near misses on old accounts.
