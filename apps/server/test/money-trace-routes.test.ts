/**
 * A joint account cut by who paid it, through the routes: what each member's own list and the household's list say of
 * every row, what /meta serves of the trace, and what saying and taking back an answer or a split does. Made-up names
 * and sums; the first user by id is "Aino".
 */
import { join } from "node:path";
import { householdDebts, type Part, partCents } from "@banking/core";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { partSql } from "../src/db/finance/part-sql.ts";
import { openDatabase } from "../src/db/open.ts";
import { loadConfig } from "../src/platform/config.ts";
import { sha256 } from "../src/security/encoding.ts";
import { requestInputs, rowsInView } from "../src/services/analysis.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { ensureTrace, settledTrace } from "../src/services/money-trace.ts";
import { loadFixture } from "./fixture-db.ts";
import { scratchDir } from "./helpers.ts";
import { AINO, fromAino, fromVille, IBAN, KEY, link, one, people, type R, raw, VILLE, type World, world } from "./trace-world.ts";

const MORTGAGE = (date: string): R => [date, -1104.37, "ESIMERKKI PANKKI"];
const WINDOW_OK: R[] = [fromAino("2026-07-01", 1150), MORTGAGE("2026-07-03"), ["2026-07-05", -45.63, "ESIMERKKIMAKSUT OY"], fromAino("2026-08-01", 1150), MORTGAGE("2026-08-03"), fromAino("2026-09-01", 1150), MORTGAGE("2026-09-03")];
const T1: R[] = WINDOW_OK.filter((r) => r[0] !== "2026-08-01");
const YEAR = "from=2026-01-01&to=2026-12-31";

/** One row as the three lists say it: the bank's cents, each member's own, and whether each member's list counts it as a transfer. */
interface Side {
  whole: number;
  aino: number;
  ville: number;
  ainoMoves: boolean;
  villeMoves: boolean;
}
interface Lists {
  rows: Map<string, Side>;
  /** The money in and out each own list adds up, transfers left out. */
  aino: { inCents: number; outCents: number };
  ville: { inCents: number; outCents: number };
}

const at = (date: string, euros: number) => `${date}|${Math.round(euros * 100)}`;

/**
 * The pool's rows in Aino's own list, Ville's and the household's, by day and cents; every row must add up. Each member
 * reads the copy `ids` names (the one copy both see, or the copy each linked).
 */
async function lists(w: World, ids: [aino: string, ville: string] = ["pool-a", "pool-a"]): Promise<Lists> {
  const read = async (userId: string, scope: string, accountId: string) => (await w.as(userId).call("GET", `/api/transactions?scope=${scope}&accountId=${accountId}&${YEAR}&limit=500`)).body;
  const [a, v, all] = [await read(w.aino, "own", ids[0]), await read(w.ville, "own", ids[1]), await read(w.aino, "household", ids[0])];
  type Item = { bookingDate: string; amountCents: number; counterparty: string };
  const key = (t: Item) => `${t.bookingDate}|${t.amountCents}`;
  const full = (t: Item) => `${key(t)}|${t.counterparty}`;
  const rows = new Map<string, Side>();
  for (const t of all.items as Item[]) {
    const ofAino = a.items.find((x: Item) => full(x) === full(t));
    const ofVille = v.items.find((x: Item) => full(x) === full(t));
    const side: Side = { whole: t.amountCents, aino: ofAino.partCents, ville: ofVille.partCents, ainoMoves: ofAino.isTransfer, villeMoves: ofVille.isTransfer };
    expect(side.aino + side.ville, full(t)).toBe(side.whole);
    // a row is found by its day and cents, and by its payee as well where two rows share both
    rows.set(all.items.filter((x: Item) => key(x) === key(t)).length > 1 ? full(t) : key(t), side);
  }
  expect(rows.size).toBe(all.items.length);
  expect([a.items.length, v.items.length]).toEqual([all.items.length, all.items.length]);
  return { rows, aino: { inCents: a.inCents, outCents: a.outCents }, ville: { inCents: v.inCents, outCents: v.outCents } };
}

/** Both members see the pool: Aino's copy is shared with Ville, and Aino cuts it by who paid. */
const shareAndChoose = async (w: World) => {
  expect(await w.s.household.share(w.aino, "pool-a", w.ville)).toBe(true);
  expect((await w.as(w.aino).call("PUT", "/api/accounts/pool-a/split", { mode: "source" })).body).toEqual({ ok: true });
};
const withVilleCard = async (w: World) => {
  await link(w, w.ville, "ville-card", VILLE, IBAN.card, "idn-card", "credit_card");
  await shareAndChoose(w);
};

describe("money in, money out and a refund", () => {
  it("each member's own list holds the cents they paid, the two add up to the bank's on every row, and a refund goes back to who paid the purchase", async () => {
    const rows: R[] = [fromAino("2026-09-01", 1000), fromVille("2026-09-01", 500), ["2026-09-02", -90, "KAUPPA OY"], ["2026-09-10", 30, "KAUPPA OY"]];
    const w = await world(one(rows, 0, { extra: shareAndChoose }));
    const { rows: seen, aino, ville } = await lists(w);
    // money in is each payer's own, a transfer in their list, and nothing at all in the other's
    expect(seen.get(at("2026-09-01", 1000))).toMatchObject({ aino: 100000, ville: 0, ainoMoves: true });
    expect(seen.get(at("2026-09-01", 500))).toMatchObject({ aino: 0, ville: 50000, villeMoves: true });
    // the purchase is cut by the money in the pool, two to one; the refund returns to the same two in the same way
    expect(seen.get(at("2026-09-02", -90))).toMatchObject({ aino: -6000, ville: -3000, ainoMoves: false, villeMoves: false });
    expect(seen.get(at("2026-09-10", 30))).toMatchObject({ aino: 2000, ville: 1000 });
    // what each list adds up: the purchase out, the refund in
    expect([aino.outCents, aino.inCents, ville.outCents, ville.inCents]).toEqual([6000, 2000, 3000, 1000]);
  });
});

describe("a member who pays all the money in, one who takes some out, and one who never touches the pool", () => {
  it("S17: the payer bears the shared bills whole, what the other takes is a transfer on both sides, and nothing lands on him by a weight nobody said", async () => {
    const rows: R[] = [fromAino("2026-09-01", 1000), ["2026-09-03", -300, VILLE, IBAN.ville], ["2026-09-04", -80, "VISA", IBAN.card], ["2026-09-05", -600, "ASUNTO OY ESIMERKKI"]];
    const w = await world(one(rows, 0, { extra: withVilleCard }));
    const { rows: seen, aino, ville } = await lists(w);
    expect(seen.get(at("2026-09-03", -300))).toEqual({ whole: -30000, aino: -30000, ville: 0, ainoMoves: true, villeMoves: true });
    expect(seen.get(at("2026-09-04", -80))).toEqual({ whole: -8000, aino: -8000, ville: 0, ainoMoves: true, villeMoves: true });
    expect(seen.get(at("2026-09-05", -600))).toEqual({ whole: -60000, aino: -60000, ville: 0, ainoMoves: false, villeMoves: false });
    // her list counts the rent alone as spending, his counts none of the pool's money in or out
    expect([aino.outCents, aino.inCents, ville.outCents, ville.inCents]).toEqual([60000, 0, 0, 0]);
  });

  it("S17 near miss: what the taker paid in himself he takes back as his own, and only the rest of the move is passed on", async () => {
    const rows: R[] = [fromAino("2026-09-01", 1000), fromVille("2026-09-02", 200), ["2026-09-03", -300, VILLE, IBAN.ville], ["2026-09-05", -600, "ASUNTO OY ESIMERKKI"]];
    const w = await world(one(rows, 0, { extra: withVilleCard }));
    const { rows: seen, ville } = await lists(w);
    expect(seen.get(at("2026-09-03", -300))).toMatchObject({ aino: -10000, ville: -20000, ainoMoves: true, villeMoves: true });
    // the rent is hers whole: his 200,00 went out with the move and none of it pays a bill
    expect(seen.get(at("2026-09-05", -600))).toMatchObject({ aino: -60000, ville: 0 });
    expect(ville.outCents).toBe(0);
  });

  it("S18: a member who never touches the pool has 0,00 of every bill in his own list, and the household list still shows the bills whole", async () => {
    const rows: R[] = [fromAino("2026-09-01", 900), ["2026-09-03", -400, "SAHKO OY"], ["2026-09-04", -250, "VESI OY"]];
    const w = await world(one(rows, 0, { extra: shareAndChoose }));
    const { rows: seen, aino, ville } = await lists(w);
    expect(seen.get(at("2026-09-03", -400))).toMatchObject({ whole: -40000, aino: -40000, ville: 0 });
    expect(seen.get(at("2026-09-04", -250))).toMatchObject({ whole: -25000, aino: -25000, ville: 0 });
    expect([aino.outCents, ville.outCents]).toEqual([65000, 0]);
    const household = (await w.as(w.aino).call("GET", `/api/transactions?scope=household&accountId=pool-a&${YEAR}&limit=500`)).body;
    expect(household.items.map((t: { partCents?: number }) => t.partCents)).toEqual([undefined, undefined, undefined]);
    expect(household.outCents).toBe(65000);

    // near miss: he pays 100,00 in first, and then bears his share of what the money was
    const paid = await world(one([fromVille("2026-09-01", 100), ...rows], 0, { extra: shareAndChoose }));
    const after = (await lists(paid)).rows;
    expect([at("2026-09-03", -400), at("2026-09-04", -250)].map((k) => [after.get(k)!.aino, after.get(k)!.ville])).toEqual([[-36000, -4000], [-22500, -2500]]);
  });

  it("S19: the payment of one member's own credit is a transfer for the other, who bears none of it, and his own lots go first", async () => {
    const credit = async (w: World) => {
      await link(w, w.ville, "ville-credit", VILLE, IBAN.card, "idn-credit", "credit_card");
      await shareAndChoose(w);
    };
    const rows: R[] = [fromAino("2026-09-01", 1000), fromVille("2026-09-01", 200), ["2026-09-05", -350, "JOUSTOLUOTTO", IBAN.card]];
    const w = await world(one(rows, 0, { extra: credit }));
    const { rows: seen, aino, ville } = await lists(w);
    // his 200,00 first, then 150,00 of hers that he took: hers is a transfer, never a cost of hers
    expect(seen.get(at("2026-09-05", -350))).toEqual({ whole: -35000, aino: -15000, ville: -20000, ainoMoves: true, villeMoves: true });
    expect([aino.outCents, ville.outCents]).toEqual([0, 0]);
    // the credit is his in every view: Aino's list and /meta hold nothing of it
    expect((await w.as(w.aino).call("GET", `/api/transactions?scope=own&accountId=ville-credit&${YEAR}`)).body.items).toEqual([]);
    expect((await w.as(w.aino).call("GET", "/api/meta")).body.sharedAccounts.map((a: { id: string }) => a.id)).not.toContain("ville-credit");

    // near miss: a loan in both names paid from the same pool stays shared, to the cent
    const both = async (x: World) => {
      await link(x, x.aino, "loan-a", `${AINO}, ${VILLE}`, IBAN.loan, "idn-loan", "loan");
      await link(x, x.ville, "loan-v", `${AINO}, ${VILLE}`, IBAN.loan, "idn-loan", "loan");
      await shareAndChoose(x);
    };
    const shared = await world(one([fromAino("2026-09-01", 1000), fromVille("2026-09-01", 200), ["2026-09-05", -350, "ASUNTOLAINA", IBAN.loan]], 0, { extra: both }));
    expect((await lists(shared)).rows.get(at("2026-09-05", -350))).toMatchObject({ aino: -29167, ville: -5833 });
  });
});

const HALF = (aino: boolean): Part => (aino ? { from: 0, to: 1, of: 2 } : { from: 1, to: 2, of: 2 });
const THREE_TWO = (aino: boolean): Part => (aino ? { from: 0, to: 3, of: 5 } : { from: 3, to: 5, of: 5 });
const say = async (w: World, weights: [number, number]) =>
  expect((await w.as(w.aino).call("PUT", "/api/accounts/pool-a/use", { users: [{ userId: w.aino, weight: weights[0] }, { userId: w.ville, weight: weights[1] }] })).body).toEqual({ ok: true });
const splits = (w: World) => w.db.all("SELECT account_key, mode, set_by FROM account_split");
const metaOf = async (w: World, userId: string) => (await w.as(userId).call("GET", "/api/meta")).body.accounts.find((a: { id: string }) => a.id === "pool-a");
/** Every row of the pool is cut by one part in both lists. */
const everyRow = async (w: World, part: (aino: boolean) => Part) => {
  const { rows } = await lists(w);
  expect(rows.size).toBeGreaterThan(5);
  for (const [k, side] of rows) expect([k, side.aino, side.ville]).toEqual([k, partCents(side.whole, part(true)), partCents(side.whole, part(false))]);
};
const shared = async (w: World) => {
  expect(await w.s.household.share(w.aino, "pool-a", w.ville)).toBe(true);
};

describe("the weights a household said stay the weights", () => {
  it("600 and 400 euros a month cut every row three to two, in both lists, also where the app would have cut the account by who paid", async () => {
    const w = await world(one(WINDOW_OK, 312045, { extra: shared }));
    await say(w, [60000, 40000]);
    await everyRow(w, THREE_TWO);
    // nothing was set, and the account says no mode and is not traced; what the rows would say is offered
    expect(await splits(w)).toEqual([]);
    const meta = await metaOf(w, w.aino);
    expect(meta).not.toHaveProperty("traced");
    expect(meta.use).toEqual({ users: expect.any(Array), source: "said" });
    expect(meta.offer).toEqual([{ userId: w.aino, percent: 100 }, { userId: w.ville, percent: 0 }]);
    expect(await ensureTrace(w.s, KEY)).toMatchObject({ hasTrace: true, traced: false });
    // the near miss: a said "Tasan" is a said use as well, so the app never sets the split and the rows are cut by halves
    await say(w, [1, 1]);
    await everyRow(w, HALF);
    expect(await splits(w)).toEqual([]);
    // the same rows with nothing said are cut by who paid, set once by the app
    const unsaid = await world(one(WINDOW_OK, 312045, { extra: shared }));
    const { rows } = await lists(unsaid);
    expect(rows.get(at("2026-07-03", -1104.37))).toMatchObject({ aino: -110437, ville: 0 });
    expect(await splits(unsaid)).toEqual([{ account_key: KEY, mode: "source", set_by: null }]);
  });

  it("choosing 'by who paid' keeps what was said, saying weights again takes the choice back, and leaving it cuts by the weights without the app setting it again", async () => {
    const w = await world(one(T1, 312045, { extra: shared }));
    await say(w, [60000, 40000]);
    expect((await w.as(w.aino).call("PUT", "/api/accounts/pool-a/split", { mode: "source" })).body).toEqual({ ok: true });
    const bypayer = (await lists(w)).rows.get(at("2026-07-03", -1104.37))!;
    expect([bypayer.aino, bypayer.ville]).toEqual([-110437, 0]);
    expect(await w.db.all("SELECT user_id, weight FROM account_use ORDER BY weight DESC")).toEqual([{ user_id: w.aino, weight: 60000 }, { user_id: w.ville, weight: 40000 }]);
    expect(await metaOf(w, w.aino)).toMatchObject({ traced: true, use: { source: "said", mode: "source" }, split: { by: "user" } });
    await say(w, [1, 1]);
    expect(await splits(w)).toEqual([]);
    await everyRow(w, HALF);

    // an account the app cut by who paid: leaving says the weights it had, so it stays left
    const app = await world(one(WINDOW_OK, 312045, { extra: shared }));
    expect(await ensureTrace(app.s, KEY)).toMatchObject({ traced: true, split: { by: "app" } });
    expect((await app.as(app.aino).call("DELETE", "/api/accounts/pool-a/split")).body).toEqual({ ok: true });
    expect(await app.db.all("SELECT user_id, weight FROM account_use ORDER BY user_id")).toEqual([app.aino, app.ville].sort().map((id) => ({ user_id: id, weight: 1 })));
    await everyRow(app, HALF);
    expect(await ensureTrace(app.s, KEY)).toMatchObject({ traced: false });
    expect(await splits(app)).toEqual([]);
    expect(await metaOf(app, app.aino)).not.toHaveProperty("traced");
    // only a member who linked the account may choose or leave, and only the one choice exists
    expect((await app.as(app.ville).call("PUT", "/api/accounts/pool-a/split", { mode: "source" })).status).toBe(404);
    expect((await app.as(app.ville).call("DELETE", "/api/accounts/pool-a/split")).status).toBe(404);
    expect((await app.as(app.aino).call("PUT", "/api/accounts/pool-a/split", { mode: "weights" })).status).toBe(400);
    expect((await app.as(app.aino).call("PUT", "/api/accounts/pool-a/split", { mode: "source", by: "me" })).status).toBe(400);
  });
});

describe("a question asked of the linking member and answered", () => {
  const choose = async (w: World) => {
    await shared(w);
    expect((await w.as(w.aino).call("PUT", "/api/accounts/pool-a/split", { mode: "source" })).body).toEqual({ ok: true });
  };
  const answer = (w: World, userId: string, body: unknown) => w.as(userId).call("PUT", "/api/accounts/pool-a/answers", body);

  it("/meta lists the question with its label and the offer, an answer moves the rows and the question goes, taking it back brings both back", async () => {
    const w = await world(one(T1, 312045, { extra: choose }));
    const mortgage = at("2026-08-03", -1104.37);
    // the opening takes the August mortgage, whose owner nobody knows: it is cut by the weights, half and half
    const open = (await lists(w)).rows.get(mortgage)!;
    expect([open.aino, open.ville]).toEqual([-55219, -55218]);
    const meta = await metaOf(w, w.aino);
    expect(meta).toMatchObject({ traced: true, part: HALF(true), use: { mode: "source" }, split: { by: "user" } });
    expect(meta.questions).toEqual([expect.objectContaining({ kind: "opening", key: "o", cents: 312045, label: "2026-07-01" })]);
    expect(meta.answers).toBeUndefined();
    // he sees the split but is asked nothing: he did not link the account
    const his = (await w.as(w.ville).call("GET", "/api/meta")).body.sharedAccounts.find((a: { id: string }) => a.id === "pool-a");
    expect(his).toMatchObject({ traced: true, split: { by: "user" } });
    expect(his.questions).toBeUndefined();
    expect(his.offer).toBeUndefined();

    // an answer changes the figures of everyone who sees the account (it cannot be asked of the demo's account in contract.qa.test.ts)
    const versions = () => Promise.all([w.aino, w.ville].map((id) => w.s.settings.get(`data_version:${id}`)));
    const [aino0, ville0] = await versions();
    expect((await answer(w, w.aino, { kind: "opening", key: "o", owner: `u:${w.aino}` })).body).toEqual({ ok: true });
    const [aino1, ville1] = await versions();
    expect([aino1 !== aino0, ville1 !== ville0]).toEqual([true, true]);
    const said = (await lists(w)).rows.get(mortgage)!;
    expect([said.aino, said.ville]).toEqual([-110437, 0]);
    const after = await metaOf(w, w.aino);
    expect(after.questions).toBeUndefined();
    expect(after.answers).toEqual([{ kind: "opening", key: "o", label: "2026-07-01", owner: `u:${w.aino}` }]);
    expect((await w.as(w.aino).call("DELETE", "/api/accounts/pool-a/answers", { kind: "opening", key: "o" })).body).toEqual({ ok: true });
    expect((await lists(w)).rows.get(mortgage)).toEqual(open);
    expect((await metaOf(w, w.aino)).questions).toHaveLength(1);
    // taking back an answer never said is fine
    expect((await w.as(w.aino).call("DELETE", "/api/accounts/pool-a/answers", { kind: "opening", key: "o" })).status).toBe(200);
  });

  it("refuses a question that is not asked, an owner who is no user of the account, a field it does not know, and a member who did not link the account", async () => {
    const w = await world(one(T1, 312045, { extra: choose }));
    const ok = { kind: "opening", key: "o", owner: `u:${w.aino}` };
    const refused = async (userId: string, body: unknown) => {
      const res = await answer(w, userId, body);
      return [res.status, res.body.error];
    };
    expect(await refused(w.aino, { ...ok, key: "g:text:ei kysytty" })).toEqual([400, "Kysymystä ei löydy."]);
    expect(await refused(w.aino, { kind: "in", key: "o", owner: `u:${w.aino}` })).toEqual([400, "Kysymystä ei löydy."]);
    expect(await refused(w.aino, { ...ok, owner: "u:ei-ole-kayttaja" })).toEqual([400, "Valitse yksi tilin käyttäjistä."]);
    expect(await refused(w.aino, { ...ok, owner: "g:o" })).toEqual([400, "Valitse yksi tilin käyttäjistä."]);
    expect((await refused(w.aino, { ...ok, extra: 1 }))[0]).toBe(400);
    expect((await refused(w.aino, { kind: "x", key: "o", owner: "all" }))[0]).toBe(400);
    expect((await refused(w.aino, { kind: "opening", key: "o" }))[0]).toBe(400);
    expect((await refused(w.ville, ok))[0]).toBe(404);
    expect((await w.as(w.ville).call("DELETE", "/api/accounts/pool-a/answers", { kind: "opening", key: "o" })).status).toBe(404);
    expect(await w.db.all("SELECT * FROM owner_answer")).toEqual([]);
    // near misses: "all" and "none" are answers, and so is the other user
    for (const owner of ["all", "none", `u:${w.ville}`]) expect((await answer(w, w.aino, { ...ok, owner })).status, owner).toBe(200);
  });
});

describe("two copies of one account and two pools", () => {
  it("T7: rows arriving in two orders on two copies give the same cents on both, and each row adds up in the two lists", async () => {
    const rows: R[] = [fromAino("2026-09-01", 70.01), fromVille("2026-09-01", 29.99), ["2026-09-02", -50, "KAUPPA"], ["2026-09-02", -50, "SAHKO"]];
    const w = await world({
      copies: [{ by: "aino", id: "pool-a", rows }, { by: "ville", id: "pool-v", rows: [...rows].reverse() }],
      balance: 0,
      extra: async (x) => {
        expect((await x.as(x.aino).call("PUT", "/api/accounts/pool-a/split", { mode: "source" })).body).toEqual({ ok: true });
      },
    });
    const { rows: seen } = await lists(w, ["pool-a", "pool-v"]);
    // two equal sums on one day: the extra cent goes by the content of the row, not by the stored id or the order of arrival
    expect(["KAUPPA", "SAHKO"].map((who) => [seen.get(`${at("2026-09-02", -50)}|${who}`)!.aino, seen.get(`${at("2026-09-02", -50)}|${who}`)!.ville])).toEqual([[-3501, -1499], [-3500, -1500]]);
    expect(await w.db.all("SELECT COUNT(*) AS n FROM tx_part_state")).toEqual([{ n: 1 }]);
  });

  it("the part of a row of a pool cut by who paid is the part its row shows, and the panel's total is the same figure", async () => {
    // a loan account that holds -0,90: the viewer's own 600,00 in, an instalment out, and money from nobody the pool knows
    const rows: R[] = [fromAino("2026-09-01", 600), ["2026-09-02", -600, "ESIMERKKI PANKKI"], ["2026-09-03", 30, "ESIMERKKI OY", "FI9000000000000009"], fromVille("2026-09-04", 200)];
    const w = await world(one(rows, 0, { balance: -90, extra: async (x) => void (await x.as(x.aino).call("PUT", "/api/accounts/pool-a/split", { mode: "source" })) }));
    const list = (await w.as(w.aino).call("GET", `/api/transactions?scope=own&accountId=pool-a&${YEAR}&limit=50`)).body.items as { id: string; amountCents: number; partCents?: number }[];
    const parted = list.filter((t) => t.partCents !== undefined);
    expect(parted.map((t) => [t.amountCents, t.partCents])).toContainEqual([60000, 60000]);
    // money Ville paid in is nothing of Aino's: a part of 0 that the panel still answers
    expect(parted.map((t) => [t.amountCents, t.partCents])).toContainEqual([20000, 0]);
    // near miss: another figure's panel lists the same traced row with no reason of its parts under it
    const spend = (await w.as(w.aino).call("GET", `/api/explain?figure=spend.month&from=2026-09-01&to=2026-09-30`)).body.lines as { cents: number; why: { rule: string }[] }[];
    expect(spend.some((l) => l.cents !== 0)).toBe(true);
    expect(spend.flatMap((l) => l.why.map((x) => x.rule)).filter((x) => x.startsWith("part."))).toEqual([]);
    for (const t of parted) {
      const r = await w.as(w.aino).call("GET", `/api/explain?figure=share.part&row=${t.id}&${YEAR}`);
      expect([r.status, r.body.cents, r.body.check], String(t.amountCents)).toEqual([200, t.partCents, { kind: "recompute", diffCents: 0 }]);
      // a row with a part of its own money lists it by source and adds up to the part; unknown money is listed by the weights
      if (r.body.lines.some((l: { why: { rule: string }[] }) => l.why.some((x) => x.rule === "part.source"))) expect(r.body.lines.reduce((sum: number, l: { cents: number }) => sum + l.cents, 0)).toBe(t.partCents);
    }
  });

  const POOL_Y = "FI7000000000000007";
  const both = `${AINO}, ${VILLE}`;
  /** Two pools of the same two members; each holds the rows given. */
  const pools = async (x: R[], y: R[], balances: [number, number]) => {
    const w = await people({ at: new Date("2026-10-09T10:00:00Z") });
    for (const [id, iban, identity, rows, balance] of [["x-a", IBAN.pool, "idn-x", x, balances[0]], ["y-a", POOL_Y, "idn-y", y, balances[1]]] as const) {
      await link(w, w.aino, id, both, iban, identity);
      await w.db.run("UPDATE accounts SET balance_cents = ? WHERE id = ?", [balance, id]);
      await ingestTransactions(w.s.finance(w.aino), id, rows.map(raw), "enablebanking");
      expect((await w.as(w.aino).call("PUT", `/api/accounts/${id}/split`, { mode: "source" })).body).toEqual({ ok: true });
    }
    return w;
  };
  const money: R[] = [fromAino("2026-09-01", 600), fromVille("2026-09-01", 400)];

  it("T9, one way: what pool X sends pool Y is cut by who paid X, a transfer in X, and the lots of Y", async () => {
    const w = await pools([...money, ["2026-09-05", -500, "POOL Y", POOL_Y]], [["2026-09-05", 500, "POOL X", IBAN.pool]], [50000, 50000]);
    const [x, y] = [(await settledTrace(w.s, "idn-x"))!, (await settledTrace(w.s, "idn-y"))!];
    const out = x.trace.rows.find((r) => r.cents === -50000)!;
    expect(out).toMatchObject({ what: "pool", parts: [{ owner: `u:${w.aino}`, cents: 30000 }, { owner: `u:${w.ville}`, cents: 20000 }] });
    expect(y.trace.rows.find((r) => r.cents === 50000)!.parts).toEqual([{ owner: `u:${w.aino}`, kind: "pool", cents: 30000 }, { owner: `u:${w.ville}`, kind: "pool", cents: 20000 }]);
    expect(y.trace.lots.map((l) => [l.owner, l.cents])).toEqual([[`u:${w.aino}`, 30000], [`u:${w.ville}`, 20000]]);
    expect([x.questions, y.questions]).toEqual([[], []]);
    // the same through the routes: it is a transfer in Aino's list of X, and what she holds of Y is hers
    for (const [id, paid] of [["x-a", -30000], ["y-a", 30000]] as const) {
      const list = (await w.as(w.aino).call("GET", `/api/transactions?scope=own&accountId=${id}&${YEAR}&limit=50`)).body.items.find((t: { amountCents: number }) => Math.abs(t.amountCents) === 50000);
      expect([list.partCents, list.isTransfer], id).toEqual([paid, true]);
    }
  });

  it("T9, both ways: where two pools pay each other no movement is carried, each money-in row is unknown money, and each pool asks about it once", async () => {
    const w = await pools([...money, ["2026-09-05", -500, "POOL Y", POOL_Y], ["2026-09-08", 200, "POOL Y", POOL_Y]], [["2026-09-05", 500, "POOL X", IBAN.pool], ["2026-09-08", -200, "POOL X", IBAN.pool]], [70000, 30000]);
    const [x, y] = [(await settledTrace(w.s, "idn-x"))!, (await settledTrace(w.s, "idn-y"))!];
    expect(x.trace.rows.find((r) => r.cents === 20000)!.parts).toEqual([{ owner: `g:iban:${POOL_Y}`, kind: "unknown", cents: 20000 }]);
    expect(y.trace.rows.find((r) => r.cents === 50000)!.parts).toEqual([{ owner: `g:iban:${IBAN.pool}`, kind: "unknown", cents: 50000 }]);
    expect(x.questions).toEqual([expect.objectContaining({ kind: "in", key: `g:iban:${POOL_Y}`, cents: 20000 })]);
    expect(y.questions).toEqual([expect.objectContaining({ kind: "in", key: `g:iban:${IBAN.pool}`, cents: 50000 })]);
    // each is asked of the member who linked it, with the text the row shows
    const meta = (await w.as(w.aino).call("GET", "/api/meta")).body.accounts;
    expect(meta.find((a: { id: string }) => a.id === "x-a").questions).toEqual([expect.objectContaining({ label: "POOL Y" })]);
    expect(meta.find((a: { id: string }) => a.id === "y-a").questions).toEqual([expect.objectContaining({ label: "POOL X" })]);
  });
});

describe("a typed loan paid from a joint account that becomes traced", () => {
  const LENDER = "Esimerkkirahoitus Oy";
  const loan = { name: "Asuntolaina", lender: "ESIMERKKIRAHOITUS OY", kind: "mortgage", balanceCents: 14_999_999, balanceDate: "2026-10-05", rateBp: 325, repayment: "annuity", intervalMonths: 1, paymentCents: 84_001, seriesKey: `out:pool-a:${LENDER}#84001` };
  /** What a view tells of the debts: the total, the interest, and the part each debt is cut to. */
  const debtsOf = async (w: World, userId: string, scope: "own" | "household") => {
    const data = await w.s.analysis.get(w.s, userId, scope);
    const { balances, inputs } = await requestInputs(w.s, userId, data.accounts);
    const debts = householdDebts(balances, inputs, w.s.today());
    return { traced: data.accounts.filter((a) => a.traced).map((a) => a.id), total: debts.total.cents, interest: debts.interest.cents, parts: [...debts.parts] };
  };

  it("tells the same debts in both own views and in the household view before and after, to the cent", async () => {
    const w = await world({ copies: [{ by: "aino", id: "pool-a", rows: T1 }, { by: "ville", id: "pool-v", rows: T1 }], balance: 312045 });
    expect((await w.as(w.aino).call("POST", "/api/loans", loan)).body.error).toBeUndefined();
    const views = (): Promise<unknown[]> => Promise.all([debtsOf(w, w.aino, "own"), debtsOf(w, w.ville, "own"), debtsOf(w, w.aino, "household")]);
    const before = (await views()) as { traced: string[]; total: number; parts: unknown[] }[];
    expect(before.map((v) => v.traced)).toEqual([[], [], []]);
    expect([before[0]!.total + before[1]!.total, before[2]!.total]).toEqual([14_999_999, 14_999_999]);
    expect((await w.as(w.aino).call("PUT", "/api/accounts/pool-a/split", { mode: "source" })).body).toEqual({ ok: true });
    const after = (await views()) as typeof before;
    expect(after.map((v) => v.traced)).toEqual([["pool-a"], ["pool-v"], []]);
    expect(after.map(({ traced: _t, ...rest }) => rest)).toEqual(before.map(({ traced: _t, ...rest }) => rest));
    expect(after[0]!.parts).toHaveLength(1);
  });
});

describe("a household with no account of two users", () => {
  it("the frozen database of 0.12.0 stores no part, cuts nothing in SQL, counts the same rows in both views and serves no new field", async () => {
    const file = join(scratchDir("talous-trace-"), "banking.db");
    loadFixture(file, "0.12.0.sql");
    const { db } = await openDatabase(file);
    // its one account with two holders loses them and the use said of it: now no account has two users
    await db.run("UPDATE accounts SET holder = NULL");
    await db.run("DELETE FROM account_use");
    const config = loadConfig({ APP_SECRET: "test-secret-that-is-long-enough-0123456789", INDUSTRY_LOOKUP: "false", APP_BASE_URL: "http://localhost:8080" });
    const app = createApp({ db, config, now: () => new Date("2026-10-09T10:00:00Z") });
    const s = app.services;
    const token = "t-aino";
    await s.users.createSession(await sha256(token), "u-aino", "2099-01-01T00:00:00.000Z", null);
    const get = async (path: string) => (await app.request(`http://localhost:8080${path}`, { headers: { Cookie: `${config.sessionCookie}=${token}` } })).json() as Promise<any>;

    const own = await s.analysis.get(s, "u-aino", "own");
    expect(own.shares.size).toBe(0);
    expect(own.ctx.txs).toEqual((await s.analysis.get(s, "u-aino", "household")).ctx.txs);
    const { own: sql } = await rowsInView(s, "u-aino", "own");
    expect([sql.parts.size, sql.left.length, sql.told.size, sql.shares?.size]).toEqual([0, 0, 0, 0]);
    expect(partSql(sql.parts, "amount_cents")).toEqual({ sql: "amount_cents", params: [] });
    expect(await get("/api/transactions?scope=own&limit=500")).toEqual(await get("/api/transactions?scope=household&limit=500"));
    for (const a of (await get("/api/meta")).accounts) for (const field of ["traced", "split", "questions", "answers", "offer"]) expect(a, `${a.id} ${field}`).not.toHaveProperty(field);
    expect(await db.all("SELECT * FROM tx_part")).toEqual([]);
    expect(await db.all("SELECT * FROM tx_part_state")).toEqual([]);
    db.close();
  });
});

describe("the balance of an account cut by who paid it", () => {
  const balances = async (w: World) => {
    const read = async (userId: string, scope: "own" | "household") => {
      const data = await w.s.analysis.get(w.s, userId, scope);
      return (await requestInputs(w.s, userId, data.accounts)).balances.find((b) => b.id === "pool-a")!;
    };
    return { aino: await read(w.aino, "own"), ville: await read(w.ville, "own"), household: await read(w.aino, "household") };
  };

  it("is the member's own lots and their part of what nobody owns; the two add up to the account's balance, to the cent", async () => {
    // money in 1 000,00 by Aino, bills of 980,00: 20,00 left, all hers
    const w = await world(one([fromAino("2026-09-01", 1000), ["2026-09-03", -400, "SAHKO OY"], ["2026-09-04", -580, "ASUNTO OY ESIMERKKI"]], 0, { extra: shareAndChoose }));
    const held = await balances(w);
    expect([held.aino.balanceCents, held.ville.balanceCents, held.household.balanceCents]).toEqual([2000, 0, 2000]);
    expect([held.aino.traced, held.ville.traced, held.household.traced]).toEqual([true, true, undefined]);
    // the account is short: a debt of 500,00 before the history, paid in part by Aino's money, and the mortgage still owed 454,37 shared by the weights
    const short = await world(one([fromAino("2026-07-01", 1150), MORTGAGE("2026-07-03")], -500_00, { extra: shareAndChoose }));
    const owed = await balances(short);
    expect([owed.aino.balanceCents, owed.ville.balanceCents, owed.household.balanceCents]).toEqual([-22719, -22718, -45437]);
    // near miss: a limit is still cut by the part, and so is the balance of an account that is not cut by who paid it
    const weights = await world(one([fromAino("2026-09-01", 1000), ["2026-09-03", -400, "SAHKO OY"]], 0, { extra: shared }));
    const plain = await balances(weights);
    expect([plain.aino.balanceCents, plain.ville.balanceCents, plain.aino.traced]).toEqual([30000, 30000, undefined]);
  });
});
