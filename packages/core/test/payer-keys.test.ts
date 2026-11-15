/**
 * Three keys say "the same party" in this codebase: `payerKeyOf` (payer-role.ts: the IBAN, else the sorted folded words
 * of the counterparty; stored in payer_role, account_agreement and settlement rows), `payerKey` (analysis/income.ts:
 * the folded merchant; groups the income series) and `partyKey` (returns.ts: account and merchant; steady parties and
 * refunds). They are not one key written three ways: this file pins where they agree and where they split.
 */
import { describe, expect, it } from "vitest";
import { demoHousehold } from "../../../tools/findings/households.ts";
import { payerKey } from "../src/analysis/income.ts";
import { payerKeyOf } from "../src/payer-role.ts";
import { partyKey } from "../src/returns.ts";
import type { Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

type KeyOf = (t: Transaction) => string | null;

/** How the groups of key `a` relate to those of key `b` over `rows` (rows without a key in either are left out). */
function relation(rows: readonly Transaction[], a: KeyOf, b: KeyOf): { groupsA: number; groupsB: number; aSplitsB: number; bSplitsA: number } {
  const keyed = rows.filter((t) => a(t) !== null && b(t) !== null);
  const within = (x: KeyOf, y: KeyOf) => {
    const seen = new Map<string, Set<string>>();
    for (const t of keyed) seen.set(x(t)!, (seen.get(x(t)!) ?? new Set()).add(y(t)!));
    return [...seen.values()].filter((s) => s.size > 1).length;
  };
  return { groupsA: new Set(keyed.map(a)).size, groupsB: new Set(keyed.map(b)).size, aSplitsB: within(a, b), bSplitsA: within(b, a) };
}

const income = (rows: readonly Transaction[]) => rows.filter((t) => t.amountCents > 0);

describe("the payer keys on the demo", () => {
  const rows = income(demoHousehold().txs);

  it("write three different strings for one row", () => {
    const named = rows.filter((t) => payerKeyOf(t) !== null);
    expect(named.length).toBeGreaterThan(0);
    for (const t of named) {
      expect(new Set([payerKeyOf(t), payerKey(t), partyKey(t)]).size, t.merchant).toBe(3);
    }
  });

  it("group the income rows alike for payerKeyOf and payerKey: the same payers, the same groups", () => {
    expect(relation(rows, payerKeyOf, payerKey)).toEqual({ groupsA: 5, groupsB: 5, aSplitsB: 0, bSplitsA: 0 });
  });

  it("split one merchant of payerKey in two for partyKey: the demo has one payer on two accounts", () => {
    expect(relation(rows, payerKey, partyKey)).toEqual({ groupsA: 6, groupsB: 7, aSplitsB: 1, bSplitsA: 0 });
  });
});

describe("the payer keys on edge cases", () => {
  const base = { bookingDate: "2026-10-03", amountCents: 100_000 };

  it("a payer with two IBANs is two payers to payerKeyOf, one to payerKey", () => {
    const one = tx({ ...base, merchant: "ESIMERKKI OY", counterparty: "ESIMERKKI OY", counterpartyIban: "FI2112345600000785" });
    const two = tx({ ...base, merchant: "ESIMERKKI OY", counterparty: "ESIMERKKI OY", counterpartyIban: "FI4950009420028730" });
    expect(payerKeyOf(one)).not.toBe(payerKeyOf(two));
    expect(payerKey(one)).toBe(payerKey(two));
  });

  it("a name written two ways is one payer to payerKeyOf, two to payerKey and partyKey", () => {
    const a = tx({ ...base, merchant: "Ville Esimerkki", counterparty: "Ville Esimerkki" });
    const b = tx({ ...base, merchant: "ESIMERKKI VILLE", counterparty: "Esimerkki, Ville" });
    expect(payerKeyOf(a)).toBe(payerKeyOf(b));
    expect(payerKey(a)).not.toBe(payerKey(b));
    expect(partyKey(a)).not.toBe(partyKey(b));
  });

  it("the same merchant on two accounts is one payer to payerKey, two parties to partyKey", () => {
    const a = tx({ ...base, accountId: "acc-1", merchant: "ESIMERKKI OY" });
    const b = tx({ ...base, accountId: "acc-2", merchant: "ESIMERKKI OY" });
    expect(payerKey(a)).toBe(payerKey(b));
    expect(partyKey(a)).not.toBe(partyKey(b));
  });

  it("a row with no IBAN and no counterparty has no payer to payerKeyOf, but a merchant key to the others", () => {
    const t = tx({ ...base, merchant: "Pientä Palkkaa", counterparty: null, counterpartyIban: null });
    expect(payerKeyOf(t)).toBeNull();
    expect(payerKey(t)).toBe("PIENTA PALKKAA");
    expect(partyKey(t)).toBe("acc-1|Pientä Palkkaa");
  });

  it("the stored format is pinned: iban:<IBAN> and name:<sorted folded words>", () => {
    expect(payerKeyOf({ counterparty: "x", counterpartyIban: "fi21 1234 5600 0007 85" })).toBe("iban:FI2112345600000785");
    expect(payerKeyOf({ counterparty: "Ville Äkkinen", counterpartyIban: null })).toBe("name:AKKINEN VILLE");
  });
});
