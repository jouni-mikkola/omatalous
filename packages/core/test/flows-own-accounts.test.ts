/**
 * Money-flow scenarios for money between the household's own connected accounts (flows.test.ts is at its size cap):
 * raw bank rows → categorise → transfer detection → flows, each movement in one flow or neutral.
 */
import { describe, expect, it } from "vitest";
import { type Flows, flowsOf } from "../src/analysis/flows.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
const savings: Account = { id: "sav", name: "Säästötili", iban: "FI1410093000123458", currency: "EUR", type: "savings" };
const joint: Account = { id: "joint", name: "Yhteistili", iban: "FI5542345670000081", currency: "EUR", type: "loan" };

const row = (accountId: string, bookingDate: string, euros: number, description: string, extra: Partial<Transaction> = {}) =>
  tx({ accountId, bookingDate, amountCents: Math.round(euros * 100), description, merchant: normalizeMerchant(null, description), ...extra });

function run(rows: Transaction[], accounts: Account[]) {
  const changed = new Map(enrichTransactions(rows, accounts, []).map((t) => [t.id, t]));
  const savingsIds = new Set(accounts.filter((a) => a.type === "savings").map((a) => a.id));
  const loanIds = new Set(accounts.filter((a) => a.type === "loan").map((a) => a.id));
  return (description: string) => {
    const raw = rows.find((r) => r.description === description)!;
    const t = changed.get(raw.id) ?? raw;
    return { t, flows: flowsOf(t, savingsIds, loanIds) };
  };
}

const neutral: Flows = { consumption: 0, debt: 0, saved: 0, income: 0, borrowed: 0 };

describe("own accounts", () => {
  it("savings to the own account, money to the joint account and the Easter pair are transfers; a stranger's same sum is spending", () => {
    const rows = [
      row("chk", "2026-03-02", -200, "Säästöön maaliskuu"),
      row("sav", "2026-03-03", 200, "Säästöön maaliskuu tulo"),
      row("chk", "2026-03-10", -500, "Yhteiset kulut", { counterpartyIban: joint.iban }),
      row("joint", "2026-03-10", 500, "Yhteiset kulut tulo"),
      row("joint", "2026-03-11", -45.9, "K-Market Keskusta", { mcc: "5411" }),
      row("joint", "2026-03-12", -62.1, "Prisma Itä", { mcc: "5411" }),
      row("joint", "2026-03-14", -38.4, "Lidl Asema", { mcc: "5411" }),
      row("chk", "2026-03-20", -150, "Lahja", { counterpartyIban: "FI4950009420028730", counterparty: "Esimerkki Tuuli" }),
      row("sav", "2026-03-20", 150, "Korkotulo siirto"),
      row("chk", "2026-04-01", -110, "Pääsiäinen säästöön"),
      row("sav", "2026-04-07", 110, "Pääsiäinen säästöön tulo"),
    ];
    const of = run(rows, [checking, savings, joint]);
    for (const d of ["Säästöön maaliskuu", "Yhteiset kulut", "Pääsiäinen säästöön"]) {
      expect(of(d).t.isTransfer).toBe(true);
      expect(of(d).flows).toEqual(neutral);
    }
    // the side of a transfer that lands on the savings account is saved, once
    expect(of("Säästöön maaliskuu tulo").flows).toEqual({ ...neutral, saved: 20000 });
    expect(of("Pääsiäinen säästöön tulo").flows).toEqual({ ...neutral, saved: 11000 });
    expect(of("Lahja").t.isTransfer).toBe(false);
    expect(of("Lahja").flows.consumption + of("Lahja").flows.saved + of("Lahja").flows.debt).toBe(15000);
  });
});
