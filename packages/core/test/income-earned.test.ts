import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { INCOME_TYPES, incomeTypeOf, isEarnedIncome } from "../src/analysis/income.ts";
import { categoryUnderRole, PAYER_ROLES } from "../src/payer-role.ts";
import { getCategory } from "../src/categories.ts";
import { CATEGORIES } from "../src/categories.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };

/** Every row read through the context, so `flows` is the one the reports sum. */
const readAll = (category: string, over: Partial<Transaction> = {}) => {
  const rows = [tx({ bookingDate: "2026-09-10", amountCents: 20000, category, categorySource: "rule", merchant: "Esimerkki Oy", ...over })];
  return createContext(rows, [checking], "2026-10-09").txs[0]!;
};

describe("one owner for earned income", () => {
  it("reads every category the way the income report does: earned exactly when the type is", () => {
    for (const c of CATEGORIES) {
      if (c.kind === "transfer") continue;
      const t = readAll(c.id);
      expect([c.id, t.flows.income !== 0 && INCOME_TYPES[incomeTypeOf(t)].earned]).toEqual([c.id, isEarnedIncome(t)]);
    }
  });

  it("counts salary, benefits, sales, investment income and unknown income, and leaves out money from people and refunds", () => {
    for (const id of ["salary", "benefits", "sales", "investment_income", "income"]) expect([id, isEarnedIncome(readAll(id))]).toEqual([id, true]);
    for (const id of ["p2p_in", "reimbursements"]) expect([id, isEarnedIncome(readAll(id))]).toEqual([id, false]);
  });

  it("leaves out money in on a spending category: a compensation or a person's payment is shown, not earned", () => {
    expect(isEarnedIncome(readAll("groceries", { categorySource: "user" }))).toBe(false);
    expect(isEarnedIncome(readAll("p2p", { categorySource: "user" }))).toBe(false);
  });

  it("reads a row with the role that applies to it as the stored row it becomes: own money out of earned, sales in", () => {
    const wage = readAll("p2p_in");
    expect(isEarnedIncome(wage)).toBe(false);
    expect(isEarnedIncome(wage, "sales")).toBe(true);
    expect(isEarnedIncome(wage, "pay")).toBe(true);
    expect(isEarnedIncome(wage, "gift")).toBe(false);
    expect(isEarnedIncome(wage, "cost_share")).toBe(false);
    expect(isEarnedIncome(readAll("sales"), "own_money")).toBe(false);
    expect(isEarnedIncome(readAll("salary"), "own_money")).toBe(false);
    for (const role of PAYER_ROLES) expect([role, incomeTypeOf(wage, role)]).toEqual([role, incomeTypeOf({ ...wage, category: categoryUnderRole(role, "p2p_in") })]);
    expect(incomeTypeOf(wage, "sales")).toBe("sales");
    expect(incomeTypeOf(wage, "pay")).toBe("salary");
    expect(incomeTypeOf(readAll("benefits", { merchant: "Kela" }), "pay")).toBe("kela_other");
    expect(getCategory("transfer").kind).toBe("transfer");
  });
});
