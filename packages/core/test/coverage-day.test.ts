/**
 * From which day an account's rows are known (analysis/coverage.ts): the day its record gives, else its first row;
 * a joint account by the earliest of its copies; a card account's purchases by the same day. Made-up data.
 */
import { describe, expect, it } from "vitest";
import { type AccountHistory, createContext } from "../src/analysis/context.ts";
import { coverage } from "../src/analysis/coverage.ts";
import { monthIndex } from "../src/dates.ts";
import type { Account } from "../src/types.ts";
import { tx } from "./helpers.ts";

const TODAY = "2026-10-16";
const month = (day: string) => monthIndex(day);

const account = (id: string, over: Partial<Account> = {}): Account => ({ id, name: id, iban: null, currency: "EUR", type: "checking", bank: "Nordea", ...over });
const row = (accountId: string, bookingDate: string) => tx({ accountId, bookingDate, amountCents: -1_000, category: "groceries" });
const record = (accountId: string, firstRowDay: string | null, over: Partial<AccountHistory> = {}): AccountHistory => ({ accountId, askedFrom: "2026-01-01", firstRowDay, source: "default", ...over });
const ctxOf = (accounts: Account[], rows: ReturnType<typeof row>[], history: AccountHistory[]) => createContext(rows, accounts, TODAY, undefined, [], history);

describe("coverage by day", () => {
  it("knows the day its record gives, also when the view holds no row that old", () => {
    const c = coverage(ctxOf([account("a")], [row("a", "2026-07-10")], [record("a", "2026-02-14")]));
    expect(c.knownFrom("a")).toBe("2026-02-14");
    expect(c.covers("a", month("2026-03-01"))).toBe(true);
    // the month of the day itself began before it
    expect(c.covers("a", month("2026-02-01"))).toBe(false);
    // the first row is still where the account's months with rows begin
    expect(c.began("a")).toBe(month("2026-07-01"));
  });

  it("does not know the day of an account with no record, and then its first row decides", () => {
    const c = coverage(ctxOf([account("a")], [row("a", "2026-07-10")], []));
    expect(c.knownFrom("a")).toBeNull();
    expect(c.covers("a", month("2026-07-01"))).toBe(false);
    expect(c.covers("a", month("2026-08-01"))).toBe(true);
    expect(c.knownFrom("no-such-account")).toBeNull();
    expect(c.covers("no-such-account", month("2026-08-01"))).toBe(false);
  });

  it("takes the day asked from only when the longest history was asked and the bank sent no row", () => {
    const hist = (source: AccountHistory["source"]) => coverage(ctxOf([account("a")], [], [record("a", null, { askedFrom: "2025-10-16", source })]));
    expect(hist("longest").knownFrom("a")).toBe("2025-10-16");
    // near misses: a default fetch that found nothing proves nothing, and a row the bank sent decides over the day asked from
    expect(hist("default").knownFrom("a")).toBeNull();
    expect(hist("csv").knownFrom("a")).toBeNull();
    expect(coverage(ctxOf([account("a")], [], [record("a", "2026-03-01", { askedFrom: "2025-10-16", source: "longest" })])).knownFrom("a")).toBe("2026-03-01");
  });

  it("gives a joint account the earliest day of the copies the members linked", () => {
    const history = [record("joint", "2026-05-03"), record("joint", "2026-01-20"), record("joint", "2026-04-01")];
    const c = coverage(ctxOf([account("joint")], [row("joint", "2026-08-02")], history));
    expect(c.knownFrom("joint")).toBe("2026-01-20");
    expect(c.covers("joint", month("2026-02-01"))).toBe(true);
    // one member's copy without a record leaves the other's day standing
    expect(coverage(ctxOf([account("joint")], [], [record("joint", null), record("joint", "2026-05-03")])).knownFrom("joint")).toBe("2026-05-03");
  });

  it("says from which day a card account's purchases are known, and none for an account that is no card", () => {
    const accounts = [account("card", { type: "credit_card" }), account("chk"), account("card-old", { type: "credit_card" })];
    const c = coverage(ctxOf(accounts, [row("card", "2026-09-01")], [record("card", "2026-06-12"), record("chk", "2026-02-02")]));
    expect(c.purchasesFrom("card")).toBe("2026-06-12");
    expect(c.purchasesFrom("chk")).toBeNull();
    // a card linked before the record: unknown, never its first row
    expect(c.purchasesFrom("card-old")).toBeNull();
    expect(c.knownFrom("chk")).toBe("2026-02-02");
  });

  it("lets a recorded day vouch for another account of the same bank and kind, a card for a card only", () => {
    const accounts = [account("old"), account("new"), account("card", { type: "credit_card" }), account("other-bank", { bank: "OP" })];
    const rows = [row("old", "2026-09-01"), row("new", "2026-09-05"), row("card", "2026-09-05"), row("other-bank", "2026-09-05")];
    const c = coverage(ctxOf(accounts, rows, [record("old", "2026-01-10"), record("card", null)]));
    expect(c.covers("new", month("2026-03-01"))).toBe(true);
    expect(c.covers("card", month("2026-03-01"))).toBe(false);
    expect(c.covers("other-bank", month("2026-03-01"))).toBe(false);
    // the voucher's own day is not the account's record
    expect(c.knownFrom("new")).toBeNull();
  });
});
