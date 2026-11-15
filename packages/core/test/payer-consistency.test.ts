// One payer, one reading: money in from the same named payer lands in one category unless the user, a reference or a
// payment's return says otherwise.
import { describe, expect, it } from "vitest";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const account: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking", holder: "KORHONEN TEUVO" };
const PAYER = "LEHTONEN AINO";

const from = (month: number, description: string | null, extra: Partial<Transaction> = {}) =>
  tx({ accountId: "chk", bookingDate: `2026-${String(month).padStart(2, "0")}-12`, amountCents: 4000, counterparty: PAYER, description, merchant: PAYER, category: "income", ...extra });

const run = (rows: Transaction[], rules: Parameters<typeof enrichTransactions>[2] = []) => {
  const changed = new Map(enrichTransactions(rows, [account], rules).map((t) => [t.id, t]));
  return rows.map((t) => changed.get(t.id) ?? t);
};

describe("money in from one payer", () => {
  it("lands in one category when some rows say Siirto-maksu and others carry a free message", () => {
    const rows = [from(1, "Siirto-maksu"), from(2, "Siirto-maksu"), from(3, "Siirto-maksu"), from(4, "kiitos viime viikosta"), from(5, null), from(6, "kiitos")];
    const final = run(rows);
    expect(new Set(final.map((t) => t.category))).toEqual(new Set(["p2p_in"]));
  });

  it("reads a payer by its merchant: another merchant is another payer", () => {
    const rows = [from(1, "Siirto-maksu"), from(2, "Siirto-maksu"), from(3, "terveisin", { merchant: "Aino L" })];
    expect(run(rows)[2]!.category).toBe("income");
  });

  it("leaves a row with a reference number alone", () => {
    const rows = [from(1, "Siirto-maksu"), from(2, "Siirto-maksu"), from(3, "lasku", { reference: "4471" })];
    expect(run(rows)[2]!.category).toBe("income");
  });

  it("leaves a row the user filed, and every row when the recognised ones are no majority", () => {
    const filed = [from(1, "Siirto-maksu"), from(2, "Siirto-maksu"), from(3, "vapaa teksti", { category: "gifts", categorySource: "user" })];
    expect(run(filed)[2]!.category).toBe("gifts");
    const split = [from(1, "Siirto-maksu"), from(2, "PALKKA TOUKOKUU"), from(3, "vapaa teksti")];
    expect(run(split)[2]!.category).toBe("income");
  });

  it("needs two rows a rule decided: one is no pattern", () => {
    expect(run([from(1, "Siirto-maksu"), from(2, "vapaa teksti")])[1]!.category).toBe("income");
    expect(run([from(1, "Siirto-maksu"), from(2, "Siirto-maksu"), from(3, "vapaa teksti")])[2]!.category).toBe("p2p_in");
  });

  it("never turns the free messages into pay, whatever most of the decided rows say", () => {
    const final = run([from(1, "PALKKA TOUKOKUU"), from(2, "PALKKA KESAKUU"), from(3, "PALKKA HEINAKUU"), from(4, "vapaa teksti")]);
    expect(final[3]!.category).toBe("income");
  });

  it("a tie decides nothing, and a row added beside it moves only the undecided rows", () => {
    const tie = [from(1, "Siirto-maksu"), from(2, "Siirto-maksu"), from(3, "PALKKA TOUKOKUU"), from(4, "PALKKA KESAKUU"), from(5, "vapaa teksti")];
    const before = run(tie);
    expect(before[4]!.category).toBe("income");
    const after = run([...tie, from(6, "Siirto-maksu")]);
    expect(after.slice(0, 4).map((t) => t.category)).toEqual(before.slice(0, 4).map((t) => t.category));
    expect(after[4]!.category).toBe("p2p_in");
  });

  it("does not move another payer's rows, nor a payer who has no name of two words", () => {
    const rows = [from(1, "Siirto-maksu"), from(2, "Siirto-maksu"), from(3, "kiitos", { counterparty: "LEHTONEN VEIKKO", merchant: "LEHTONEN VEIKKO" }), from(4, "kiitos", { counterparty: "KELA", merchant: "KELA" })];
    const final = run(rows);
    expect(final[2]!.category).toBe("income");
    expect(final[3]!.category).not.toBe("p2p_in");
  });
});
