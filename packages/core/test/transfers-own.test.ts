// Money between the household's own connected accounts: the savings account, a joint account the bank typed as a loan,
// a payee named by an IBAN the mapper read from a Finnish account number, and a pair held up by Easter.
import { describe, expect, it } from "vitest";
import { detectTransfers } from "../src/transfers.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
const savings: Account = { id: "sav", name: "Säästötili", iban: "FI1410093000123458", currency: "EUR", type: "savings" };
// a joint current account the bank listed as a loan
const joint: Account = { id: "joint", name: "Yhteistili", iban: "FI5542345670000081", currency: "EUR", type: "loan" };
const mortgage: Account = { id: "home", name: "Asuntolaina", iban: "FI7979927990000006", currency: "EUR", type: "loan" };

const out = (accountId: string, bookingDate: string, cents: number, extra: Partial<Transaction> = {}) =>
  tx({ accountId, bookingDate, amountCents: -cents, category: "savings", categorySource: "rule", ...extra });
const into = (accountId: string, bookingDate: string, cents: number, extra: Partial<Transaction> = {}) =>
  tx({ accountId, bookingDate, amountCents: cents, category: "income", categorySource: "default", ...extra });
const shop = (accountId: string, bookingDate: string) => tx({ accountId, bookingDate, amountCents: -4590, category: "groceries", categorySource: "mcc" });

describe("transfers between own connected accounts", () => {
  it("money to the own savings account and its row there are one transfer, also without the payee's IBAN", () => {
    const rows = [out("chk", "2026-03-02", 20000), into("sav", "2026-03-03", 20000)];
    expect(detectTransfers(rows, [checking, savings]).size).toBe(2);
  });

  it("money to a joint account that pays shops is a transfer, even when the bank typed it as a loan", () => {
    const rows = [
      out("chk", "2026-03-02", 50000, { counterpartyIban: joint.iban }),
      into("joint", "2026-03-02", 50000),
      shop("joint", "2026-03-04"),
      shop("joint", "2026-03-05"),
      shop("joint", "2026-03-06"),
    ];
    const found = detectTransfers(rows, [checking, joint]);
    expect([...found].sort()).toEqual([rows[0]!.id, rows[1]!.id].sort());
  });

  it("an instalment to the mortgage account stays debt service: a loan account that pays no shop is still a loan", () => {
    const rows = [
      out("chk", "2026-03-02", 90000, { counterpartyIban: mortgage.iban, category: "mortgage" }),
      into("home", "2026-03-02", 90000),
      shop("home", "2026-03-04"),
      shop("home", "2026-03-05"),
    ];
    expect(detectTransfers(rows, [checking, mortgage]).size).toBe(0);
  });

  it("the same sum on the same day to someone else's account stays spending", () => {
    const rows = [out("chk", "2026-03-02", 20000, { counterpartyIban: "FI4950009420028730", category: "p2p" }), into("sav", "2026-03-02", 20000)];
    expect(detectTransfers(rows, [checking, savings]).size).toBe(0);
  });

  it("a payee's IBAN read from the bank's account number names the own account with no row to pair", () => {
    const rows = [out("sav", "2026-03-02", 61700, { counterpartyIban: "FI2112345600000785" })];
    expect(detectTransfers(rows, [checking, savings]).has(rows[0]!.id)).toBe(true);
  });

  it("a pair over Easter pairs: Good Friday and Easter Monday do not count toward the five days", () => {
    const rows = [out("chk", "2026-04-01", 11000), into("sav", "2026-04-07", 11000)];
    expect(detectTransfers(rows, [checking, savings]).size).toBe(2);
  });

  it("six days with only a weekend between stay apart", () => {
    const rows = [out("chk", "2026-03-04", 11000), into("sav", "2026-03-10", 11000)];
    expect(detectTransfers(rows, [checking, savings]).size).toBe(0);
  });

  it("a row the user put in a category is never a leg", () => {
    const rows = [out("chk", "2026-03-02", 20000, { categorySource: "user" }), into("sav", "2026-03-02", 20000)];
    expect(detectTransfers(rows, [checking, savings]).size).toBe(0);
  });
});
