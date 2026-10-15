/**
 * Whose money paid a joint account, kept and served: the parts a real account's rows are built with, from one copy and
 * from two, what an answer moves, when the app cuts an account by who paid, and what a build never leaves half done.
 * Made-up names and sums; the first user by id is "Aino", so the cent that rounding gives the first is hers.
 */
import { join } from "node:path";
import { dayNumber, partCents } from "@banking/core";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { accountKey, type PartRow } from "../src/db/household-repo.ts";
import { openDatabase } from "../src/db/open.ts";
import { loadConfig } from "../src/platform/config.ts";
import { usesInView } from "../src/services/account-use.ts";
import { ensureTrace, sayAnswer, type SettledTrace, settledTrace, sharesOf, takeBackAnswer } from "../src/services/money-trace.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { loadFixture } from "./fixture-db.ts";
import { scratchDir } from "./helpers.ts";
import { AINO, type Copy, cents, fromAino, fromVille, IBAN, KEY, link, one, raw, type R, VILLE, type World, world } from "./trace-world.ts";

/** The stored parts of these accounts' rows without the ids, so two builds of one account compare. */
async function dump(w: World, ...accountIds: string[]): Promise<string[]> {
  await ensureTrace(w.s, KEY);
  return stored(w, ...accountIds);
}
async function stored(w: World, ...accountIds: string[]): Promise<string[]> {
  const rows = await w.db.all<{ line: string }>(
    `SELECT t.booking_date || '|' || t.amount_cents || '|' || COALESCE(t.counterparty, '') || '|' || p.owner || '|' || p.kind || '|' || p.grp || '|' || p.cents || '|' || p.passed AS line
     FROM tx_part p JOIN transactions t ON t.id = p.tx_id WHERE t.account_id IN (${accountIds.map(() => "?").join(",")}) ORDER BY t.booking_date, t.amount_cents, t.counterparty, p.owner, p.kind, p.grp`,
    accountIds,
  );
  return rows.map((r) => r.line.replaceAll(`u:${w.aino}`, "A").replaceAll(`u:${w.ville}`, "V"));
}
const dumpOf = (lines: string[], date: string, euros: number) => lines.filter((l) => l.startsWith(`${date}|${Math.round(euros * 100)}|`)).map((l) => l.split("|").slice(3).join("|"));

const rowAt = (t: SettledTrace, date: string, euros: number) => t.trace.rows.find((r) => r.day === dayNumber(date) && r.cents === Math.round(euros * 100))!;
const ownerCents = (t: SettledTrace, date: string, euros: number, owner: string) => rowAt(t, date, euros).parts.filter((p) => p.owner === owner).reduce((n, p) => n + p.cents, 0);
const A = (w: World) => `u:${w.aino}`;
const V = (w: World) => `u:${w.ville}`;

async function sharesFor(w: World, t: SettledTrace, userId: string, accountId = "pool-a") {
  const account = (await w.s.finance(w.aino).getAccount(accountId)) ?? (await w.s.finance(w.ville).getAccount(accountId))!;
  const part = (await usesInView(w.s, userId, [account])).get(accountId)!.part;
  return { part, shares: sharesOf(t, userId, part) };
}
const shareAt = (t: SettledTrace, shares: ReturnType<typeof sharesOf>, date: string, euros: number) => shares.get(rowAt(t, date, euros).ids[0]!)!;

const MORTGAGE = (date: string): R => [date, -1104.37, "ESIMERKKI PANKKI"];
/** The spec's first household: an opening of 3 120,45 and one member who funds the pool. */
const T1: R[] = [fromAino("2026-07-01", 1150), MORTGAGE("2026-07-03"), ["2026-07-05", -45.63, "ESIMERKKIMAKSUT OY"], MORTGAGE("2026-08-03"), fromAino("2026-09-01", 1150), MORTGAGE("2026-09-03")];

describe("one member funds the pool and the opening has no owner", () => {
  it("cuts each row by who paid, takes the opening only when the money is short, and ends where the walked balance does", async () => {
    const w = await world(one(T1, 312045));
    const t = (await settledTrace(w.s, KEY))!;
    expect(ownerCents(t, "2026-07-03", -1104.37, A(w))).toBe(110437);
    expect(ownerCents(t, "2026-07-05", -45.63, A(w))).toBe(4563);
    // August: Aino's money is gone, so the mortgage takes the opening, whose owner nobody has said
    expect(rowAt(t, "2026-08-03", -1104.37).parts).toEqual([{ owner: "o", kind: "opening", cents: 110437 }]);
    expect(ownerCents(t, "2026-09-03", -1104.37, A(w))).toBe(110437);
    expect(t.questions).toMatchObject([{ kind: "opening", key: "o", cents: 312045, openCents: 110437 }]);
    // lots = the walked balance
    expect(t.trace.lots.reduce((n, l) => n + l.cents, 0)).toBe(312045 + cents(T1));
    expect(t.trace.lots.filter((l) => l.owner === "o").reduce((n, l) => n + l.cents, 0)).toBe(201608);
    const stored = await dump(w, "pool-a");
    expect(dumpOf(stored, "2026-08-03", -1104.37)).toEqual(["?|opening|o|110437|0"]);
    // Aino's own view of August: her half of what nobody owns, all of it open
    const her = await sharesFor(w, t, w.aino);
    expect(shareAt(t, her.shares, "2026-08-03", -1104.37)).toEqual({ cents: -partCents(110437, her.part), openCents: -partCents(110437, her.part), transfer: false });
    expect(partCents(110437, her.part)).toBe(55219);
  });

  it("an answer to the opening relabels that row and moves no other row; taking it back restores every row", async () => {
    const w = await world(one(T1, 312045));
    const before = await dump(w, "pool-a");
    const august = (lines: string[]) => dumpOf(lines, "2026-08-03", -1104.37);
    const others = (lines: string[]) => lines.filter((l) => !l.startsWith("2026-08-03|"));
    const expected: Record<string, string[]> = {
      [A(w)]: ["A|opening||110437|0"],
      [V(w)]: ["V|opening||110437|0"],
      all: ["A|opening||55219|0", "V|opening||55218|0"],
      none: ["-|opening|o|110437|0"],
    };
    for (const owner of [A(w), V(w), "all", "none"]) {
      await sayAnswer(w.s, KEY, { kind: "opening", key: "o", owner }, w.aino);
      const after = await dump(w, "pool-a");
      expect(august(after), owner).toEqual(expected[owner]);
      expect(others(after), owner).toEqual(others(before));
      await takeBackAnswer(w.s, KEY, "opening", "o");
      expect(await dump(w, "pool-a"), owner).toEqual(before);
    }
    // the question stands again, and a said answer is no question
    expect((await settledTrace(w.s, KEY))!.questions).toHaveLength(1);
    await sayAnswer(w.s, KEY, { kind: "opening", key: "o", owner: "none" }, w.aino);
    expect((await settledTrace(w.s, KEY))!.questions).toHaveLength(0);
  });

  it("refuses a key no question stands for and an owner who is no user of the account", async () => {
    const w = await world(one(T1, 312045));
    await expect(sayAnswer(w.s, KEY, { kind: "in", key: "g:text:nobody", owner: A(w) }, w.aino)).rejects.toThrow("Kysymystä ei löydy.");
    await expect(sayAnswer(w.s, KEY, { kind: "opening", key: "o", owner: "u:somebody" }, w.aino)).rejects.toThrow("Valitse yksi tilin käyttäjistä.");
    // the holders who are no user of this instance are not users of this account either
    await expect(sayAnswer(w.s, KEY, { kind: "opening", key: "o", owner: "u:" }, w.aino)).rejects.toThrow("Valitse yksi tilin käyttäjistä.");
    expect(await w.db.all("SELECT * FROM owner_answer")).toEqual([]);
    // near miss: a user of the account is accepted
    await sayAnswer(w.s, KEY, { kind: "opening", key: "o", owner: V(w) }, w.aino);
    expect(await w.db.all("SELECT account_key, kind, key, owner, said_by FROM owner_answer")).toEqual([{ account_key: KEY, kind: "opening", key: "", owner: V(w), said_by: w.aino }]);
  });
});

describe("unknown money", () => {
  const T5 = (unknown: number): R[] => [["2026-09-01", unknown, "ESIMERKKI OY"], fromAino("2026-09-02", 200), ["2026-09-05", -190, "KAUPPA"]];

  it("an answer relabels the money of its payer and no other row; the limit of asking is 100,00", async () => {
    const w = await world(one(T5(2500), 0));
    const t = (await settledTrace(w.s, KEY))!;
    const group = t.questions[0]!;
    expect(group).toMatchObject({ kind: "in", cents: 250000, openCents: 267593 });
    expect(ownerCents(t, "2026-09-05", -190, A(w))).toBe(1407);
    const before = await dump(w, "pool-a");
    expect(dumpOf(before, "2026-09-05", -190)).toEqual([`?|unknown|${group.key}|17593|0`, "A|own||1407|0"].sort());
    // before any answer Aino sees her half of the open money and is asked about it
    const her = await sharesFor(w, t, w.aino);
    expect(shareAt(t, her.shares, "2026-09-05", -190)).toEqual({ cents: -10204, openCents: -8797, transfer: false });
    // a row that carried an open part may change; every other row stays as it was
    const open = new Set(before.filter((l) => l.includes("|?|")).map((l) => l.split("|").slice(0, 3).join("|")));
    const same = (lines: string[]) => lines.filter((l) => !open.has(l.split("|").slice(0, 3).join("|")));
    const expected: [string, string[]][] = [
      [V(w), ["A|own||1407|0", "V|unknown||17593|0"]],
      ["all", ["A|own||1407|0", "A|unknown||8797|0", "V|unknown||8796|0"]],
      ["none", ["A|own||1407|0", `-|unknown|${group.key}|17593|0`]],
    ];
    for (const [owner, lines] of expected) {
      await sayAnswer(w.s, KEY, { kind: "in", key: group.key, owner }, w.aino);
      const after = await dump(w, "pool-a");
      expect(dumpOf(after, "2026-09-05", -190), owner).toEqual([...lines].sort());
      expect(same(after), owner).toEqual(same(before));
      await takeBackAnswer(w.s, KEY, "in", group.key);
      expect(await dump(w, "pool-a"), owner).toEqual(before);
    }
    // a 'none' is not asked again
    await sayAnswer(w.s, KEY, { kind: "in", key: group.key, owner: "none" }, w.aino);
    expect((await settledTrace(w.s, KEY))!.questions).toEqual([]);
  });

  it("below 100,00 nobody is asked and Aino's money pays the costs; at 100,00 the question stands", async () => {
    const small = await world(one(T5(99.99), 0));
    const s = (await settledTrace(small.s, KEY))!;
    expect(s.questions).toEqual([]);
    expect(dumpOf(await dump(small, "pool-a"), "2026-09-05", -190)).toEqual(["A|own||19000|0"]);
    const exact = await world(one(T5(100), 0));
    const t = (await settledTrace(exact.s, KEY))!;
    expect(dumpOf(await dump(exact, "pool-a"), "2026-09-05", -190)).toEqual([`?|unknown|${t.questions[0]!.key}|6333|0`, "A|own||12667|0"].sort());
  });

  it("money from a member who is no user of the pool is unknown money, and cannot be an answer's owner", async () => {
    const w = await world(
      one([fromAino("2026-09-01", 1000), ["2026-09-02", 500, "KOSKINEN CECILIA", IBAN.cecilia], ["2026-09-05", -600, "ASUNTO OY ESIMERKKI"]], 0, {
        extra: async (x) => {
          const cecilia = await x.member("cecilia", "Cecilia");
          await link(x, cecilia.id, "cecilia-own", "KOSKINEN CECILIA", IBAN.cecilia, "idn-cecilia");
        },
      }),
    );
    const t = (await settledTrace(w.s, KEY))!;
    expect(t.users.map((u) => u.owner)).toEqual([A(w), V(w)]);
    // her 500,00 is a question, not a part of the rent: the rent is cut 1000 : 500 over what nobody has said
    const group = t.questions.find((q) => q.kind === "in")!;
    expect(group.cents).toBe(50000);
    expect(ownerCents(t, "2026-09-05", -600, A(w))).toBe(40000);
    expect(rowAt(t, "2026-09-05", -600).parts.filter((p) => p.owner.startsWith("g:"))).toEqual([{ owner: group.key, kind: "unknown", cents: 20000 }]);
    await expect(sayAnswer(w.s, KEY, { kind: "in", key: group.key, owner: "u:cecilia" }, w.aino)).rejects.toThrow("Valitse yksi tilin käyttäjistä.");
    // the users' cents add up to the row
    const [a, v] = [await sharesFor(w, t, w.aino), await sharesFor(w, t, w.ville)];
    expect(shareAt(t, a.shares, "2026-09-05", -600).cents + shareAt(t, v.shares, "2026-09-05", -600).cents).toBe(-60000);
  });
});

describe("two copies of one real account", () => {
  const BASE: R[] = [fromAino("2026-09-01", 70.01), fromVille("2026-09-01", 29.99), ["2026-09-02", -50, "KAUPPA"], ["2026-09-02", -50, "SAHKO"]];
  const both = (a: R[], v: R[]): Copy[] => [{ by: "aino", id: "pool-a", rows: a }, { by: "ville", id: "pool-v", rows: v }];

  it("rows arriving in two orders and two sides give one set of parts on both copies, whoever shared what", async () => {
    const forward = await world({ copies: both(BASE, BASE), balance: 0 });
    const backward = await world({ copies: both(BASE, [...BASE].reverse()).reverse(), balance: 0, share: true });
    const alone = await world({ copies: [{ by: "aino", id: "pool-a", rows: BASE }], balance: 0 });
    const reference = await dump(alone, "pool-a");
    expect(dumpOf(reference, "2026-09-02", -50)).toEqual(expect.arrayContaining(["A|own||3501|0"]));
    for (const x of [forward, backward]) {
      await ensureTrace(x.s, KEY);
      expect(await dump(x, "pool-a")).toEqual(reference);
      expect(await dump(x, "pool-v")).toEqual(reference);
      // one part of a row, not one for each copy that asked: the key of the table holds it
      expect(await x.db.all("SELECT count(*) AS n FROM tx_part")).toEqual([{ n: 2 * reference.length }]);
      const t = (await settledTrace(x.s, KEY))!;
      expect(ownerCents(t, "2026-09-02", -50, A(x))).toBe(3501);
      expect(ownerCents(t, "2026-09-02", -50, V(x))).toBe(1499);
      const [a, v] = [await sharesFor(x, t, x.aino), await sharesFor(x, t, x.ville, "pool-v")];
      for (const row of t.trace.rows) {
        for (const id of row.ids) expect(a.shares.get(id)!.cents + v.shares.get(id)!.cents, `${row.key} ${id}`).toBe(row.cents);
      }
    }
  });

  it("a copy a month shorter and a stale copy still get the parts of the longer one", async () => {
    const longer: R[] = [fromAino("2026-08-01", 100), ["2026-08-02", -30, "KIOSKI"], ...BASE, fromAino("2026-09-10", 20)];
    const balance = cents(longer);
    const shorter = BASE;
    const stale = longer.slice(0, -1);
    for (const second of [shorter, stale]) {
      const w = await world({ copies: both(longer, second), balance });
      const t = (await settledTrace(w.s, KEY))!;
      const [a, v] = [await sharesFor(w, t, w.aino), await sharesFor(w, t, w.ville, "pool-v")];
      for (const row of t.trace.rows) {
        expect(row.ids.length).toBeGreaterThan(0);
        for (const id of row.ids) expect(a.shares.get(id)!.cents + v.shares.get(id)!.cents, row.key).toBe(row.cents);
      }
      const all = await dump(w, "pool-a", "pool-v");
      // every row the shorter copy holds has the parts the longer one gives it
      const onA = await dump(w, "pool-a");
      for (const line of await dump(w, "pool-v")) expect(onA).toContain(line);
      expect(all.length).toBeGreaterThan(0);
    }
  });

  it("a copy that lacks a row both cover is not trusted: the newer copy is traced alone and the other's rows take its parts", async () => {
    const lacking = BASE.filter((r) => r[2] !== "SAHKO");
    const w = await world({ copies: both(BASE, lacking), balance: 0 });
    const onA = await dump(w, "pool-a");
    const onV = await dump(w, "pool-v");
    expect(dumpOf(onA, "2026-09-02", -50)).toHaveLength(4);
    expect(onV).toEqual(onA.filter((l) => !l.includes("|-5000|") || l.startsWith("2026-09-02|-5000|KAUPPA")));
    expect(dumpOf(onV, "2026-09-02", -50)).toEqual(["A|own||3501|0", "V|own||1499|0"].sort());
  });
});

describe("the pool is cut by who paid, set by the app once", () => {
  const WINDOW_OK: R[] = [fromAino("2026-07-01", 1150), MORTGAGE("2026-07-03"), ["2026-07-05", -45.63, "ESIMERKKIMAKSUT OY"], fromAino("2026-08-01", 1150), MORTGAGE("2026-08-03"), fromAino("2026-09-01", 1150), MORTGAGE("2026-09-03")];
  const splits = (w: World) => w.db.all("SELECT account_key, mode, set_by FROM account_split");

  it("sets the split when every condition holds, with no member as setter, once; the mix of the next month moves nothing", async () => {
    const w = await world(one(WINDOW_OK, 312045));
    const first = (await ensureTrace(w.s, KEY))!;
    expect(first).toMatchObject({ hasTrace: true, traced: true, split: { by: "app" } });
    expect(await splits(w)).toEqual([{ account_key: KEY, mode: "source", set_by: null }]);
    expect((await settledTrace(w.s, KEY))!.offer).toBeNull();
    // next month: Ville pays most of what comes in, a cost row has no owner; nothing is checked again
    w.clock.at = new Date("2026-11-09T10:00:00Z");
    await ingestTransactions(w.s.finance(w.aino), "pool-a", [raw(fromVille("2026-10-20", 3000)), raw(["2026-10-25", -400, "ESIMERKKI OY"]) ].map((r) => r), "enablebanking");
    await w.s.settings.bumpUserDataVersion(w.aino);
    const later = (await ensureTrace(w.s, KEY))!;
    expect(later.split).toEqual(first.split);
    expect(await splits(w)).toEqual([{ account_key: KEY, mode: "source", set_by: null }]);
  });

  it("is not set while the opening takes a cost (C4) or after an answer (C5), and then offers the traced split", async () => {
    const w = await world(one(T1, 312045));
    expect(await ensureTrace(w.s, KEY)).toMatchObject({ hasTrace: true, traced: false });
    // a failed C4 writes nothing: no split, no answer, and the opening is asked about
    expect(await w.db.all("SELECT * FROM account_split")).toEqual([]);
    const t = (await settledTrace(w.s, KEY))!;
    expect(t.questions.map((q) => q.kind)).toEqual(["opening"]);
    expect(t.offer).toBeNull();
    await sayAnswer(w.s, KEY, { kind: "opening", key: "o", owner: A(w) }, w.aino);
    expect(await ensureTrace(w.s, KEY)).toMatchObject({ traced: false });
    expect(await w.db.all("SELECT * FROM account_split")).toEqual([]);
    // the weights are 1 and 1 and the window was paid by Aino alone
    expect((await settledTrace(w.s, KEY))!.offer).toEqual([{ userId: w.aino, percent: 100 }, { userId: w.ville, percent: 0 }]);
  });

  it("near misses: a said use, one holder on the line, a first row after the window starts, a window with no cost", async () => {
    const said = await world(one(WINDOW_OK, 312045));
    await said.s.household.setUse(KEY, [{ userId: said.aino, weight: 1 }, { userId: said.ville, weight: 1 }], said.aino, "2026-10-01T00:00:00.000Z");
    expect(await ensureTrace(said.s, KEY)).toMatchObject({ hasTrace: true, traced: false });
    expect(await said.db.all("SELECT * FROM account_split")).toEqual([]);

    const noLine = await world(one(WINDOW_OK, 312045, { holder: null, copies: [{ by: "aino", id: "pool-a", rows: WINDOW_OK }, { by: "ville", id: "pool-v", rows: WINDOW_OK }] }));
    expect((await usesInView(noLine.s, noLine.aino, [(await noLine.s.finance(noLine.aino).getAccount("pool-a"))!])).get("pool-a")!.use.source).toBe("owner");
    expect(await ensureTrace(noLine.s, KEY)).toMatchObject({ traced: false });
    expect(await noLine.db.all("SELECT * FROM account_split")).toEqual([]);

    const late = await world(one(WINDOW_OK.map((r, i): R => (i === 0 ? fromAino("2026-07-02", 1150) : r)), 312045));
    expect(await ensureTrace(late.s, KEY)).toMatchObject({ traced: false });
    expect(await late.db.all("SELECT * FROM account_split")).toEqual([]);

    const noCost = await world(one([fromAino("2026-07-01", 1150), fromAino("2026-08-01", 1150), MORTGAGE("2026-10-03")], 312045));
    expect(await ensureTrace(noCost.s, KEY)).toMatchObject({ traced: false });
    expect(await noCost.db.all("SELECT * FROM account_split")).toEqual([]);
  });
});

describe("a member who pays all the money in, one who takes some out, and one who never touches the pool", () => {
  const holds = async (w: World, ...dates: [string, number][]) => {
    const t = (await settledTrace(w.s, KEY))!;
    const [a, v] = [await sharesFor(w, t, w.aino), await sharesFor(w, t, w.ville)];
    return { t, a, v, rows: dates.map(([d, e]) => [shareAt(t, a.shares, d, e), shareAt(t, v.shares, d, e)] as const) };
  };
  const ownAccounts = async (w: World) => link(w, w.ville, "ville-card", VILLE, IBAN.card, "idn-card", "credit_card");

  it("S17: the payer bears the shared bills whole; what the other takes is passed, a transfer on both sides", async () => {
    const rows: R[] = [fromAino("2026-09-01", 1000), ["2026-09-03", -300, VILLE, IBAN.ville], ["2026-09-04", -80, "VISA", IBAN.card], ["2026-09-05", -600, "ASUNTO OY ESIMERKKI"]];
    const w = await world(one(rows, 0, { extra: ownAccounts }));
    const { t, rows: shares } = await holds(w, ["2026-09-03", -300], ["2026-09-04", -80], ["2026-09-05", -600]);
    expect(rowAt(t, "2026-09-03", -300)).toMatchObject({ what: "one", to: V(w), parts: [{ owner: A(w), kind: "own", cents: 30000, passed: true }] });
    expect(rowAt(t, "2026-09-04", -80)).toMatchObject({ what: "one", parts: [{ owner: A(w), cents: 8000, passed: true }] });
    // her takings are a transfer for her (never a cost) and nothing at all for him; the rent is hers whole, none of it his
    expect(shares[0]![0]).toEqual({ cents: -30000, openCents: 0, transfer: true });
    expect(shares[1]![0]).toEqual({ cents: -8000, openCents: 0, transfer: true });
    expect(shares[2]![0]).toEqual({ cents: -60000, openCents: 0, transfer: false });
    for (const [, his] of shares) expect(his.cents).toBe(0);
    // no weight nobody said lands on a member: not a cent is unknown, nothing is asked
    const stored = await dump(w, "pool-a");
    expect(stored.filter((l) => l.includes("|?|") || l.includes("|-|"))).toEqual([]);
    expect(t.questions).toEqual([]);
    expect(t.trace.lots).toEqual([{ owner: A(w), kind: "own", cents: 2000, tier: 1 }]);
  });

  it("S17 near miss: what the taker paid in himself is his own to take back, and only the rest is passed", async () => {
    const rows: R[] = [fromAino("2026-09-01", 1000), fromVille("2026-09-02", 200), ["2026-09-03", -300, VILLE, IBAN.ville], ["2026-09-04", -80, "VISA", IBAN.card], ["2026-09-05", -600, "ASUNTO OY ESIMERKKI"]];
    const w = await world(one(rows, 0, { extra: ownAccounts }));
    const { t, rows: shares } = await holds(w, ["2026-09-03", -300], ["2026-09-05", -600]);
    expect(rowAt(t, "2026-09-03", -300).parts).toEqual([{ owner: A(w), kind: "own", cents: 10000, passed: true }, { owner: V(w), kind: "own", cents: 20000 }]);
    expect(shares[0]).toEqual([{ cents: -10000, openCents: 0, transfer: true }, { cents: -20000, openCents: 0, transfer: true }]);
    // what was left of her money pays the rent
    expect(ownerCents(t, "2026-09-05", -600, A(w))).toBe(60000);
    expect(shares[1]![1]!.cents).toBe(0);
  });

  it("S18: a member who never touches the pool bears none of its bills, and the account's rows stay whole", async () => {
    const rows: R[] = [fromAino("2026-09-01", 900), ["2026-09-03", -400, "SAHKO OY"], ["2026-09-04", -250, "VESI OY"]];
    const w = await world(one(rows, 0));
    const { t, rows: shares } = await holds(w, ["2026-09-03", -400], ["2026-09-04", -250]);
    expect(shares).toEqual([
      [{ cents: -40000, openCents: 0, transfer: false }, { cents: 0, openCents: 0, transfer: false }],
      [{ cents: -25000, openCents: 0, transfer: false }, { cents: 0, openCents: 0, transfer: false }],
    ]);
    expect(t.trace.rows.map((r) => r.cents)).toEqual([90000, -40000, -25000]);
    // near miss: he pays in 100,00 first and then bears his share of what the money was
    const paid = await world(one([fromVille("2026-09-01", 100), ...rows], 0));
    const after = await holds(paid, ["2026-09-03", -400], ["2026-09-04", -250]);
    expect(after.rows.map(([a, v]) => [a.cents, v.cents])).toEqual([[-36000, -4000], [-22500, -2500]]);
  });

  it("S19: a payment to the credit of one member is money out for him, from his own lots first and the rest passed; a credit in both names stays shared", async () => {
    const credit = async (w: World) => link(w, w.ville, "ville-credit", VILLE, IBAN.card, "idn-credit", "credit_card");
    const rows: R[] = [fromAino("2026-09-01", 1000), fromVille("2026-09-01", 200), ["2026-09-05", -350, "JOUSTOLUOTTO", IBAN.card]];
    const w = await world(one(rows, 0, { extra: credit }));
    const { t, rows: shares } = await holds(w, ["2026-09-05", -350]);
    expect(rowAt(t, "2026-09-05", -350)).toMatchObject({ what: "one", to: V(w), parts: [{ owner: A(w), kind: "own", cents: 15000, passed: true }, { owner: V(w), kind: "own", cents: 20000 }] });
    // his money first; hers that he took is a transfer for her, never a cost, and the sums add up to the payment
    expect(shares[0]).toEqual([{ cents: -15000, openCents: 0, transfer: true }, { cents: -20000, openCents: 0, transfer: true }]);
    // the credit is used by him alone, so its own rows are his in every view
    const account = (await w.s.finance(w.ville).getAccount("ville-credit"))!;
    expect((await usesInView(w.s, w.aino, [account])).get("ville-credit")!.use.users.map((u) => u.userId)).toEqual([w.ville]);

    const shared = await world(
      one([fromAino("2026-09-01", 1000), fromVille("2026-09-01", 200), ["2026-09-05", -350, "ASUNTOLAINA", IBAN.loan]], 0, {
        extra: async (x) => {
          await link(x, x.aino, "loan-a", `${AINO}, ${VILLE}`, IBAN.loan, "idn-loan", "loan");
          await link(x, x.ville, "loan-v", `${AINO}, ${VILLE}`, IBAN.loan, "idn-loan", "loan");
        },
      }),
    );
    const both = await holds(shared, ["2026-09-05", -350]);
    expect(rowAt(both.t, "2026-09-05", -350)).toMatchObject({ what: "pool", parts: [{ owner: A(shared), cents: 29167 }, { owner: V(shared), cents: 5833 }] });
    expect(both.rows[0]!.map((s) => s.cents)).toEqual([-29167, -5833]);
  });
});

describe("the parts heal from what changed", () => {
  const rows: R[] = [fromAino("2026-09-01", 500), ["2026-09-02", -100, "KAUPPA"]];

  it("a restored older copy and a changed row differ in the signature, build again, and write only what changed", async () => {
    const w = await world(one(rows, 0));
    const first = (await ensureTrace(w.s, KEY))!;
    const snapshot = {
      parts: await w.db.all<Record<string, string | number>>("SELECT * FROM tx_part"),
      state: await w.db.all<Record<string, string | number>>("SELECT * FROM tx_part_state"),
    };
    // nothing changed: nothing is built, nothing written
    const builtAt = (await w.s.household.partsState(KEY))!.builtAt;
    w.clock.at = new Date("2026-10-09T11:00:00Z");
    expect((await ensureTrace(w.s, KEY))!.signature).toBe(first.signature);
    expect((await w.s.household.partsState(KEY))!.builtAt).toBe(builtAt);

    // a new row at the end: the signature differs and only the new row's parts are written
    await w.db.run("CREATE TABLE writes (tx_id TEXT)");
    await w.db.run("CREATE TRIGGER count_writes AFTER INSERT ON tx_part BEGIN INSERT INTO writes VALUES (NEW.tx_id); END");
    await w.db.run("UPDATE accounts SET balance_cents = 30000 WHERE id = 'pool-a'");
    await ingestTransactions(w.s.finance(w.aino), "pool-a", [raw(rows[0]!), raw(rows[1]!), raw(["2026-09-03", -100, "KAUPPA OY"])], "enablebanking");
    await w.s.settings.bumpUserDataVersion(w.aino);
    const second = (await ensureTrace(w.s, KEY))!;
    expect(second.signature).not.toBe(first.signature);
    expect((await w.db.all<{ tx_id: string }>("SELECT DISTINCT tx_id FROM writes")).length).toBe(1);
    const healed = await dump(w, "pool-a");
    expect(healed).toHaveLength(3);

    // the older copy of the parts comes back with its older state: the signature no longer matches and the parts are built again
    await w.db.run("DELETE FROM tx_part");
    for (const p of snapshot.parts) await w.db.run("INSERT INTO tx_part (tx_id, owner, kind, grp, cents, passed) VALUES (?, ?, ?, ?, ?, ?)", [p.tx_id!, p.owner!, p.kind!, p.grp!, p.cents!, p.passed!]);
    await w.db.run("UPDATE tx_part_state SET signature = ?, lots = ?", [snapshot.state[0]!.signature!, snapshot.state[0]!.lots!]);
    expect(await stored(w, "pool-a")).toHaveLength(2);
    await ensureTrace(w.s, KEY);
    expect(await dump(w, "pool-a")).toEqual(healed);

    // a row changed in place, as a sync does: the amount and the data version move
    await w.db.run("UPDATE transactions SET amount_cents = -150 WHERE counterparty = 'KAUPPA'");
    await w.db.run("UPDATE accounts SET balance_cents = 25000 WHERE id = 'pool-a'");
    await w.s.settings.bumpUserDataVersion(w.aino);
    await ensureTrace(w.s, KEY);
    expect(dumpOf(await dump(w, "pool-a"), "2026-09-02", -1.5)).toEqual(["A|own||150|0"]);
  });

  it("a build that fails writes nothing", async () => {
    const w = await world(one(rows, 0));
    await ensureTrace(w.s, KEY);
    const before = { parts: await dump(w, "pool-a"), state: await w.s.household.partsState(KEY) };
    const had = await w.s.household.partsOf(["pool-a"]);
    const bad = new Map<string, PartRow[]>([...had].map(([id, parts]) => [id, parts.map((p) => ({ ...p, cents: p.cents + 1 }))]));
    bad.set("no-such-row", [{ owner: "u:x", kind: "own", grp: "", cents: 1, passed: false }]);
    await expect(w.s.household.writeParts(bad, had, { key: KEY, signature: "x", builtAt: "x", lots: "[]" })).rejects.toThrow();
    expect({ parts: await dump(w, "pool-a"), state: await w.s.household.partsState(KEY) }).toEqual(before);
  });

  it("an account that is no pool has no trace, and the frozen household of 0.12.0 stores none", async () => {
    const w = await world(one(rows, 0, { holder: AINO }));
    expect(await ensureTrace(w.s, KEY)).toBeNull();
    expect(await w.db.all("SELECT * FROM tx_part")).toEqual([]);
    expect(await w.db.all("SELECT * FROM tx_part_state")).toEqual([]);

    const file = join(scratchDir("talous-trace-"), "banking.db");
    loadFixture(file, "0.12.0.sql");
    const { db } = await openDatabase(file);
    const config = loadConfig({ APP_SECRET: "test-secret-that-is-long-enough-0123456789", INDUSTRY_LOOKUP: "false", APP_BASE_URL: "http://localhost:8080" });
    const s = createApp({ db, config, now: () => new Date("2026-10-09T10:00:00Z") }).services;
    const keys = [...new Set((await s.household.allAccounts()).map(accountKey))];
    expect(keys.length).toBeGreaterThan(3);
    for (const key of keys) expect((await ensureTrace(s, key))?.hasTrace ?? false, key).toBe(false);
    expect(await db.all("SELECT * FROM tx_part")).toEqual([]);
    // the household's joint account has no balance to trace from: its state says so and no part is stored
    expect((await db.all<{ lots: string }>("SELECT lots FROM tx_part_state")).map((r) => r.lots)).toEqual(["null"]);
  });
});

describe("a bill paid from the pool to a card account, which has no IBAN", () => {
  const BILL: R = ["2026-09-12", -120, "ESIMERKKI PANKKI", "FI9900000000000009"];
  const rows: R[] = [fromAino("2026-09-01", 600), fromVille("2026-09-02", 600), BILL];

  /** The pool, and a card account with the given holder line that took the bill's money in. */
  async function withCard(holder: string | null, type: Parameters<typeof link>[6]) {
    return world(
      one(rows, 0, {
        extra: async (w) => {
          await link(w, w.aino, "the-card", holder, null, "idn-card", type);
          await ingestTransactions(w.s.finance(w.aino), "the-card", [raw(["2026-09-12", 120, "ESIMERKKI PANKKI"])], "enablebanking");
        },
      }),
    );
  }
  const billOf = async (w: World) => rowAt((await settledTrace(w.s, KEY))!, "2026-09-12", -120);

  it("is for the member who uses the card alone: her own money pays it", async () => {
    const w = await withCard(AINO, "credit_card");
    const row = await billOf(w);
    expect(row).toMatchObject({ what: "one", to: A(w) });
    expect(row.parts.filter((p) => p.owner === A(w)).reduce((n, p) => n + p.cents, 0)).toBe(12000);
  });

  it("keeps a card of both members, of a holder with no login, and an account that is no card, a cost for all", async () => {
    for (const [holder, type] of [[`${AINO}, ${VILLE}`, "credit_card"], [`${AINO}, ESIMERKKI LIISA`, "credit_card"], [AINO, "other"]] as const) {
      const row = await billOf(await withCard(holder, type));
      expect(row.what, `${holder} ${type}`).toBe("all");
      expect(row.parts.map((p) => [p.owner.slice(0, 2), p.cents])).toEqual([["u:", 6000], ["u:", 6000]]);
    }
  });
});
