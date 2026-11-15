/**
 * Unexplained money in from another member of the household: found by the account number, else by a name only one
 * member has. Two members of one name stay unresolved, and a stranger who has a member's name is a stranger.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { type HouseholdMember, memberMoney } from "../src/analysis/member-money.ts";
import { nameOf } from "../src/person-names.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";
import { ibanOf } from "./kit/generate-rows.ts";

const [MINE, PARTNERS, STRANGERS] = [ibanOf(1), ibanOf(2), ibanOf(3)];
const accounts: Account[] = [{ id: "mine", name: "Käyttötili", iban: MINE, currency: "EUR", type: "checking" }];
const member = (id: string, name: string | null, ...ibans: string[]): HouseholdMember => ({ id, name: name ? nameOf(name) : null, ibans: new Set(ibans) });

const FROM = "2026-01-01";
const allRows = (rows: Partial<Transaction>[]) =>
  createContext(rows.map((r) => tx({ accountId: "mine", bookingDate: "2026-03-10", amountCents: 5000, category: "p2p_in", ...r })), accounts, "2026-03-20").txs;
const found = (rows: Partial<Transaction>[], members: HouseholdMember[], answered: (t: Transaction) => boolean = () => false) =>
  memberMoney(allRows(rows), members, "me", FROM, answered).map((m) => [m.key, m.cents, m.count]);

const ME = member("me", "Esimerkki Aino", MINE);
const PARTNER = member("partner", "Testaaja Pekka", PARTNERS);

describe("memberMoney", () => {
  it("finds money in from the account of one other member", () => {
    expect(found([{ counterparty: "Pekka T", counterpartyIban: PARTNERS }, { counterparty: "Pekka T", counterpartyIban: PARTNERS, amountCents: 2500 }], [ME, PARTNER])).toEqual([[`iban:${PARTNERS}`, 7500, 2]]);
  });

  it("finds money with no account number by a name only one member has", () => {
    expect(found([{ counterparty: "Pekka Testaaja" }], [ME, PARTNER])).toEqual([["name:PEKKA TESTAAJA", 5000, 1]]);
  });

  it("reads one person written in two orders as one member", () => {
    expect(found([{ counterparty: "TESTAAJA PEKKA" }, { counterparty: "Pekka Testaaja", amountCents: 1000 }], [ME, PARTNER])).toEqual([["name:PEKKA TESTAAJA", 6000, 2]]);
  });

  it("leaves two members of one name unresolved", () => {
    const twin = member("twin", "Pekka Testaaja", ibanOf(9));
    expect(found([{ counterparty: "Pekka Testaaja" }], [ME, PARTNER, twin])).toEqual([]);
  });

  it("takes the viewer's own name for no one else's", () => {
    const namesake = member("namesake", "Aino Esimerkki", ibanOf(8));
    expect(found([{ counterparty: "Aino Esimerkki" }], [ME, namesake])).toEqual([]);
  });

  it("leaves a stranger with a member's name a stranger", () => {
    expect(found([{ counterparty: "Pekka Testaaja", counterpartyIban: STRANGERS }], [ME, PARTNER])).toEqual([]);
  });

  it("leaves out money an answer, a pairing or the household already settled", () => {
    const rows = [
      { counterparty: "Pekka T", counterpartyIban: PARTNERS, categorySource: "user" as const },
      { counterparty: "Pekka T", counterpartyIban: PARTNERS, isTransfer: true, category: "transfer", categorySource: "transfer" as const },
      { counterparty: "Pekka T", counterpartyIban: PARTNERS, bookingDate: "2025-12-31" },
    ];
    expect(found(rows, [ME, PARTNER])).toEqual([]);
    expect(found([{ counterparty: "Pekka T", counterpartyIban: PARTNERS }], [ME, PARTNER], () => true)).toEqual([]);
  });

  it("leaves out money going out and money from the viewer's own account", () => {
    expect(found([{ counterparty: "Pekka T", counterpartyIban: PARTNERS, amountCents: -5000, category: "other" }, { counterparty: "Aino E", counterpartyIban: MINE }], [ME, PARTNER])).toEqual([]);
  });
});
