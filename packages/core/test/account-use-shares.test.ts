/**
 * A member's own view of rows when the viewer's own cents of a row are handed over (`applyUse` with `shares`): the row
 * counts those cents instead of the account's part. Without them nothing differs.
 */
import { describe, expect, it } from "vitest";
import { applyUse, billCents, NONE, partOf, WHOLE } from "../src/account-use.ts";
import type { Account, AccountUse, Part, RowShare, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const AINO = "KORHONEN AINO";
const VILLE = "KORHONEN VILLE";

const account = (id: string, holder: string, extra: Partial<Account> = {}): Account => ({ id, name: id, holder, iban: null, currency: "EUR", type: "checking", ...extra });
const hers = account("hers", AINO);
const his = account("his", VILLE);
const mortgage = account("mortgage", `${AINO}, ${VILLE}`, { type: "loan" });
const HALF: Part = { from: 0, to: 1, of: 2 };

const parts = (...entries: [Account, Part][]) => new Map(entries.map(([a, part]) => [a.id, part]));
const on = (a: Account, euros: number, extra: Partial<Transaction> = {}) => tx({ accountId: a.id, bookingDate: "2026-09-02", amountCents: Math.round(euros * 100), ...extra });
const share = (euros: number, extra: Partial<RowShare> = {}): RowShare => ({ cents: Math.round(euros * 100), openCents: 0, transfer: false, ...extra });
const shares = (...entries: [Transaction, RowShare][]) => new Map(entries.map(([t, s]) => [t.id, s]));

describe("without shares", () => {
  const rent = on(mortgage, -733.33, { category: "housing", categorySource: "rule" });
  const food = on(mortgage, -84.37, { category: "groceries", categorySource: "mcc" });

  it("a household with no joint account gets its rows back, the same array, whatever the map holds", () => {
    const rows = [on(hers, -20), on(his, -30)];
    expect(applyUse(rows, [hers, his], parts([hers, WHOLE], [his, WHOLE]))).toBe(rows);
    expect(applyUse(rows, [hers, his], parts([hers, WHOLE], [his, WHOLE]), new Map(), shares([rows[0]!, share(-5)]))).toBe(rows);
    // near miss: one account at a half and the same map
    const cut = applyUse(rows, [hers, his], parts([hers, WHOLE], [his, HALF]), new Map(), shares([rows[0]!, share(-5)]));
    expect(cut).not.toBe(rows);
    expect(cut[0]).toMatchObject({ amountCents: -500, wholeCents: -2000 });
  });

  it("a joint account is cut by the part as it was: no map, an empty map and a map of other rows give one answer", () => {
    const view = parts([mortgage, partOf({ users: [{ userId: "u-1", label: "Aino", weight: 3 }, { userId: "u-2", label: "Ville", weight: 2 }], source: "said" }, "u-1")]);
    const plain = applyUse([rent, food], [mortgage], view);
    expect(plain).toEqual([{ ...rent, amountCents: -44000, wholeCents: -73333 }, { ...food, amountCents: -5062, wholeCents: -8437 }]);
    expect(applyUse([rent, food], [mortgage], view, new Map(), new Map())).toEqual(plain);
    expect(applyUse([rent, food], [mortgage], view, new Map(), shares([on(mortgage, -1), share(-1)]))).toEqual(plain);
    expect(plain[0]).not.toHaveProperty("openCents");
  });
});

describe("a row with a share", () => {
  const view = parts([mortgage, HALF]);

  it("counts the share's cents and keeps the bank's amount, which billCents still gives: money out, money in and a refund", () => {
    const out = on(mortgage, -84.37, { category: "groceries", categorySource: "mcc" });
    const into = on(mortgage, 2500.01, { category: "salary", categorySource: "rule" });
    const refund = on(mortgage, 15.99, { category: "groceries", categorySource: "mcc" });
    const seen = applyUse([out, into, refund], [mortgage], view, new Map(), shares([out, share(-30.13)], [into, share(1000.01)], [refund, share(15.99)]));
    expect(seen).toEqual([
      { ...out, amountCents: -3013, wholeCents: -8437 },
      { ...into, amountCents: 100001, wholeCents: 250001 },
      { ...refund, amountCents: 1599, wholeCents: 1599 },
    ]);
    expect(seen.map(billCents)).toEqual([-8437, 250001, 1599]);
    // the share is not cut again by the half the account says
    expect(seen[0]!.amountCents).not.toBe(-1519);
  });

  it("a mortgage of 1 104,37 paid 1 058,35 by one and 46,02 by the other: the two views add up to the row", () => {
    const row = on(mortgage, -1104.37, { category: "housing", categorySource: "rule" });
    const [aino, ville] = [share(-1058.35), share(-46.02)];
    const [a, v] = [aino, ville].map((s) => applyUse([row], [mortgage], view, new Map(), shares([row, s]))[0]!) as [Transaction, Transaction];
    expect(a.amountCents + v.amountCents).toBe(row.amountCents);
    expect([a.wholeCents, v.wholeCents]).toEqual([-110437, -110437]);
  });

  it("a share of 0 drops the row from that view, and a share of one cent keeps it", () => {
    const row = on(mortgage, -1104.37);
    expect(applyUse([row], [mortgage], view, new Map(), shares([row, share(-1104.37)]))).toEqual([{ ...row, amountCents: -110437, wholeCents: -110437 }]);
    expect(applyUse([row], [mortgage], view, new Map(), shares([row, share(0)]))).toEqual([]);
    expect(applyUse([row], [mortgage], view, new Map(), shares([row, share(-0.01)]))).toEqual([{ ...row, amountCents: -1, wholeCents: -110437 }]);
    expect(applyUse([row], [mortgage], view, new Map(), shares([row, share(0.01)]))).toMatchObject([{ amountCents: 1 }]);
  });

  it("a row of an account the viewer has no part in still counts the cents the viewer paid of it", () => {
    const row = on(mortgage, -100);
    const gone = parts([mortgage, NONE], [hers, WHOLE]);
    expect(applyUse([row], [mortgage, hers], gone)).toEqual([]);
    expect(applyUse([row], [mortgage, hers], gone, new Map(), shares([row, share(-40)]))).toEqual([{ ...row, amountCents: -4000, wholeCents: -10000 }]);
  });

  it("sets openCents when the share has some, and leaves the field out when it has none", () => {
    const [open, settled] = [on(mortgage, -1104.37), on(mortgage, -50)];
    const seen = applyUse([open, settled], [mortgage], view, new Map(), shares([open, share(-1058.35, { openCents: -55219 })], [settled, share(-25, { openCents: 0 })]));
    expect(seen[0]).toMatchObject({ amountCents: -105835, openCents: -55219 });
    expect(seen[1]).not.toHaveProperty("openCents");
    expect(seen[1]!.amountCents).toBe(-2500);
    // an open sum of one cent is still set
    expect(applyUse([open], [mortgage], view, new Map(), shares([open, share(-0.01, { openCents: -1 })]))[0]).toMatchObject({ openCents: -1 });
  });

  it("a row with a share and a row without it on one account: the second is cut by the part", () => {
    const [told, left] = [on(mortgage, -100), on(mortgage, -60)];
    const seen = applyUse([told, left], [mortgage], view, new Map(), shares([told, share(-90)]));
    expect(seen).toEqual([{ ...told, amountCents: -9000, wholeCents: -10000 }, { ...left, amountCents: -3000, wholeCents: -6000 }]);
  });
});

describe("a share and the other end of a movement", () => {
  // he sent 300 to her account, which she alone uses and which his view holds no part of
  const sent = on(his, -300, { category: "p2p", categorySource: "rule", counterparty: AINO });
  const landed = on(hers, 300, { category: "p2p_in", categorySource: "rule", counterparty: VILLE });
  const stored = (t: Transaction) => ({ ...t, category: "transfer", categorySource: "transfer" as const, isTransfer: true });
  const view = parts([his, WHOLE], [hers, NONE]);
  const rows = [stored(on(his, -300)), stored(on(hers, 300))];
  const [out] = rows as [Transaction, Transaction];

  it("with no share the money to an account he has no part in is money to a person, as it was", () => {
    expect(applyUse(rows, [his, hers], view)).toEqual([{ ...out, category: "p2p", categorySource: "rule", isTransfer: false }]);
  });

  it("a share that is a transfer makes the row one, and a share that is none keeps the category it has", () => {
    const first = applyUse([sent, landed], [his, hers], view, new Map(), shares([sent, share(-300, { transfer: true })]));
    expect(first).toEqual([{ ...sent, category: "transfer", isTransfer: true, amountCents: -30000, wholeCents: -30000 }]);
    const none = applyUse([sent, landed], [his, hers], view, new Map(), shares([sent, share(-300)]));
    expect(none).toEqual([{ ...sent, amountCents: -30000, wholeCents: -30000 }]);
    // a stored transfer with a share that is none stays the transfer it is, and is not read as money to a person
    const kept = applyUse(rows, [his, hers], view, new Map(), shares([out, share(-300)]));
    expect(kept).toEqual([{ ...out, amountCents: -30000, wholeCents: -30000 }]);
    expect(kept[0]).toMatchObject({ category: "transfer", isTransfer: true });
  });

  it("a share that is a transfer leaves the money to a person alone on a row of the same account that has none", () => {
    const other = on(his, -45, { category: "p2p", categorySource: "rule", counterparty: "VIERAS VEIKKO" });
    const seen = applyUse([sent, other], [his, hers], view, new Map(), shares([sent, share(-300, { transfer: true })]));
    expect(seen[1]).toBe(other);
  });

  it("a category set by hand stays, and the row is cut", () => {
    const set = on(his, -300, { category: "housing", categorySource: "user" });
    const seen = applyUse([set], [his, hers], view, new Map(), shares([set, share(-100, { transfer: true })]));
    expect(seen).toEqual([{ ...set, amountCents: -10000, wholeCents: -30000 }]);
    expect(seen[0]).toMatchObject({ category: "housing", isTransfer: false });
  });

  it("money in is a transfer when the share says so, and a refund keeps its category when it does not", () => {
    const into = on(his, 200, { category: "p2p_in", categorySource: "rule", counterparty: AINO });
    const refund = on(his, 25, { category: "groceries", categorySource: "mcc" });
    const seen = applyUse([into, refund], [his, hers], view, new Map(), shares([into, share(200, { transfer: true })], [refund, share(25)]));
    expect(seen).toMatchObject([{ category: "transfer", isTransfer: true, amountCents: 20000 }, { category: "groceries", isTransfer: false, amountCents: 2500 }]);
  });
});

describe("a use without a mode", () => {
  it("is a use, and the weights decide as they did", () => {
    const plain: AccountUse = { users: [{ userId: "u-1", label: "Aino", weight: 3 }, { userId: "u-2", label: "Ville", weight: 1 }], source: "bank" };
    const traced: AccountUse = { ...plain, mode: "source" };
    expect(plain.mode).toBeUndefined();
    expect(partOf(traced, "u-1")).toEqual(partOf(plain, "u-1"));
    expect(partOf(plain, "u-2")).toEqual({ from: 3, to: 4, of: 4 });
  });
});
