/**
 * A bill paid another way: from another account of the household, or by hand under another payee name. Every case
 * names its answer; each guard has its near miss on the other side.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { expectedCharges } from "../src/commitments.ts";
import { addDays } from "../src/dates.ts";
import { detectRecurring, projectDates, type RecurringSeries } from "../src/recurring.ts";
import { settlePaidElsewhere } from "../src/recurring-settled.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const PAYEE = "ESIMERKKI OY";
const OTHER = "ESIMERKKI OY LASKU";
type Row = Transaction & { refunded: number };
const row = (over: Partial<Transaction> & Pick<Transaction, "bookingDate"> & { refunded?: number }): Row => {
  const { refunded = 0, ...rest } = over;
  return { ...tx({ merchant: PAYEE, category: "subscriptions", amountCents: -5000, ...rest }), refunded };
};
/** One charge on the 15th of each month from `from` to `to` (2026). */
const monthly = (from: number, to: number, over: Partial<Transaction> = {}, day = 15): Row[] =>
  Array.from({ length: to - from + 1 }, (_, i) => row({ bookingDate: `2026-${String(from + i).padStart(2, "0")}-${String(day).padStart(2, "0")}`, ...over }));
const accounts = (...ids: string[]): Account[] => ids.map((id) => ({ id, name: id, iban: null, currency: "EUR", type: "checking" }));
const run = (rows: Row[], today: string, accs: Pick<Account, "id" | "type">[] = accounts("acc-1", "acc-2", "acc-3")) =>
  settlePaidElsewhere(detectRecurring(rows, today), rows, today, accs);
const ofAccount = (list: RecurringSeries[], account: string, merchant = PAYEE) => list.find((s) => s.id === `out:${account}:${merchant}`)!;

describe("a bill paid from another account", () => {
  const base = monthly(4, 9); // last charge 15.9., so 15.10. is due

  it("is settled: the next one is a step later, the last row stays", () => {
    const paid = row({ bookingDate: "2026-10-14", accountId: "acc-2" });
    const s = ofAccount(run([...base, paid], "2026-10-14"), "acc-1");
    expect(s.settled).toEqual([{ due: "2026-10-15", paidOn: "2026-10-14", id: paid.id, pending: false }]);
    expect(s).toMatchObject({ nextDate: "2026-11-15", lastDate: "2026-09-15", active: true, overdue: false });
  });

  it("is not settled when no row paid it", () => {
    const s = ofAccount(run(base, "2026-10-14"), "acc-1");
    expect(s.settled).toBeUndefined();
    expect(s.nextDate).toBe("2026-10-15");
  });

  it("is settled whatever the account, a credit card included", () => {
    const paid = row({ bookingDate: "2026-10-14", accountId: "card" });
    const s = ofAccount(run([...base, paid], "2026-10-14", [...accounts("acc-1"), { id: "card", type: "credit_card" }]), "acc-1");
    expect(s.settled?.map((x) => x.id)).toEqual([paid.id]);
  });

  it("is settled on the due day and the day after, the same occurrence once", () => {
    const pending = row({ bookingDate: "2026-10-15", status: "pending" }); // same account: the bank has not booked it
    const first = ofAccount(run([...base, pending], "2026-10-15"), "acc-1");
    expect(first.settled).toEqual([{ due: "2026-10-15", paidOn: "2026-10-15", id: pending.id, pending: true }]);
    expect(first.nextDate).toBe("2026-11-15");
    const booked = { ...pending, status: "booked" as const };
    const next = ofAccount(run([...base, booked], "2026-10-16"), "acc-1");
    expect(next.settled).toBeUndefined();
    expect(next).toMatchObject({ lastDate: "2026-10-15", nextDate: "2026-11-15" });
  });

  it("does not settle by a booked row on the series' own account that is no row of it", () => {
    const stray = row({ bookingDate: "2026-10-14", amountCents: -5000, category: "groceries", merchant: PAYEE });
    // the stray row is booked on acc-1 under the payee: a purchase, not another way of paying
    expect(ofAccount(run([...base, stray], "2026-10-14"), "acc-1").nextDate).toBe("2026-11-15");
  });

  it("windows: ten days early is settled, ten days after the last charge is not", () => {
    const at = (date: string) => ofAccount(run([...base, row({ bookingDate: date, accountId: "acc-2" })], "2026-10-25"), "acc-1").settled;
    expect(at("2026-10-05")).toHaveLength(1);
    expect(at("2026-10-01")).toHaveLength(1);
    expect(at("2026-09-30")).toBeUndefined(); // 15 days after the last one: nearer that bill (0.5 x 30.44 = 15.2)
    expect(at("2026-09-25")).toBeUndefined();
    expect(at("2026-10-20")).toHaveLength(1); // D + 5
    expect(at("2026-10-21")).toBeUndefined();
  });

  it("windows: a yearly bill paid 30 days early is settled, 60 days early is not", () => {
    const yearly = [2023, 2024, 2025].map((y) => row({ bookingDate: `${y}-12-15`, amountCents: -12000 }));
    const at = (date: string) => ofAccount(run([...yearly, row({ bookingDate: date, accountId: "acc-2", amountCents: -12000 })], "2026-12-14"), "acc-1").settled;
    expect(at("2026-11-15")).toHaveLength(1);
    expect(at("2026-10-15")).toBeUndefined();
    expect(at("2026-11-13")).toBeUndefined(); // 32 days early
  });

  it("sums: within 3 % and 0,50 EUR is the bill, half of it is not", () => {
    const at = (cents: number) => ofAccount(run([...base, row({ bookingDate: "2026-10-14", accountId: "acc-2", amountCents: cents })], "2026-10-14"), "acc-1").settled;
    expect(at(-5100)).toHaveLength(1);
    expect(at(-2500)).toBeUndefined();
    expect(at(-5200)).toBeUndefined();
    expect(at(-2300)).toBeUndefined(); // a card purchase of another sum the same week
  });

  it("a bill by use: a sum between the least and the most of the last six, widened by 10 %", () => {
    const sums = [5800, 8300, 6100, 7400, 6900, 8000];
    const usage = sums.map((c, i) => row({ bookingDate: `2026-0${4 + i}-15`, amountCents: -c, category: "utilities" }));
    expect(detectRecurring(usage, "2026-10-14")[0]!.kind).toBe("bill");
    const at = (cents: number) => ofAccount(run([...usage, row({ bookingDate: "2026-10-14", accountId: "acc-2", amountCents: -cents, category: "utilities" })], "2026-10-14"), "acc-1").settled;
    expect(at(7100)).toHaveLength(1);
    expect(at(9100)).toHaveLength(1); // 8300 + 10 % = 9130
    expect(at(9200)).toBeUndefined();
    expect(at(5230)).toHaveLength(1); // 5800 - 10 % = 5220
    expect(at(5200)).toBeUndefined();
    // a subscription has no band
    const fixed = (cents: number) => ofAccount(run([...base, row({ bookingDate: "2026-10-14", accountId: "acc-2", amountCents: -cents })], "2026-10-14"), "acc-1").settled;
    expect(fixed(-4000)).toBeUndefined();
  });

  it("is not settled by money back, an own transfer, a row after today or a payment paid back", () => {
    const at = (over: Partial<Transaction> & { refunded?: number }, today = "2026-10-14") =>
      ofAccount(run([...base, row({ bookingDate: "2026-10-14", accountId: "acc-2", ...over })], today), "acc-1").settled;
    expect(at({})).toHaveLength(1);
    expect(at({ amountCents: 5000 })).toBeUndefined();
    expect(at({ isTransfer: true })).toBeUndefined();
    expect(at({ bookingDate: "2026-10-16" })).toBeUndefined(); // waiting for its due day
    expect(at({ refunded: 5000 })).toBeUndefined();
    expect(at({ refunded: 2000 })).toHaveLength(1); // part of it back: the bill was still paid
    expect(at({ status: "pending" })).toHaveLength(1);
  });

  it("is settled month after month from the other account, each month once", () => {
    const early = monthly(3, 8);
    const elsewhere = [row({ bookingDate: "2026-09-14", accountId: "acc-2" }), row({ bookingDate: "2026-10-14", accountId: "acc-2" })];
    const s = ofAccount(run([...early, ...elsewhere], "2026-10-14"), "acc-1");
    expect(s.settled?.map((x) => [x.due, x.paidOn])).toEqual([["2026-09-15", "2026-09-14"], ["2026-10-15", "2026-10-14"]]);
    expect(s).toMatchObject({ lastDate: "2026-08-15", nextDate: "2026-11-15", active: true, overdue: false });
  });

  it("the next month's bill is still listed and due when nobody paid it (the settled one counts as the latest charge)", () => {
    const paid = row({ bookingDate: "2026-10-14", accountId: "acc-2" });
    const s = ofAccount(run([...base, paid], "2026-10-26"), "acc-1");
    // 15.9. was the last own row: 41 days before 26.10. is past a monthly series' limit without the settled charge
    expect(s).toMatchObject({ active: true, overdue: false, nextDate: "2026-11-15" });
    expect(expectedCharges([s], "2026-10-26", "2026-11-30").map((c) => [c.date, c.amountCents])).toEqual([["2026-11-15", 5000]]);
    expect(expectedCharges([ofAccount(run(base, "2026-10-26"), "acc-1")], "2026-10-26", "2026-11-30")).toEqual([]);
  });

  it("is still expected when the paying row comes after the next own charge (no skipped month)", () => {
    const s = ofAccount(run([...base, row({ bookingDate: "2026-10-14", accountId: "acc-2" }), row({ bookingDate: "2026-10-15" })], "2026-10-16"), "acc-1");
    expect(s.settled).toBeUndefined();
    expect(s).toMatchObject({ lastDate: "2026-10-15", nextDate: "2026-11-15" });
  });

  it("an end-of-month bill keeps its day: the 30th, due 28.2., next 30.3.", () => {
    const rows = ["2025-11-30", "2025-12-30", "2026-01-30"].map((d) => row({ bookingDate: d }));
    const paid = row({ bookingDate: "2026-02-27", accountId: "acc-2" });
    const s = ofAccount(run([...rows, paid], "2026-02-27"), "acc-1");
    expect(s.settled?.[0]?.due).toBe("2026-02-28");
    expect(s.nextDate).toBe("2026-03-30");
  });

  it("a series on a credit card is left as it is; a weekly one too", () => {
    const paid = row({ bookingDate: "2026-10-14", accountId: "acc-2" });
    const s = ofAccount(run([...base, paid], "2026-10-14", [{ id: "acc-1", type: "credit_card" }, ...accounts("acc-2")]), "acc-1");
    expect(s.settled).toBeUndefined();
    const weekly = Array.from({ length: 8 }, (_, i) => row({ bookingDate: addDays("2026-08-21", i * 7), amountCents: -1250 }));
    const w = ofAccount(run([...weekly, row({ bookingDate: "2026-10-15", accountId: "acc-2", amountCents: -1250 })], "2026-10-15"), "acc-1");
    expect(w.cadence).toBe("weekly");
    expect(w.settled).toBeUndefined();
  });

  it("another member's account the viewer cannot see: due where the row is missing, settled where it is there", () => {
    const paid = row({ bookingDate: "2026-10-14", accountId: "acc-2" });
    expect(ofAccount(run(base, "2026-10-14"), "acc-1").nextDate).toBe("2026-10-15");
    expect(ofAccount(run([...base, paid], "2026-10-14"), "acc-1").nextDate).toBe("2026-11-15");
  });

  it("a joint account seen at a part: the bank's whole sum is compared, not the part", () => {
    const part = monthly(4, 9, { amountCents: -2500, wholeCents: -5000 });
    const at = (cents: number) => ofAccount(run([...part, row({ bookingDate: "2026-10-14", accountId: "acc-2", amountCents: cents })], "2026-10-14"), "acc-1").settled;
    expect(at(-5000)).toHaveLength(1);
    expect(at(-2500)).toBeUndefined();
  });
});

describe("two contracts at one payee", () => {
  const a = monthly(3, 10, {}, 5); // acc-1, the 5th, last 5.10.
  const b = (accountId: string, merchant = PAYEE, extra: Partial<Transaction> = {}) => monthly(3, 9, { accountId, merchant, ...extra }, 25); // the 25th, last 25.9.

  it("neither settles the other once each has a series", () => {
    const rows = [...a, ...b("acc-2"), row({ bookingDate: "2026-10-25", accountId: "acc-2" })];
    const list = run(rows, "2026-10-26");
    expect(ofAccount(list, "acc-1").settled).toBeUndefined();
    expect(ofAccount(list, "acc-2").settled).toBeUndefined();
    expect(ofAccount(list, "acc-1").nextDate).toBe("2026-11-05");
  });

  it("a booked row of another series is that series' own, also when the earlier rows there were another sum", () => {
    const rows = [...a, ...monthly(3, 9, { accountId: "acc-2", amountCents: -9000 }, 25), row({ bookingDate: "2026-10-25", accountId: "acc-2" })];
    const list = run(rows, "2026-10-26");
    expect(ofAccount(list, "acc-2").transactionIds).toHaveLength(8);
    expect(ofAccount(list, "acc-1").settled).toBeUndefined();
    // the same row on an account with no series is a payment of the bill
    const alone = [...a, row({ bookingDate: "2026-10-25", accountId: "acc-3" })];
    expect(ofAccount(run(alone, "2026-10-26"), "acc-1").settled).toHaveLength(1);
  });

  it("neither settles the other with two payee names and one creditor IBAN", () => {
    const iban = "FI2112345600000785";
    const rows = [...monthly(3, 10, { counterpartyIban: iban }, 5), ...b("acc-2", OTHER, { counterpartyIban: iban }), row({ bookingDate: "2026-10-25", accountId: "acc-2", merchant: OTHER, counterpartyIban: iban })];
    const list = run(rows, "2026-10-26");
    expect(ofAccount(list, "acc-1").settled).toBeUndefined();
    expect(ofAccount(list, "acc-2", OTHER).settled).toBeUndefined();
  });

  it("a pending row near another series' next date on its own account settles nothing; on a plain account it does", () => {
    const rows = [...a, ...b("acc-2")];
    // acc-2's series expects 25.10.; a pending row there on 25.10. is its coming charge
    expect(ofAccount(run([...rows, row({ bookingDate: "2026-10-25", accountId: "acc-2", status: "pending" })], "2026-10-25"), "acc-1").settled).toBeUndefined();
    expect(ofAccount(run([...rows, row({ bookingDate: "2026-10-25", accountId: "acc-3", status: "pending" })], "2026-10-25"), "acc-1").settled).toHaveLength(1);
  });

  it("the first rows of a second contract with no series yet: the first settles, the second does not", () => {
    const first = row({ bookingDate: "2026-09-25", accountId: "acc-2" });
    const second = row({ bookingDate: "2026-10-25", accountId: "acc-2" });
    const mine = monthly(3, 10, {}, 5);
    // 25.9. is in the window of 5.10. (>= 20.9.): it settles that occurrence; 25.10. then is its second row for 5.11.
    const s = ofAccount(run([...mine.slice(0, -1), first], "2026-09-26"), "acc-1");
    expect(s.settled?.map((x) => x.id)).toEqual([first.id]);
    expect(ofAccount(run([...mine, first, second], "2026-10-26"), "acc-1").settled).toBeUndefined();
    // near miss: the earlier row of that account is of another sum, or not a step before
    const other = row({ bookingDate: "2026-09-25", accountId: "acc-2", amountCents: -9000 });
    expect(ofAccount(run([...mine, other, second], "2026-10-26"), "acc-1").settled).toHaveLength(1);
    const far = row({ bookingDate: "2026-10-05", accountId: "acc-2" });
    expect(ofAccount(run([...mine, far, second], "2026-10-26"), "acc-1").settled).toHaveLength(1);
  });

  it("one row settles one occurrence of one series: the series by id first", () => {
    const one = monthly(4, 9, { accountId: "acc-1" });
    const two = monthly(4, 9, { accountId: "acc-2" });
    const paid = row({ bookingDate: "2026-10-14", accountId: "acc-3" });
    const list = run([...one, ...two, paid], "2026-10-14");
    expect(ofAccount(list, "acc-1").settled?.map((x) => x.id)).toEqual([paid.id]);
    expect(ofAccount(list, "acc-2").settled).toBeUndefined();
  });
});

describe("a bill paid by hand under another payee name", () => {
  const withRefs = (refs: (string | null)[], over: Partial<Transaction> = {}) => refs.map((reference, i) => row({ bookingDate: `2026-0${4 + i}-15`, reference, ...over }));
  const paidAs = (rows: Row[], over: Partial<Transaction> & { refunded?: number }, today = "2026-10-14") => {
    const paid = row({ bookingDate: "2026-10-14", merchant: OTHER, accountId: "acc-2", ...over });
    return ofAccount(run([...rows, paid], today), "acc-1").settled;
  };

  it("the reference runs on from a prefix the last three share (RF check digits do not count)", () => {
    const rows = withRefs(["RF18 1234 5678 01", "RF45 1234 5678 02", "RF71 1234 5678 03", "RF03 1234 5678 04", "RF29 1234 5678 05", "RF50 1234 5678 06"]);
    expect(paidAs(rows, { reference: "RF92 1234 5678 07" })).toHaveLength(1);
    expect(paidAs(rows, { reference: "12345678 07" })).toHaveLength(1);
    expect(paidAs(rows, { reference: "1234 5679 07" })).toBeUndefined(); // another prefix
    expect(paidAs(rows, { reference: "RF92 1234 5678 077" })).toBeUndefined(); // another length
    expect(paidAs(rows, { reference: "RF92 1234 5678 04" })).toBeUndefined(); // a second payment of an old invoice
    expect(paidAs(rows, { reference: "RF92 1234 5678 07", amountCents: -8000 })).toBeUndefined(); // sum 60 % up
    expect(paidAs(rows, { reference: "RF92 1234 5678 07", amountCents: -6000 })).toHaveLength(1); // 20 % up
  });

  it("a reference every invoice shares settles an equal one; an old invoice's own does not", () => {
    const constant = withRefs(Array(6).fill("RF55 8888"));
    expect(paidAs(constant, { reference: "8888" })).toHaveLength(1);
    expect(paidAs(constant, { reference: "8889" })).toBeUndefined();
    expect(paidAs(constant, { reference: "8888", amountCents: -7000 })).toBeUndefined();
    // the last two differ: no constant reference, and a prefix of fewer than 8 characters is none
    expect(paidAs(withRefs(["1111", "2222", "3333", "4444", "5555", "6666"]), { reference: "3333" })).toBeUndefined();
  });

  it("zero-padded references of two billers do not match", () => {
    const rows = withRefs(["00000000000000123", "00000000000000124", "00000000000000125", "00000000000000126", "00000000000000127", "00000000000000128"]);
    expect(paidAs(rows, { reference: "0000000000000999" })).toBeUndefined();
  });

  it("no reference and no IBAN is no proof, however exact the sum", () => {
    const rows = withRefs([null, null, null, null, null, null]);
    expect(paidAs(rows, { reference: null })).toBeUndefined();
    expect(paidAs(rows, { reference: "" })).toBeUndefined();
    expect(paidAs(withRefs(["", "", "", "", "", ""]), { reference: "" })).toBeUndefined();
  });

  it("the creditor's account number proves the biller, and the sum must still be the bill's", () => {
    const iban = "FI2112345600000785";
    const rows = monthly(4, 9, { counterpartyIban: iban });
    expect(paidAs(rows, { counterpartyIban: "FI21 1234 5600 0007 85" })).toHaveLength(1);
    expect(paidAs(rows, { counterpartyIban: "FI21 1234 5600 0007 85", amountCents: -5400 })).toBeUndefined(); // within 25 %, not the bill
    expect(paidAs(rows, { counterpartyIban: "FI9814353000011082" })).toBeUndefined();
    expect(paidAs(rows, { counterpartyIban: null })).toBeUndefined();
    // only one earlier row with the account number
    const one = monthly(4, 9, {}).map((r, i) => (i === 0 ? { ...r, counterpartyIban: iban } : r));
    expect(paidAs(one, { counterpartyIban: iban })).toBeUndefined();
  });
});

describe("the analysis context", () => {
  it("lists the settled bill once, with the paying row among the fixed costs", () => {
    const paid = row({ bookingDate: "2026-10-14", accountId: "acc-2" });
    const ctx = createContext([...monthly(4, 9), paid], accounts("acc-1", "acc-2"), "2026-10-26");
    const s = ctx.recurring.find((x) => x.id === "out:acc-1:" + PAYEE)!;
    expect(s.settled?.map((x) => x.id)).toEqual([paid.id]);
    expect(ctx.fixedIds.has(paid.id)).toBe(true);
    expect(projectDates(s, "2026-11-30")).toEqual(["2026-11-15"]);
  });
});
