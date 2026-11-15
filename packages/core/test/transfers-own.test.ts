// Money between the household's own connected accounts: the savings account, a joint account the bank typed as a loan,
// a payee named by an IBAN the mapper read from a Finnish account number, and a pair held up by Easter.
import { describe, expect, it } from "vitest";
import { householdAllocations, transferAllocations } from "../src/pairing.ts";
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

describe("a leg that is proved takes its partner, and a purchase is no leg", () => {
  // the real transfer comes after the other rows in the input, and money in carries no IBAN, as a bank sends it
  const proved = () => [out("chk", "2026-03-03", 30000, { counterpartyIban: savings.iban }), into("sav", "2026-03-03", 30000)];
  const found = (rows: Transaction[]) => detectTransfers(rows, [checking, savings]);

  it("a payment with a terminal's text and the same sum, a day before, does not take the money into the savings account", () => {
    const purchase = tx({ accountId: "chk", bookingDate: "2026-03-02", amountCents: -30000, description: "SUMUP *KUKKAKAUPPA ILO" });
    const rows = [purchase, ...proved()];
    expect([...found(rows)].sort()).toEqual([rows[1]!.id, rows[2]!.id].sort());
  });

  it("a payment with a merchant code and the same sum is no leg", () => {
    const purchase = tx({ accountId: "chk", bookingDate: "2026-03-02", amountCents: -30000, mcc: "5411" });
    expect(found([purchase, ...proved()]).has(purchase.id)).toBe(false);
  });

  it("a card payment code makes a payment no leg", () => {
    const purchase = tx({ accountId: "chk", bookingDate: "2026-03-02", amountCents: -30000, bankTxnCode: "PMNT-CCRD-POSD" });
    expect(found([purchase, ...proved()]).has(purchase.id)).toBe(false);
  });

  it("a payment to a person with the same sum, earlier in the input, does not take the money in of a proved transfer", () => {
    const person = tx({ accountId: "chk", bookingDate: "2026-03-02", amountCents: -30000, category: "p2p", categorySource: "rule" });
    const rows = [person, ...proved()];
    const result = found(rows);
    expect(result.has(person.id)).toBe(false);
    expect(result.has(rows[1]!.id) && result.has(rows[2]!.id)).toBe(true);
  });

  it("each row is in at most one pair", () => {
    const rows = [
      tx({ accountId: "chk", bookingDate: "2026-03-02", amountCents: -30000, category: "p2p", categorySource: "rule" }),
      ...proved(),
      into("sav", "2026-03-04", 30000),
    ];
    const { allocations } = transferAllocations(rows, [checking, savings]);
    for (const [id, parts] of allocations) {
      expect(parts.length).toBe(1);
      expect(allocations.get(parts[0]!.partnerId)![0]!.partnerId).toBe(id);
    }
  });

  it("in the household view a payment to the joint account takes the money in the other member's rows left open, with no payer account", () => {
    const other: Account = { id: "chk2", name: "Toisen tili", iban: "FI4950009420028730", currency: "EUR", type: "checking" };
    const ownerOf = (accountId: string) => (accountId === "chk2" ? "b" : "a");
    const sent = tx({ id: "sent", accountId: "chk2", bookingDate: "2026-03-03", amountCents: -45000, counterpartyIban: joint.iban, category: "transfer", categorySource: "transfer" });
    const received = tx({ id: "received", accountId: "joint", bookingDate: "2026-03-03", amountCents: 45000, counterpartyIban: null, category: "p2p_in", categorySource: "rule" });
    const { allocations, between } = householdAllocations([sent, received], [checking, joint, other], ownerOf);
    expect(allocations.get("sent")?.[0]?.partnerId).toBe("received");
    expect(between.has("received")).toBe(true);
  });

  it("a payment a rule made a transfer stays a leg, whatever text it has", () => {
    const topUp = tx({ accountId: "chk", bookingDate: "2026-03-02", amountCents: -30000, description: "SUMUP *OMA", category: "transfer", categorySource: "rule" });
    expect(found([topUp, into("sav", "2026-03-03", 30000)]).size).toBe(2);
  });
});
