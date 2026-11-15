/**
 * A payment that names an account of the household and arrives a fee short (pairing-fee.ts), and a member's top-up of a
 * joint account that names no holder. The declared account is the proof; nothing else of the money in is read.
 */
import { describe, expect, it } from "vitest";
import { householdAllocations, transferAllocations } from "../src/pairing.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const [A_IBAN, B_IBAN, C_IBAN, JOINT_IBAN] = ["FI0000000000000001", "FI0000000000000002", "FI0000000000000003", "FI0000000000000004"];
const account = (id: string, iban: string, holder: string): Account => ({ id, name: id, holder, iban, currency: "EUR", type: "checking" });
const accounts = [account("a", A_IBAN, "MEIKALAINEN MATTI"), account("b", B_IBAN, "KORHONEN ELISA"), account("c", C_IBAN, "VIERAS VEIKKO"), account("joint", JOINT_IBAN, "MEIKALAINEN MATTI, KORHONEN ELISA")];

const out = (id: string, date: string, cents: number, to: string | null, extra: Partial<Transaction> = {}) => tx({ id, accountId: "a", bookingDate: date, amountCents: -cents, counterpartyIban: to, ...extra });
const into = (id: string, accountId: string, date: string, cents: number, extra: Partial<Transaction> = {}) => tx({ id, accountId, bookingDate: date, amountCents: cents, ...extra });
const pairOf = (rows: readonly Transaction[], id: string, accs: readonly Account[] = accounts) => transferAllocations(rows, accs).allocations.get(id)?.[0]?.partnerId;

describe("a payment to a declared account of the household that arrives a fee short", () => {
  it("pairs with the money in on exactly that account, and the pair counts what arrived", () => {
    const rows = [out("o", "2025-04-01", 8150, B_IBAN), into("i", "b", "2025-04-02", 8000)];
    const { transfers, allocations } = transferAllocations(rows, accounts);
    expect([...transfers].sort()).toEqual(["i", "o"]);
    expect(allocations.get("o")).toEqual([{ partnerId: "i", cents: 8000, partnerCents: 8000, link: "amount-day", tier: "decided" }]);
    expect(allocations.get("i")).toEqual([{ partnerId: "o", cents: 8000, partnerCents: 8000, link: "amount-day", tier: "decided" }]);
  });

  it("reads no name: a payer on the money in who is a stranger or a holder changes nothing", () => {
    for (const counterparty of ["VIERAS VEIKKO", "KORHONEN ELISA", null]) {
      expect(pairOf([out("o", "2025-04-01", 8150, B_IBAN), into("i", "b", "2025-04-02", 8000, { counterparty })], "o")).toBe("i");
    }
  });

  it("is a near miss when the money lands on another account than the one named", () => {
    expect(pairOf([out("o", "2025-04-01", 8150, B_IBAN), into("i", "c", "2025-04-02", 8000)], "o")).toBeUndefined();
    // the money in names another payer account than the sender's
    expect(pairOf([out("o", "2025-04-01", 8150, B_IBAN), into("i", "b", "2025-04-02", 8000, { counterpartyIban: C_IBAN })], "o")).toBeUndefined();
  });

  it("is a near miss when the payment names no account of the household", () => {
    expect(pairOf([out("o", "2025-04-01", 8150, null), into("i", "b", "2025-04-02", 8000)], "o")).toBeUndefined();
    expect(pairOf([out("o", "2025-04-01", 8150, "FI0000000000000099"), into("i", "b", "2025-04-02", 8000)], "o")).toBeUndefined();
  });

  it("holds the difference to 2 percent and 5 euro, both ends allowed", () => {
    // 2 % of 100 euro is 2 euro: allowed, one cent over is not
    expect(pairOf([out("o", "2025-04-01", 10000, B_IBAN), into("i", "b", "2025-04-02", 9800)], "o")).toBe("i");
    expect(pairOf([out("o", "2025-04-01", 10000, B_IBAN), into("i", "b", "2025-04-02", 9799)], "o")).toBeUndefined();
    // 1 % of 500 euro is 5 euro: allowed, one cent over is not
    expect(pairOf([out("o", "2025-04-01", 50000, B_IBAN), into("i", "b", "2025-04-02", 49500)], "o")).toBe("i");
    expect(pairOf([out("o", "2025-04-01", 50000, B_IBAN), into("i", "b", "2025-04-02", 49499)], "o")).toBeUndefined();
    // 1 % of 1000 euro is 10 euro, over the 5 euro
    expect(pairOf([out("o", "2025-04-01", 100000, B_IBAN), into("i", "b", "2025-04-02", 99000)], "o")).toBeUndefined();
  });

  it("never takes money in for more than was paid", () => {
    expect(pairOf([out("o", "2025-04-01", 8000, B_IBAN), into("i", "b", "2025-04-02", 8150)], "o")).toBeUndefined();
  });

  it("holds the window of days", () => {
    expect(pairOf([out("o", "2025-04-01", 8150, B_IBAN), into("i", "b", "2025-04-06", 8000)], "o")).toBe("i");
    expect(pairOf([out("o", "2025-04-01", 8150, B_IBAN), into("i", "b", "2025-04-07", 8000)], "o")).toBeUndefined();
  });

  it("takes the closest amount, then the closest day, then the first row, whatever the order of the rows", () => {
    const near = into("near", "b", "2025-04-04", 8100);
    const exactDay = into("far", "b", "2025-04-01", 8000);
    for (const rows of [[near, exactDay], [exactDay, near]]) expect(pairOf([out("o", "2025-04-01", 8150, B_IBAN), ...rows], "o")).toBe("near");
    const [soon, late] = [into("soon", "b", "2025-04-02", 8100), into("late", "b", "2025-04-04", 8100)];
    for (const rows of [[soon, late], [late, soon]]) expect(pairOf([out("o", "2025-04-01", 8150, B_IBAN), ...rows], "o")).toBe("soon");
    const [first, second] = [into("first", "b", "2025-04-02", 8100), into("second", "b", "2025-04-02", 8100)];
    expect(pairOf([out("o", "2025-04-01", 8150, B_IBAN), first, second], "o")).toBe("first");
    // the row that was not taken pairs with nothing
    expect(transferAllocations([out("o", "2025-04-01", 8150, B_IBAN), first, second], accounts).allocations.has("second")).toBe(false);
  });

  it("does not take money in that an exact pair has", () => {
    const rows = [out("o", "2025-04-01", 8150, B_IBAN), out("p", "2025-04-01", 8100, B_IBAN), into("i", "b", "2025-04-02", 8100)];
    const { allocations } = transferAllocations(rows, accounts);
    expect(allocations.get("p")?.[0]?.partnerId).toBe("i");
    expect(allocations.has("o")).toBe(false);
  });

  it("pairs in the household view across two members' rows: the stored transfer of one and the open money in of the other", () => {
    const owner = (accountId: string) => (accountId === "a" || accountId === "c" ? "m1" : "m2");
    const sent = out("o", "2025-04-01", 8150, B_IBAN, { category: "transfer", categorySource: "transfer", isTransfer: true });
    const received = into("i", "b", "2025-04-02", 8000, { category: "p2p_in", categorySource: "rule", counterparty: "MEIKALAINEN MATTI" });
    const { allocations, between } = householdAllocations([sent, received], accounts, owner);
    expect(allocations.get("o")?.[0]).toMatchObject({ partnerId: "i", cents: 8000 });
    expect([...between].sort()).toEqual(["i", "o"]);
    // near miss: the money in on another account is nobody's
    expect(householdAllocations([sent, into("i", "c", "2025-04-02", 8000)], accounts, owner).allocations.has("o")).toBe(false);
  });
});

describe("a member's top-up of a joint account that names no holder", () => {
  const topUp = out("o", "2025-04-03", 45000, JOINT_IBAN);

  it("pairs with the money in on the joint account of the same sum, whatever name it carries", () => {
    for (const counterparty of ["MEIKALAINEN MATTI", "VIERAS VEIKKO", null]) expect(pairOf([topUp, into("i", "joint", "2025-04-03", 45000, { counterparty })], "o")).toBe("i");
  });

  it("leaves the same sum on another account alone", () => {
    expect(pairOf([topUp, into("i", "c", "2025-04-03", 45000)], "o")).toBeUndefined();
    expect(pairOf([topUp, into("i", "b", "2025-04-03", 45000, { counterparty: "MEIKALAINEN MATTI" })], "o")).toBeUndefined();
  });

  it("takes the one on the joint account when another account has the same sum a day sooner", () => {
    expect(pairOf([topUp, into("elsewhere", "c", "2025-04-02", 45000), into("i", "joint", "2025-04-04", 45000)], "o")).toBe("i");
  });
});
