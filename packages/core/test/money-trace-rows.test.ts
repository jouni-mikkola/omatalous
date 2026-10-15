/**
 * The rows of a pool for the money trace: the copies a household holds of one real account are joined into one list,
 * and each row is read for what it is from the payers the household gave.
 */
import { describe, expect, it } from "vitest";
import { dayNumber as d } from "../src/dates.ts";
import { type Joined, joinCopies, type Payers, traceRows } from "../src/money-trace-rows.ts";
import { questionsOf } from "../src/money-trace-answers.ts";
import { type SourcePart, trace } from "../src/money-trace.ts";
import { nameOf } from "../src/person-names.ts";
import type { Account, Transaction } from "../src/types.ts";
import { rng } from "./gen.ts";
import { tx } from "./helpers.ts";

const AINO = "u:u-aino";
const VILLE = "u:u-ville";
const POOL = "FI0000000011";
const AINO_OWN = "FI0000000021";
const VILLE_OWN = "FI0000000022";
const POOL_Y = "FI0000000031";

const account = (id: string, iban: string | null): Account => ({ id, name: id, iban, currency: "EUR", type: "checking" });
const accounts = [account("pool-a", POOL), account("pool-b", POOL), account("aino-own", AINO_OWN), account("ville-own", VILLE_OWN), account("pool-y", POOL_Y)];

const who = (over: Partial<Payers> = {}): Payers => ({
  accounts,
  others: [],
  alone: new Map([
    [AINO_OWN, AINO],
    [VILLE_OWN, VILLE],
  ]),
  pools: new Set([POOL, POOL_Y]),
  names: [
    { owner: AINO, name: nameOf("KORHONEN AINO") },
    { owner: VILLE, name: nameOf("LAHTINEN VILLE") },
  ],
  ...over,
});

/** A row of a copy of the pool. */
const at = (id: string, date: string, amountCents: number, over: Partial<Transaction> = {}, accountId = "pool-a"): Transaction =>
  tx({ id, accountId, bookingDate: date, amountCents, counterparty: null, merchant: "Test", ...over });

const rowsOf = (j: Joined) => j.rows.map((r) => [r.key, [...r.ids].sort()] as const);
const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

describe("joinCopies", () => {
  const rows = (prefix: string, accountId: string): Transaction[] => [
    at(`${prefix}1`, "2025-08-01", 7001, { counterparty: "AINO KORHONEN" }, accountId),
    at(`${prefix}2`, "2025-08-02", -5000, { counterparty: "KAUPPA" }, accountId),
    at(`${prefix}3`, "2025-08-02", -5000, { counterparty: "KAUPPA" }, accountId),
    at(`${prefix}4`, "2025-08-02", -5000, { counterparty: "SAHKO" }, accountId),
    at(`${prefix}5`, "2025-08-03", -200, { counterparty: "SAHKO", status: "pending" }, accountId),
  ];

  it("gives one list for copies with other ids and another arrival order", () => {
    const a = rows("a", "pool-a");
    const b = shuffled(rows("z", "pool-b"), 3).reverse();
    const one = joinCopies([{ accountId: "pool-a", rows: a }, { accountId: "pool-b", rows: b }]);
    const other = joinCopies([{ accountId: "pool-b", rows: shuffled(b, 5) }, { accountId: "pool-a", rows: shuffled(a, 9) }]);
    expect(one.tripped).toBe(false);
    expect(one.rows).toHaveLength(5);
    expect(one.rows.every((r) => r.ids.length === 2)).toBe(true);
    expect(rowsOf(other).map(([k]) => k)).toEqual(rowsOf(one).map(([k]) => k));
    expect(new Set(one.rows.map((r) => r.key)).size).toBe(5);
    // two equal rows of one day keep their own places
    expect(one.rows.filter((r) => r.tx.counterparty === "KAUPPA").map((r) => r.key.slice(-5))).toEqual(["00000", "00001"]);
    expect(one.rows.find((r) => r.tx.status === "pending")).toBeDefined();
  });

  it("keeps a row only one copy has outside the days both cover", () => {
    const day = (n: number, id: string, accountId: string) => at(id, `2025-08-${String(n).padStart(2, "0")}`, -1000 - n, { counterparty: `P${n}` }, accountId);
    const a = [1, 5, 10].map((n) => day(n, `a${n}`, "pool-a"));
    const b = [5, 10, 15].map((n) => day(n, `b${n}`, "pool-b"));
    const j = joinCopies([{ accountId: "pool-a", rows: a }, { accountId: "pool-b", rows: b }]);
    expect(j.tripped).toBe(false);
    expect(j.rows.map((r) => r.ids.length)).toEqual([1, 2, 2, 1]);
    expect(j.rows.some((r) => r.unmatched)).toBe(false);
  });

  it("trips inside the days both cover and traces the newer copy alone", () => {
    const base = (accountId: string, prefix: string) => [at(`${prefix}1`, "2025-08-01", 7001, {}, accountId), at(`${prefix}2`, "2025-08-02", -5000, { counterparty: "KAUPPA" }, accountId), at(`${prefix}9`, "2025-08-04", 100, {}, accountId)];
    const sahko = (prefix: string, accountId: string) => at(`${prefix}3`, "2025-08-02", -5000, { counterparty: "SAHKO" }, accountId);
    // the newer copy has the extra row: the older one lacks it, and the older one's rows join the newer one's
    const newer = joinCopies([{ accountId: "pool-a", rows: base("a", "pool-a") }, { accountId: "pool-b", rows: [...base("b", "pool-b"), sahko("b", "pool-b"), at("b8", "2025-08-05", 1, {}, "pool-b")] }]);
    expect(newer.tripped).toBe(true);
    expect(newer.accountId).toBe("pool-b");
    expect(newer.rows).toHaveLength(5);
    expect(newer.rows.some((r) => r.unmatched)).toBe(false);
    // the older copy has the extra row: it has no match in the newer copy and is unknown whole
    const older = joinCopies([{ accountId: "pool-a", rows: [...base("a", "pool-a"), sahko("a", "pool-a")] }, { accountId: "pool-b", rows: [...base("b", "pool-b"), at("b8", "2025-08-05", 1, {}, "pool-b")] }]);
    expect(older.tripped).toBe(true);
    expect(older.rows.filter((r) => r.unmatched).map((r) => r.tx.counterparty)).toEqual(["SAHKO"]);
    // the near miss: the same extra row, but the other copy ends the day before it
    const outside = joinCopies([{ accountId: "pool-a", rows: [...base("a", "pool-a"), at("a4", "2025-08-06", -300, {}, "pool-a")] }, { accountId: "pool-b", rows: base("b", "pool-b") }]);
    expect(outside.tripped).toBe(false);
    expect(outside.rows).toHaveLength(4);
  });

  it("joins a single copy as it is", () => {
    const j = joinCopies([{ accountId: "pool-a", rows: rows("a", "pool-a") }]);
    expect(j.tripped).toBe(false);
    expect(j.rows.every((r) => r.ids.length === 1)).toBe(true);
  });

  it("joins 5 000 rows through a map, not a scan", () => {
    const next = rng(4);
    const make = (accountId: string, prefix: string) => Array.from({ length: 5000 }, (_, i) => at(`${prefix}${i}`, `2025-0${1 + (i % 8)}-${String(1 + (i % 27)).padStart(2, "0")}`, -100 - Math.floor(next() * 10), { counterparty: `P${i % 40}` }, accountId));
    const a = make("pool-a", "a");
    const b = a.map((t, i) => ({ ...t, id: `b${i}`, accountId: "pool-b" }));
    const start = performance.now();
    const j = joinCopies([{ accountId: "pool-a", rows: a }, { accountId: "pool-b", rows: b }]);
    expect(j.rows).toHaveLength(5000);
    expect(performance.now() - start).toBeLessThan(3000);
  });
});

describe("two copies of one account give one answer", () => {
  const history = (accountId: string, prefix: string, order: "forward" | "back", skip?: string): Transaction[] => {
    const list = [
      at(`${prefix}1`, "2025-08-01", 7001, { counterpartyIban: AINO_OWN, counterparty: "AINO KORHONEN" }, accountId),
      at(`${prefix}2`, "2025-08-01", 2999, { counterpartyIban: VILLE_OWN, counterparty: "VILLE LAHTINEN" }, accountId),
      at(`${prefix}3`, "2025-08-02", -5000, { counterparty: "KAUPPA" }, accountId),
      at(`${prefix}4`, "2025-08-02", -5000, { counterparty: "SAHKO" }, accountId),
      at(`${prefix}5`, "2025-08-09", 100, { counterpartyIban: AINO_OWN }, accountId),
    ].filter((t) => t.counterparty !== skip);
    return order === "back" ? list.reverse() : list;
  };
  const cut = (j: Joined, label: string) => {
    const t = trace(traceRows(j, who()), 0, d("2025-08-01"));
    const r = t.rows.find((row) => j.rows.find((x) => x.key === row.key)?.tx.counterparty === label)!;
    return { parts: [AINO, VILLE].map((o) => sum(r.parts.filter((p) => p.owner === o).map((p) => p.cents))), ids: [...r.ids].sort() };
  };

  it("cuts KAUPPA 35,01 / 14,99 and SAHKO 35,00 / 15,00 on both copies whatever the ids and the order", () => {
    const one = joinCopies([{ accountId: "pool-a", rows: history("pool-a", "a", "forward") }, { accountId: "pool-b", rows: history("pool-b", "q", "back") }]);
    const other = joinCopies([{ accountId: "pool-b", rows: history("pool-b", "c", "forward") }, { accountId: "pool-a", rows: history("pool-a", "m", "back") }]);
    for (const j of [one, other]) {
      expect(cut(j, "KAUPPA").parts).toEqual([3501, 1499]);
      expect(cut(j, "SAHKO").parts).toEqual([3500, 1500]);
      expect(cut(j, "SAHKO").ids).toHaveLength(2);
    }
  });

  it("traces the newer copy alone when one copy lacks SAHKO and both cover that day", () => {
    const j = joinCopies([{ accountId: "pool-a", rows: history("pool-a", "a", "forward", "SAHKO") }, { accountId: "pool-b", rows: history("pool-b", "b", "forward") }]);
    expect(j.tripped).toBe(true);
    expect(j.accountId).toBe("pool-b");
    expect(cut(j, "SAHKO").parts).toEqual([3500, 1500]);
    expect(j.rows.some((r) => r.unmatched)).toBe(false);
  });
});

describe("traceRows", () => {
  const read = (rows: Transaction[], payers: Payers = who()) => traceRows(joinCopies([{ accountId: "pool-a", rows }]), payers);

  it("reads an IBAN of an account one person uses alone as that person's own money, in and out", () => {
    const [inRow, outRow, plain] = read([at("1", "2025-08-01", 10000, { counterpartyIban: "FI00 0000 0021" }), at("2", "2025-08-02", -3000, { counterpartyIban: AINO_OWN }), at("3", "2025-08-03", -3000, { counterpartyIban: "FI9999999999" })]);
    expect(inRow!.from).toEqual({ owner: AINO, kind: "own" });
    expect(outRow!.to).toEqual({ owner: AINO });
    expect(plain!.to).toBeUndefined();
  });

  it("reads a leg paired with a row of such an account the same way", () => {
    const others = [at("o1", "2025-08-03", 40000, {}, "aino-own")];
    const [out] = read([at("1", "2025-08-02", -40000)], who({ others }));
    expect(out!.to).toEqual({ owner: AINO });
    const [far] = read([at("1", "2025-08-02", -40000)], who({ others: [at("o1", "2025-08-20", 40000, {}, "aino-own")] }));
    expect(far!.to).toBeUndefined();
  });

  describe("a bill paid to a card account, which has no IBAN", () => {
    const cards = [...accounts, ...["aino-card", "joint-card", "ville-card"].map((id): Account => ({ ...account(id, null), type: "credit_card" }))];
    const card = (over: Partial<Payers> = {}) => who({ accounts: cards, aloneAccount: new Map([["aino-card", AINO], ["ville-card", VILLE]]), ...over });
    const bill = (id: string, date: string, cents: number, over: Partial<Transaction> = {}) => at(id, date, -cents, { counterparty: "ESIMERKKI PANKKI", counterpartyIban: "FI9900000000000009", ...over });
    const leg = (id: string, date: string, cents: number, accountId: string) => at(id, date, cents, { counterparty: "ESIMERKKI PANKKI" }, accountId);

    it("is for the one member who uses the card alone, by the account and not by an IBAN", () => {
      const others = [leg("l1", "2025-08-12", 12000, "aino-card")];
      expect(read([bill("b", "2025-08-12", 12000)], card({ others }))[0]!.to).toEqual({ owner: AINO });
      // the card of the other member, and the day that is too far from the bill
      expect(read([bill("b", "2025-08-12", 12000)], card({ others: [leg("l1", "2025-08-12", 12000, "ville-card")] }))[0]!.to).toEqual({ owner: VILLE });
      expect(read([bill("b", "2025-08-12", 12000)], card({ others: [leg("l1", "2025-08-20", 12000, "aino-card")] }))[0]!.to).toBeUndefined();
      // without the account keyed (what the payers were before): a cost for all
      expect(read([bill("b", "2025-08-12", 12000)], who({ accounts: cards, others }))[0]!.to).toBeUndefined();
    });

    it("stays a cost for all when the card is shared, or its holder is not a member with a login, or no leg is found", () => {
      const joint = [leg("l1", "2025-08-12", 12000, "joint-card")];
      expect(read([bill("b", "2025-08-12", 12000)], card({ others: joint }))[0]!.to).toBeUndefined();
      expect(read([bill("b", "2025-08-12", 12000)], card())[0]!.to).toBeUndefined();
    });

    it("gives the same answer when the bill's text names the holder", () => {
      const others = [leg("l1", "2025-08-12", 12000, "aino-card")];
      const named = bill("b", "2025-08-12", 12000, { counterparty: "AINO KORHONEN", counterpartyIban: null });
      expect(read([named], card({ others }))[0]!.to).toEqual({ owner: AINO });
      expect(read([named], who({ accounts: cards }))[0]!.to).toEqual({ owner: AINO });
    });

    it("counts a card the member also pays from their own account once: only the pool's own bill is a row of the pool", () => {
      const from = at("o1", "2025-08-12", -12000, { counterparty: "ESIMERKKI PANKKI", counterpartyIban: "FI9900000000000009" }, "aino-own");
      const others = [from, leg("l1", "2025-08-12", 12000, "aino-card"), leg("l2", "2025-08-13", 3000, "aino-card")];
      const rows = read([bill("b", "2025-08-12", 12000), bill("c", "2025-08-13", 3000)], card({ others }));
      expect(rows.map((r) => r.to)).toEqual([{ owner: AINO }, { owner: AINO }]);
      expect(rows).toHaveLength(2);
    });
  });

  it("reads the own name at an unlinked bank as hers, by name", () => {
    const [byName, backwards, onePerson, oneWord] = read([
      at("1", "2025-08-01", 5000, { counterparty: "Aino Korhonen" }),
      at("2", "2025-08-01", 5001, { counterparty: "LAHTINEN VILLE" }),
      at("3", "2025-08-02", -2500, { counterparty: "VILLE LAHTINEN" }),
      at("4", "2025-08-03", 5002, { counterparty: "AINO" }),
    ]);
    expect(byName!.from).toEqual({ owner: AINO, kind: "payment" });
    expect(backwards!.from).toEqual({ owner: VILLE, kind: "payment" });
    expect(onePerson!.to).toEqual({ owner: VILLE });
    // one word tells no person
    expect(oneWord!.from).toBeUndefined();
  });

  it("reads a name two users share as nobody's", () => {
    const twins = who({ names: [{ owner: AINO, name: nameOf("KORHONEN AINO") }, { owner: VILLE, name: nameOf("AINO KORHONEN") }] });
    const [inRow, outRow] = read([at("1", "2025-08-01", 5000, { counterparty: "AINO KORHONEN" }), at("2", "2025-08-02", -2500, { counterparty: "AINO KORHONEN" })], twins);
    expect(inRow!.from).toBeUndefined();
    expect(inRow!.group).toBe("g:text:AINO KORHONEN");
    expect(outRow!.to).toBeUndefined();
  });

  it("reads an IBAN that is another pool's as that pool's money, with the parts of the leg when it is traced", () => {
    const leg = at("leg", "2025-08-01", -50000, { counterpartyIban: POOL }, "pool-y");
    const carried: SourcePart[] = [{ owner: AINO, kind: "own", cents: 30000 }, { owner: VILLE, kind: "payment", cents: 15000 }, { owner: "o", kind: "opening", cents: 5000 }];
    const [pooled] = read([at("1", "2025-08-03", 50000, { counterpartyIban: POOL_Y })], who({ others: [leg], legParts: (t) => (t.id === "leg" ? carried : undefined) }));
    expect(pooled!.from).toEqual({
      parts: [
        { owner: AINO, kind: "pool", cents: 30000 },
        { owner: VILLE, kind: "pool", cents: 15000 },
        { owner: `g:iban:${POOL_Y}`, kind: "pool", cents: 5000 },
      ],
    });
    // the other pool is not traced before this one: its money is unknown money of the other pool
    const [untraced] = read([at("1", "2025-08-03", 50000, { counterpartyIban: POOL_Y })], who({ others: [leg] }));
    expect(untraced!.from).toBeUndefined();
    expect(untraced!.group).toBe(`g:iban:${POOL_Y}`);
    // no IBAN on either row: two rows that may be a movement (neither is a recognised purchase) count, up to 3 days before
    const [byLeg] = read([at("1", "2025-08-03", 50000)], who({ others: [{ ...leg, counterpartyIban: null }], legParts: () => carried }));
    expect((byLeg!.from as { parts: SourcePart[] }).parts).toHaveLength(3);
  });

  it("finds a leg up to 3 days before and not 4, and uses it once", () => {
    const leg = (id: string, date: string) => at(id, date, -50000, {}, "pool-y");
    const parts = () => [{ owner: AINO, kind: "own" as const, cents: 50000 }];
    const near = read([at("1", "2025-08-04", 50000)], who({ others: [leg("l", "2025-08-01")], legParts: parts }));
    expect(near[0]!.from).toEqual({ parts: [{ owner: AINO, kind: "pool", cents: 50000 }] });
    const far = read([at("1", "2025-08-05", 50000)], who({ others: [leg("l", "2025-08-01")], legParts: parts }));
    expect(far[0]!.from).toBeUndefined();
    const twice = read([at("1", "2025-08-04", 50000, { counterparty: "A" }), at("2", "2025-08-04", 50000, { counterparty: "B" })], who({ others: [leg("l", "2025-08-01")], legParts: parts }));
    expect(twice.filter((r) => r.from !== undefined)).toHaveLength(1);
  });

  it("reads money out to another pool, by IBAN or by its leg", () => {
    const [byIban, byLeg, plain] = read([at("1", "2025-08-02", -50000, { counterpartyIban: POOL_Y }), at("2", "2025-08-03", -7000), at("3", "2025-08-03", -7100)], who({ others: [at("in", "2025-08-04", 7000, {}, "pool-y")] }));
    expect(byIban!.to).toBe("pool");
    expect(byLeg!.to).toBe("pool");
    expect(plain!.to).toBeUndefined();
  });

  it("asks once for two pools that pay each other: each row is unknown money of the other pool", () => {
    // pool Y paid this pool 500,00 and this pool paid Y 500,00: neither is traced before the other
    const rows = read([at("1", "2025-08-03", 50000, { counterpartyIban: POOL_Y }), at("2", "2025-08-04", -50000, { counterpartyIban: POOL_Y })], who({ others: [at("y", "2025-08-02", -50000, { counterpartyIban: POOL }, "pool-y")] }));
    const t = trace(rows, 0, d("2025-08-03"));
    expect(rows[1]!.to).toBe("pool");
    expect(questionsOf(t, []).map((q) => [q.key, q.cents])).toEqual([[`g:iban:${POOL_Y}`, 50000]]);
  });

  describe("a leg on another pool", () => {
    const FOREIGN = "FI9999999999";
    const groceries = { counterparty: "RUOKAKAUPPA ESIMERKKI", merchant: "RUOKAKAUPPA ESIMERKKI", category: "groceries", categorySource: "mcc" as const, mcc: "5411" };
    const gift = (cents: number, over: Partial<Transaction> = {}, accountId = "pool-y") => at("y1", "2025-09-06", cents, { counterparty: "ESIMERKKI OY", description: "Hyvitys", category: "income", categorySource: "rule", ...over }, accountId);
    const carried = (): SourcePart[] => [{ owner: AINO, kind: "own", cents: 5000 }];
    const shop = (over: Partial<Transaction> = {}, accountId = "pool-a") => at("x3", "2025-09-05", -5000, { ...groceries, ...over }, accountId);
    const readOut = (row: Transaction, others: Transaction[]) => read([row], who({ others }))[0]!;
    const readIn = (row: Transaction, others: Transaction[]) => read([row], who({ others, legParts: carried }))[0]!;
    const fromPool = { parts: [{ owner: AINO, kind: "pool", cents: 5000 }] };

    it("leaves a card purchase of 50,00 and an unrelated 50,00 in on another pool a cost and an income", () => {
      expect(readOut(shop(), [gift(5000)]).to).toBeUndefined();
      // the other pool's side: an income of its own, not money from this pool
      const income = readIn(gift(5000, {}, "pool-a"), [shop({}, "pool-y")]);
      expect(income.from).toBeUndefined();
      expect(income.group).toBe("g:text:ESIMERKKI OY");
      // near miss: 50,01 in is no match either
      expect(readOut(shop(), [gift(5001)]).to).toBeUndefined();
      // near miss: two rows that are no recognised purchase are a movement
      expect(readOut(at("x3", "2025-09-05", -5000), [gift(5000)]).to).toBe("pool");
      expect(readIn(gift(5000, {}, "pool-a"), [at("x3", "2025-09-05", -5000, {}, "pool-y")]).from).toEqual(fromPool);
    });

    it("counts a purchase when one row names the other pool by IBAN", () => {
      // the row names the pool of the leg (with spaces and lower case)
      expect(readOut(shop({ counterpartyIban: "fi00 0000 0031" }), [gift(5000)]).to).toBe("pool");
      // the leg names this pool
      expect(readOut(shop(), [gift(5000, { counterpartyIban: POOL })]).to).toBe("pool");
    });

    it("does not count a leg that an IBAN sends elsewhere", () => {
      // the row names a foreign account, not the pool the leg is on
      expect(readOut(at("x3", "2025-09-05", -5000, { counterpartyIban: FOREIGN }), [gift(5000)]).to).toBeUndefined();
      // the leg names a foreign account, not this pool
      const row = at("1", "2025-09-06", 5000);
      expect(readIn(row, [at("l", "2025-09-05", -5000, { counterpartyIban: FOREIGN }, "pool-y")]).from).toBeUndefined();
      // near miss: the same leg naming this pool counts
      expect(readIn(row, [at("l", "2025-09-05", -5000, { counterpartyIban: POOL }, "pool-y")]).from).toEqual(fromPool);
    });

    it("counts a leg only on an account whose IBAN is a pool's", () => {
      const NOT_POOL = "FI0000000041";
      const payers = (pools: string[]) => who({ accounts: [...accounts, account("else", NOT_POOL)], pools: new Set(pools), others: [at("l", "2025-09-05", -5000, {}, "else")], legParts: carried });
      const row = [at("1", "2025-09-06", 5000)];
      expect(read(row, payers([POOL, POOL_Y]))[0]!.from).toBeUndefined();
      expect(read(row, payers([POOL, POOL_Y, NOT_POOL]))[0]!.from).toEqual(fromPool);
    });
  });

  describe("pending rows", () => {
    const leg = at("o1", "2025-09-01", -115000, {}, "aino-own");
    const booked = at("a1", "2025-09-02", 115000, {}, "pool-a");
    const pending = at("b1", "2025-09-01", 115000, { status: "pending" }, "pool-b");
    const cost = at("c1", "2025-09-03", -110437, { counterparty: "ASUNTOLAINA ESIMERKKI" }, "pool-a");
    const run = (copies: { accountId: string; rows: Transaction[] }[], others = [leg]) => {
      const rows = traceRows(joinCopies(copies), who({ others }));
      const t = trace(rows, 0, d("2025-09-01"));
      return { rows, t, byId: (id: string) => t.rows.find((r) => r.ids.includes(id))! };
    };

    it("pairs the booked row with the leg on Aino's own account, with or without a pending copy of it", () => {
      for (const copies of [[{ accountId: "pool-a", rows: [booked, cost] }], [{ accountId: "pool-a", rows: [booked, cost] }, { accountId: "pool-b", rows: [pending] }]]) {
        const { rows, t, byId } = run(copies);
        expect(byId("a1").parts).toEqual([{ owner: AINO, kind: "own", cents: 115000 }]);
        expect(byId("c1").parts.map((p) => [p.owner, p.cents])).toEqual([[AINO, 110437]]);
        expect(questionsOf(t, [])).toEqual([]);
        expect(rows.filter((r) => r.from !== undefined)).toHaveLength(1);
      }
    });

    it("reads a pending row by IBAN and name only", () => {
      const rows = [booked, at("p1", "2025-09-04", 3000, { status: "pending", counterpartyIban: AINO_OWN }), at("p2", "2025-09-04", 4000, { status: "pending", counterparty: "LAHTINEN VILLE" }), at("p3", "2025-09-04", -3500, { status: "pending", counterpartyIban: VILLE_OWN }), at("p4", "2025-09-04", -5000, { status: "pending", counterpartyIban: POOL_Y })];
      const { rows: read2 } = run([{ accountId: "pool-a", rows }], []);
      const byId = (id: string) => read2.find((r) => r.ids.includes(id))!;
      expect(byId("p1").from).toEqual({ owner: AINO, kind: "own" });
      expect(byId("p2").from).toEqual({ owner: VILLE, kind: "payment" });
      expect(byId("p3").to).toEqual({ owner: VILLE });
      expect(byId("p4").to).toBe("pool");
    });

    it("gives a pending row no leg on another pool, no purchase for a refund and no earlier payment for money back", () => {
      const pend = (id: string, day: string, cents: number, over: Partial<Transaction> = {}) => at(id, day, cents, { status: "pending", ...over });
      const purchase = { counterparty: "KAUPPA", merchant: "KAUPPA", category: "groceries", categorySource: "rule" as const };
      const refund = at("r", "2025-09-07", 4000, { counterparty: "KAUPPA", merchant: "KAUPPA", category: "income" });
      const carried = () => [{ owner: AINO, kind: "own" as const, cents: 5000 }];
      // a pending pay-in does not take the leg on the other pool
      const pooled = read([pend("p1", "2025-09-06", 5000)], who({ others: [at("o2", "2025-09-05", -5000, {}, "pool-y")], legParts: carried }));
      expect(pooled[0]!.from).toBeUndefined();
      // the purchase is pending: the refund pairs with nothing, and the payee was never paid by a booked row
      const rows = read([pend("pk", "2025-09-02", -4000, purchase), refund]);
      expect(rows.find((r) => r.ids[0] === "r")!.from).toBeUndefined();
      // near miss: the purchase booked, the refund pairs with it
      const booked2 = read([at("pk", "2025-09-02", -4000, purchase), refund]);
      expect(booked2[1]!.from).toEqual({ refundOf: booked2[0]!.key });
    });
  });

  describe("a pool's IBAN beats a user's name", () => {
    const fund = [at("x1", "2025-09-01", 60000, { counterpartyIban: AINO_OWN, counterparty: "KORHONEN AINO" }), at("x2", "2025-09-01", 40000, { counterpartyIban: VILLE_OWN, counterparty: "LAHTINEN VILLE" })];
    const of = (t: ReturnType<typeof trace>, id: string) => t.rows.find((r) => r.ids.includes(id))!;
    const both = (name: string | null) => {
      const out = at("x3", "2025-09-05", -70000, { counterpartyIban: POOL_Y, counterparty: name });
      const into = at("y1", "2025-09-05", 70000, { counterpartyIban: POOL, counterparty: name }, "pool-y");
      const rent = at("y2", "2025-09-10", -70000, { counterparty: "VUOKRANANTAJA ESIMERKKI" }, "pool-y");
      const xRows = traceRows(joinCopies([{ accountId: "pool-a", rows: [...fund, out] }]), who({ others: [into, rent] }));
      const x = trace(xRows, 0, d("2025-09-01"));
      const legParts = (leg: Transaction) => of(x, leg.id).parts;
      const yRows = traceRows(joinCopies([{ accountId: "pool-y", rows: [into, rent] }]), who({ others: [...fund, out], legParts }));
      const y = trace(yRows, 0, d("2025-09-05"));
      return { xRows, yRows, out: of(x, "x3"), into: of(y, "y1"), rent: of(y, "y2"), lots: x.lots };
    };
    const cents = (parts: readonly SourcePart[]) => parts.map((p) => [p.owner, p.kind, p.cents]);

    it("gives the same parts with and without the name, to the cent", () => {
      const plain = both(null);
      const named = both("KORHONEN AINO");
      expect(plain.out.what).toBe("pool");
      expect(cents(plain.out.parts)).toEqual([[AINO, "own", 42000], [VILLE, "own", 28000]]);
      expect(cents(plain.into.parts)).toEqual([[AINO, "pool", 42000], [VILLE, "pool", 28000]]);
      expect(cents(plain.rent.parts)).toEqual([[AINO, "pool", 42000], [VILLE, "pool", 28000]]);
      for (const k of ["out", "into", "rent"] as const) expect([named[k].what, named[k].parts]).toEqual([plain[k].what, plain[k].parts]);
      expect(named.lots).toEqual(plain.lots);
      expect(named.xRows[2]!.to).toBe("pool");
      expect(named.yRows[0]!.from).toEqual(plain.yRows[0]!.from);
    });

    it("still reads the name of a row whose IBAN is no account of the household, and of a row with no IBAN", () => {
      const [foreign, none, self] = read([at("1", "2025-08-01", 5000, { counterparty: "KORHONEN AINO", counterpartyIban: "FI9999999999" }), at("2", "2025-08-02", 5001, { counterparty: "KORHONEN AINO" }), at("3", "2025-08-03", 5002, { counterparty: "KORHONEN AINO", counterpartyIban: POOL })]);
      expect(foreign!.from).toEqual({ owner: AINO, kind: "payment" });
      expect(none!.from).toEqual({ owner: AINO, kind: "payment" });
      // this pool's own IBAN is an account of the household: the name is not read
      expect(self!.from).toBeUndefined();
    });
  });

  it("pairs a refund with its purchase and reads money back from a payee paid before", () => {
    const rows = read([
      at("p", "2025-08-01", -4000, { counterparty: "KAUPPA", merchant: "KAUPPA", category: "groceries", categorySource: "rule" }),
      at("r", "2025-08-05", 4000, { counterparty: "KAUPPA", merchant: "KAUPPA", category: "income" }),
      at("big", "2025-08-06", 9000, { counterparty: "KAUPPA", merchant: "KAUPPA", category: "income" }),
      at("new", "2025-08-07", 800, { counterparty: "KIRJASTO", merchant: "KIRJASTO", category: "income" }),
      at("early", "2025-07-30", 300, { counterparty: "KAUPPA", merchant: "KAUPPA", category: "income" }),
    ]);
    const byId = (id: string) => rows.find((r) => r.ids[0] === id)!;
    expect(byId("r").from).toEqual({ refundOf: byId("p").key });
    // paid before, no pair left: money back
    expect(byId("big").from).toBe("back");
    // never paid, or paid only later: unknown money of its payer
    expect(byId("new").from).toBeUndefined();
    expect(byId("new").group).toBe("g:text:KIRJASTO");
    expect(byId("early").from).toBeUndefined();
  });

  it("names the payer of unknown money by its IBAN, else by its name or text", () => {
    const [iban, name, text] = read([at("1", "2025-08-01", 100, { counterpartyIban: "fi99 0000 1111" }), at("2", "2025-08-01", 101, { counterparty: "Ääkkönen Oy" }), at("3", "2025-08-01", 102, { description: "Lahjoitus" })]);
    expect(iban!.group).toBe("g:iban:FI990000111".concat("1"));
    expect(name!.group).toBe("g:text:AAKKONEN OY");
    expect(text!.group).toBe("g:text:LAHJOITUS");
  });

  it("carries pending rows, rows only one copy has, and the ids of every copy", () => {
    const j = joinCopies([{ accountId: "pool-a", rows: [at("a1", "2025-08-01", 100, { status: "pending" })] }]);
    const [r] = traceRows(j, who());
    expect(r!.pending).toBe(true);
    expect(r!.ids).toEqual(["a1"]);
    const un: Joined = { accountId: "pool-a", tripped: true, rows: [{ key: "k", ids: ["x"], tx: at("x", "2025-08-01", -100), unmatched: true }] };
    expect(traceRows(un, who())[0]).toMatchObject({ unmatched: true, cents: -100 });
  });

  it("gives one trace for the shuffled rows of a pool", () => {
    const rows = [
      at("1", "2025-08-01", 100000, { counterpartyIban: AINO_OWN }),
      at("2", "2025-08-02", -4000, { counterparty: "KAUPPA", merchant: "KAUPPA", category: "groceries", categorySource: "rule" }),
      at("3", "2025-08-05", 4000, { counterparty: "KAUPPA", merchant: "KAUPPA" }),
      at("4", "2025-08-06", -30000, { counterpartyIban: AINO_OWN }),
    ];
    const run = (list: Transaction[]) => trace(traceRows(joinCopies([{ accountId: "pool-a", rows: list }]), who()), 0, d("2025-08-01"));
    const base = run(rows);
    for (let seed = 1; seed <= 20; seed++) expect(run(shuffled(rows, seed))).toEqual(base);
  });
});

function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const next = rng(seed);
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
