/**
 * A member's own view counts parts: the rows and balances of a joint account at the viewer's part, the sums SQL adds
 * up equal to the reports', nothing of an account somebody else uses alone, and nothing at all of an account the
 * member may not see. The household view counts every account whole.
 */
import { } from "node:fs";
import { join } from "node:path";
import { type AccountType, buildDashboard, buildReports, createContext, type Part, partCents, type RawTransaction, type SourcePart, shareOf } from "@banking/core";
import { describe, expect, it } from "vitest";
import { rng } from "../../../packages/core/test/gen.ts";
import { createApp } from "../src/app.ts";
import { partSql } from "../src/db/finance/part-sql.ts";
import { openDatabase } from "../src/db/open.ts";
import { loadDemoData } from "../src/demo.ts";
import { loadConfig } from "../src/platform/config.ts";
import { requestInputs, type Scope, type ScopeData } from "../src/services/analysis.ts";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { loadFixture } from "./fixture-db.ts";
import { type Client, NOW, setupApp, scratchDir } from "./helpers.ts";

const AINO = "MEIKALAINEN AINO";
const EERO = "KORHONEN EERO";
/** Merchants as the categorisation names them; the bank writes them in capitals. */
const SHOP = "Yhteinen Kauppa";
const KIOSK = "Tuntematon Puoti";
const TOYS = "Lapsen Kauppa";
const JULY = "from=2026-07-01&to=2026-07-31";
const SEPTEMBER = "from=2026-09-01&to=2026-09-30";
const YEAR = "from=2026-01-01&to=2026-12-31";

type App = Awaited<ReturnType<typeof setupApp>>;
type Member = Client & { id: string };

const raw = (bookingDate: string, euros: number, counterparty: string, extra: Partial<RawTransaction> = {}): RawTransaction => ({
  externalId: null, bookingDate, valueDate: null, amountCents: Math.round(euros * 100), currency: "EUR", status: "booked",
  counterparty, counterpartyIban: null, description: null, reference: null, mcc: null, ...extra,
});
const card = { mcc: "5411" };

/** An account as a link stores one. `identity` is the real account: both partners' copies of a joint account carry the same. */
async function link(s: App["s"], userId: string, id: string, holder: string, extra: { identity?: string; type?: AccountType } = {}) {
  await s.finance(userId).upsertAccount({ id, connectionId: null, provider: "enablebanking", externalId: null, identity: `idn-${id}`, name: id, holder, iban: null, currency: "EUR", type: "checking", ...extra });
}
async function book(s: App["s"], userId: string, accountId: string, rows: RawTransaction[]) {
  const repo = s.finance(userId);
  await ingestTransactions(repo, accountId, rows, "enablebanking");
  await reprocess(repo, s.settings);
}

/** What the joint account booked: a salary, purchases down to one cent, a refund, and 150 Aino moved in from her own account. */
const JOINT = [
  raw("2026-08-10", -60, SHOP.toUpperCase(), card),
  raw("2026-08-12", 15.99, SHOP.toUpperCase(), card),
  raw("2026-09-01", 3000.01, "ESIMERKKI OY", { description: "Palkka" }),
  raw("2026-09-03", -84.37, SHOP.toUpperCase(), card),
  raw("2026-09-05", -733.33, "ASUNTO OY ESIMERKKI"),
  raw("2026-09-06", 150, AINO),
  raw("2026-09-07", -0.01, SHOP.toUpperCase(), card),
  raw("2026-09-09", -12.34, `${KIOSK.toUpperCase()} 123`),
];
const jointCents = (pick: (cents: number) => boolean, month = "2026-09") => JOINT.filter((r) => r.bookingDate.startsWith(month) && r.counterparty !== AINO && pick(r.amountCents)).map((r) => r.amountCents);

/**
 * Aino linked the joint account and her own, Eero his own. The bank names both on the joint account, so each has a
 * half of it. `kid`: Aino also linked an account the bank says is Eero's alone, and moved 25 to it.
 */
async function household(opts: { shared?: boolean; kid?: boolean } = {}) {
  const app = await setupApp();
  const eero: Member = await app.member("eero", "Eero");
  const aino: Member = Object.assign(app.admin, { id: app.adminId });
  await link(app.s, aino.id, "aino-own", AINO);
  await link(app.s, aino.id, "joint", `${AINO}, ${EERO}`);
  await link(app.s, eero.id, "eero-own", EERO);
  if (opts.kid) await link(app.s, aino.id, "kid", EERO);
  await app.db.run("UPDATE accounts SET balance_cents = 100001, credit_limit_cents = 50001 WHERE id = 'joint'");
  await app.db.run("UPDATE accounts SET balance_cents = 20000 WHERE id = 'aino-own'");
  const repo = app.s.finance(aino.id);
  await ingestTransactions(repo, "joint", JOINT, "enablebanking");
  await ingestTransactions(repo, "aino-own", [raw("2026-09-04", -20, "OMA KAUPPA", card), raw("2026-09-06", -150, "YHTEINEN TILI"), ...(opts.kid ? [raw("2026-09-15", -25, EERO)] : [])], "enablebanking");
  if (opts.kid) await ingestTransactions(repo, "kid", [raw("2026-09-15", 25, AINO), raw("2026-09-16", -30, TOYS.toUpperCase(), card)], "enablebanking");
  await reprocess(repo, app.s.settings);
  await book(app.s, eero.id, "eero-own", [raw("2026-09-10", -45, "EERON KAUPPA", card)]);
  if (opts.shared !== false) expect((await aino.call("PUT", `/api/accounts/joint/shares/${eero.id}`)).status).toBe(200);
  return { ...app, aino, eero };
}

const get = async (c: Client, path: string) => (await c.call("GET", path)).body;
const totalsOf = async (c: Client, query = SEPTEMBER) => (await get(c, `/api/dashboard?${query}`)).totals as { incomeCents: number; expenseCents: number };
/** The viewer's part of the joint account, as /api/meta tells it. */
async function partOfJoint(c: Client): Promise<Part> {
  const meta = await get(c, "/api/meta");
  return [...meta.accounts, ...meta.sharedAccounts].find((a: { id: string }) => a.id === "joint").part;
}
const sum = (cents: number[], part?: Part) => cents.reduce((n, c) => n + Math.abs(part ? partCents(c, part) : c), 0);
const out = (c: number) => c < 0;
const into = (c: number) => c > 0;

describe("the part of a row in SQL", () => {
  it("equals partCents on 2 000 random rows and three sets of weights, to the cent", async () => {
    const { db } = await openDatabase(":memory:");
    await db.run("CREATE TABLE rows_of_test (id INTEGER PRIMARY KEY, account_id TEXT NOT NULL, amount_cents INTEGER NOT NULL)");
    // halves, 600 and 400 euros a month, and weights as large as a use can hold
    const sets = [[1, 1], [60000, 40000], [100_000_000, 99_999_999, 1]];
    const parts = new Map<string, Part>();
    sets.forEach((weights, set) => {
      const of = weights.reduce((n, w) => n + w, 0);
      weights.reduce((from, weight, user) => (parts.set(`s${set}-u${user}`, { from, to: from + weight, of }), from + weight), 0);
    });
    parts.set("left", { from: 0, to: 0, of: 1 });
    const accounts = [...parts.keys(), "whole"];
    const random = rng(20261009);
    const edge = [0, 1, -1, 2, -2, 99, -99, 100, -150, 99_999_999_999, -99_999_999_999];
    const rows = Array.from({ length: 2000 }, (_, i) => {
      const size = [100, 100_000, 100_000_000, 100_000_000_000][i % 4]!;
      const amount = i < edge.length * accounts.length ? edge[i % edge.length]! : Math.round((random() * 2 - 1) * size);
      return { id: i + 1, account: accounts[i < edge.length * accounts.length ? Math.floor(i / edge.length) : Math.floor(random() * accounts.length)]!, amount };
    });
    await db.batch(rows.map((r) => ({ sql: "INSERT INTO rows_of_test (id, account_id, amount_cents) VALUES (?, ?, ?)", params: [r.id, r.account, r.amount] })));

    const part = partSql(parts, "amount_cents");
    const read = await db.all<{ id: number; part: number }>(`SELECT id, ${part.sql} AS part FROM rows_of_test ORDER BY id`, part.params);
    expect(read).toHaveLength(2000);
    const expected = rows.map((r) => ({ id: r.id, part: partCents(r.amount, parts.get(r.account) ?? { from: 0, to: 1, of: 1 }) }));
    expect(read.map((r) => ({ id: Number(r.id), part: Number(r.part) }))).toEqual(expected);
    // money in, money out and nothing: each is in the rows
    expect([expected.some((r) => r.part > 0), expected.some((r) => r.part < 0), rows.some((r) => r.account === "whole" && r.amount !== 0)]).toEqual([true, true, true]);
    // the users' parts of a set add up to the account's rows, summed in SQL
    const added = await db.all<{ account_id: string; total: number }>(`SELECT account_id, SUM(${part.sql}) AS total FROM rows_of_test GROUP BY account_id`, part.params);
    for (const a of added) expect(Number(a.total), a.account_id).toBe(rows.filter((r) => r.account === a.account_id).reduce((n, r) => n + partCents(r.amount, parts.get(r.account) ?? { from: 0, to: 1, of: 1 }), 0));
    expect(Number(added.find((a) => a.account_id === "left")!.total)).toBe(0);
  });

  it("of an account cut by who paid it equals core's share on 3 000 random rows, to the cent; a row with no stored part is cut by the part", async () => {
    const { db } = await openDatabase(":memory:");
    await db.run("PRAGMA foreign_keys = OFF");
    await db.run("CREATE TABLE rows_of_test (id INTEGER PRIMARY KEY, account_id TEXT NOT NULL, amount_cents INTEGER NOT NULL)");
    const me = "u:me";
    const sets = [[1, 1], [60000, 40000], [100_000_000, 99_999_999, 1]];
    const parts = new Map<string, Part & { viewer?: string }>();
    sets.forEach((weights, set) => {
      const of = weights.reduce((n, w) => n + w, 0);
      weights.reduce((from, weight, user) => (parts.set(`s${set}-u${user}`, { from, to: from + weight, of, viewer: me }), from + weight), 0);
    });
    parts.set("plain", { from: 1, to: 3, of: 5 });
    const accounts = [...parts.keys()];
    const random = rng(20261013);
    const owners = [me, "u:other", "?", "-", "u:", "?"];
    const rows = Array.from({ length: 3000 }, (_, i) => {
      const size = [100, 100_000, 100_000_000, 100_000_000_000][i % 4]!;
      const amount = Math.round((random() * 2 - 1) * size) || 1;
      let left = Math.abs(amount);
      const stored: SourcePart[] = [];
      // every tenth row has no stored part; the others are cut in up to four pieces by owner
      for (let n = 0; i % 10 !== 0 && left > 0; n++) {
        const piece = n === 3 || random() < 0.3 ? left : Math.floor(random() * left) + 1;
        stored.push({ owner: owners[Math.floor(random() * owners.length)]!, kind: "own", cents: piece });
        left -= piece;
      }
      return { id: i + 1, account: accounts[Math.floor(random() * accounts.length)]!, amount, stored };
    });
    await db.batch(rows.map((r) => ({ sql: "INSERT INTO rows_of_test (id, account_id, amount_cents) VALUES (?, ?, ?)", params: [r.id, r.account, r.amount] })));
    // the table keeps a part of an owner once: pieces of one owner are summed, as the build sums them
    const summed = (stored: readonly SourcePart[]) => [...new Set(owners)].flatMap((owner) => (stored.some((p) => p.owner === owner) ? [{ owner, kind: "own" as const, cents: stored.filter((p) => p.owner === owner).reduce((n, p) => n + p.cents, 0) }] : []));
    const sums = rows.flatMap((r) => summed(r.stored).map((p) => ({ id: r.id, owner: p.owner, cents: p.cents })));
    await db.batch(sums.map((p) => ({ sql: "INSERT INTO tx_part (tx_id, owner, kind, grp, cents, passed) VALUES (?, ?, 'own', '', ?, 0)", params: [String(p.id), p.owner, p.cents] })));

    const part = partSql(parts, "amount_cents");
    const read = await db.all<{ id: number; part: number }>(`SELECT id, ${part.sql} AS part FROM rows_of_test ORDER BY id`, part.params);
    const expected = rows.map((r) => {
      const own = parts.get(r.account)!;
      const cut = own.viewer === undefined || !r.stored.length;
      const share = cut ? partCents(r.amount, own) : shareOf({ key: "k", ids: [], day: 0, cents: r.amount, what: "all", parts: summed(r.stored) }, me, own, () => false).cents;
      return { id: r.id, part: share };
    });
    expect(read.map((r) => ({ id: Number(r.id), part: Number(r.part) }))).toEqual(expected);
    // the rows with no stored part, the ones with and money in and out are all there; the viewer's cents are what is read
    expect([rows.some((r) => !r.stored.length && parts.get(r.account)!.viewer), rows.some((r) => r.stored.length && r.amount > 0), rows.some((r) => r.stored.length && r.amount < 0)]).toEqual([true, true, true]);
    // the params bind the account and the viewer in the order they stand
    expect(part.params.filter((p) => p === me)).toHaveLength([...parts.values()].filter((p) => p.viewer).length);
  });

  it("with no part below the whole it is the column itself, and it refuses numbers that are no part", () => {
    expect(partSql(new Map(), "amount_cents")).toEqual({ sql: "amount_cents", params: [] });
    expect(partSql(new Map([["a", { from: 0, to: 3, of: 3 }]]), "amount_cents")).toEqual({ sql: "amount_cents", params: [] });
    expect(partSql(new Map([["a", { from: 0, to: 1, of: 2 }]]), "amount_cents").params).toEqual(["a"]);
    expect(partSql(new Map([["a", { from: 0, to: 1, of: 1_000_000_000 }]]), "amount_cents").params).toEqual(["a"]);
    for (const bad of [{ from: 0, to: 1.5, of: 2 }, { from: 0, to: 3, of: 2 }, { from: 2, to: 1, of: 2 }, { from: -1, to: 1, of: 2 }, { from: 0, to: 0, of: 0 }, { from: 0, to: 1, of: 1_000_000_001 }]) {
      expect(() => partSql(new Map([["a", bad]]), "amount_cents"), JSON.stringify(bad)).toThrow("not a part of an account");
    }
  });
});

describe("the own view of a joint account", () => {
  it("the sums of /transactions for a month equal the dashboard's income and spending, to the cent, and a row carries the part beside the bank's amount", async () => {
    const { aino, eero } = await household();
    const [hers, his] = [await partOfJoint(aino), await partOfJoint(eero)];
    expect([hers.of, his.of, hers.to - hers.from, his.to - his.from]).toEqual([2, 2, 1, 1]);
    expect(hers).not.toEqual(his);

    for (const [viewer, part, ownOut] of [[aino, hers, 2000], [eero, his, 4500]] as const) {
      const list = await get(viewer, `/api/transactions?${SEPTEMBER}&limit=500`);
      const totals = await totalsOf(viewer);
      // the 150 Aino moved in is a transfer on both of its legs and in neither sum
      expect(list.inCents).toBe(sum(jointCents(into), part));
      expect(list.outCents).toBe(sum(jointCents(out), part) + ownOut);
      expect({ inCents: list.inCents, outCents: list.outCents }).toEqual({ inCents: totals.incomeCents, outCents: totals.expenseCents });
      for (const t of list.items) {
        if (t.accountId === "joint") expect(t.partCents, t.merchant).toBe(partCents(t.amountCents, part));
        else expect("partCents" in t, t.merchant).toBe(false);
      }
      // the bank's amount stays on the row
      expect(list.items.find((t: { merchant: string; amountCents: number }) => t.amountCents === -73333)).toMatchObject({ accountId: "joint", partCents: partCents(-73333, part) });
    }
    // the two own views of the joint account add up to it, the odd cents included
    expect(sum(jointCents(out), hers) + sum(jointCents(out), his)).toBe(sum(jointCents(out)));
    expect(sum(jointCents(into), hers) + sum(jointCents(into), his)).toBe(300001);
    // a month with a refund: the list adds its part as money in
    const august = await get(aino, "/api/transactions?from=2026-08-01&to=2026-08-31");
    expect([august.inCents, august.outCents]).toEqual([partCents(1599, hers), partCents(6000, hers)]);
  });

  it("the household view counts the account whole, for the member who linked it and for the one it is shared with", async () => {
    const { s, aino, eero } = await household();
    for (const [viewer, ownOut] of [[aino, 2000 + 4500 * 0], [eero, 4500]] as const) {
      const list = await get(viewer, `/api/transactions?${SEPTEMBER}&scope=household&limit=500`);
      expect(list.outCents).toBe(sum(jointCents(out)) + ownOut);
      expect(list.inCents).toBe(300001);
      expect(list.items.some((t: object) => "partCents" in t)).toBe(false);
      expect((await get(viewer, `/api/dashboard?${SEPTEMBER}&scope=household`)).totals).toMatchObject({ incomeCents: 300001, expenseCents: list.outCents });
    }
    // nobody shares with Aino: her household view exists because a part of hers is below the whole
    expect(await s.analysis.get(s, aino.id, "household")).not.toBe(await s.analysis.get(s, aino.id, "own"));
  });

  it("near miss: a member whose every account is theirs whole has one view, and the advice reads it too", async () => {
    const { s, eero } = await household({ shared: false });
    const own = await s.analysis.get(s, eero.id, "own");
    expect(await s.analysis.get(s, eero.id, "household")).toBe(own);
    expect(await s.analysis.get(s, eero.id, "used")).toBe(own);
    expect(own.ctx.txs.every((t) => t.wholeCents === undefined)).toBe(true);
  });

  it("the balance and the credit limit are the viewer's part in the own view and whole in the household view", async () => {
    const { s, aino, eero } = await household();
    const hers = await partOfJoint(aino);
    const balances = async (userId: string, view: "own" | "household") => new Map((await requestInputs(s, userId, (await s.analysis.get(s, userId, view)).accounts)).balances.map((b) => [b.id, b]));
    const own = await balances(aino.id, "own");
    expect(own.get("joint")).toMatchObject({ balanceCents: partCents(100001, hers), creditLimitCents: partCents(50001, hers), part: hers, joint: true });
    expect(own.get("joint")!.use!.users.map((u) => u.label).sort()).toEqual(["Aino", "Eero"]);
    expect(own.get("aino-own")).toMatchObject({ balanceCents: 20000, part: { from: 0, to: 1, of: 1 }, use: { users: [{ userId: aino.id }] } });
    expect(own.get("aino-own")!.joint).toBeUndefined();
    const whole = await balances(aino.id, "household");
    expect(whole.get("joint")).toMatchObject({ balanceCents: 100001, creditLimitCents: 50001, joint: true, use: { source: "bank" } });
    expect(whole.get("joint")!.part).toBeUndefined();
    // the two own views of the balance add up to it
    const his = (await balances(eero.id, "own")).get("joint")!;
    expect(his.balanceCents! + own.get("joint")!.balanceCents!).toBe(100001);
    expect(his.creditLimitCents! + own.get("joint")!.creditLimitCents!).toBe(50001);
  });

  it("a use said by the partner changes the viewer's dashboard on the next request, and taking it back does too", async () => {
    const { aino, eero } = await household();
    const half = await partOfJoint(eero);
    const expected = async () => sum(jointCents(out), await partOfJoint(eero)) + 4500;
    expect((await totalsOf(eero)).expenseCents).toBe(sum(jointCents(out), half) + 4500);

    expect((await aino.call("PUT", "/api/accounts/joint/use", { users: [{ userId: aino.id, weight: 60000 }, { userId: eero.id, weight: 20000 }] })).status).toBe(200);
    const quarter = await partOfJoint(eero);
    expect([quarter.to - quarter.from, quarter.of]).toEqual([1, 4]);
    const after = await totalsOf(eero);
    expect(after.expenseCents).toBe(await expected());
    expect(after.expenseCents).not.toBe(sum(jointCents(out), half) + 4500);
    expect(after.incomeCents).toBe(partCents(300001, quarter));
    // hers moved with it: the two still add up to the account
    expect((await totalsOf(aino)).incomeCents + after.incomeCents).toBe(300001);

    expect((await aino.call("DELETE", "/api/accounts/joint/use")).status).toBe(200);
    expect((await totalsOf(eero)).expenseCents).toBe(sum(jointCents(out), half) + 4500);
  });

  it("the merchant sums add up parts in the own view, and one merchant's summary follows the view of its list", async () => {
    const { aino } = await household();
    const hers = await partOfJoint(aino);
    const shop = (await get(aino, "/api/merchants")).items.find((m: { merchant: string }) => m.merchant === SHOP);
    expect(shop).toMatchObject({ count: 4, totalCents: sum([-6000, -8437, -1], hers), inCents: partCents(1599, hers) });
    const own = (await get(aino, `/api/merchants/summary?merchant=${encodeURIComponent(SHOP)}`)).summary;
    expect(own).toMatchObject({ count: 4, outCents: sum([-6000, -8437, -1], hers), inCents: partCents(1599, hers) });
    const whole = (await get(aino, `/api/merchants/summary?merchant=${encodeURIComponent(SHOP)}&scope=household`)).summary;
    expect(whole).toMatchObject({ count: 4, outCents: 14438, inCents: 1599 });
    const unknown = await get(aino, "/api/merchants/uncategorised");
    expect(unknown.items.find((m: { merchant: string }) => m.merchant === KIOSK)).toMatchObject({ totalCents: partCents(1234, hers), count: 1 });
    expect(unknown.totalCents).toBe(unknown.items.reduce((n: number, m: { totalCents: number }) => n + m.totalCents, 0));
    // near miss: a merchant of her own account is whole
    expect((await get(aino, "/api/merchants")).items.find((m: { merchant: string }) => m.merchant === "Oma Kauppa")).toMatchObject({ totalCents: 2000 });
  });

  it("the advice reads the accounts the viewer uses whole: rows and balances as the bank has them", async () => {
    const { s, aino } = await household();
    const [own, used] = [await s.analysis.get(s, aino.id, "own"), await s.analysis.get(s, aino.id, "used")];
    expect(used).not.toBe(own);
    const rent = (data: typeof own) => data.ctx.txs.find((t) => t.merchant.includes("Asunto"))!;
    expect(rent(own)).toMatchObject({ amountCents: partCents(-73333, await partOfJoint(aino)), wholeCents: -73333 });
    expect(rent(used).amountCents).toBe(-73333);
    expect(used.ctx.txs.every((t) => t.wholeCents === undefined)).toBe(true);
    expect(used.accounts.map((a) => [a.id, a.part])).toEqual(own.accounts.map((a) => [a.id, undefined]));
    expect((await requestInputs(s, aino.id, used.accounts)).balances.find((b) => b.id === "joint")).toMatchObject({ balanceCents: 100001, joint: true });
    expect((await aino.call("GET", "/api/optimise")).status).toBe(200);
  });
});

describe("access and use are two matters", () => {
  it("a member with no access to the joint account has no row of it in any answer, whatever the use says", async () => {
    const { aino, eero } = await household({ shared: false });
    expect((await aino.call("PUT", "/api/accounts/joint/use", { users: [{ userId: aino.id, weight: 1 }, { userId: eero.id, weight: 3 }] })).status).toBe(200);
    const paths = [
      "/api/meta",
      `/api/dashboard?${YEAR}`,
      `/api/dashboard?${YEAR}&scope=household`,
      `/api/reports?${YEAR}`,
      `/api/reports?${YEAR}&scope=household`,
      "/api/transactions?limit=500",
      "/api/transactions?limit=500&scope=household",
      "/api/transactions?accountId=joint",
      "/api/recurring",
      "/api/merchants",
      `/api/merchants/summary?merchant=${encodeURIComponent(SHOP)}`,
      `/api/merchants/summary?merchant=${encodeURIComponent(SHOP)}&scope=household`,
      "/api/merchants/uncategorised",
      "/api/optimise",
      "/api/optimise?scope=household",
      "/api/loans/proposals",
      `/api/export/transactions.csv?${YEAR}`,
      `/api/export/transactions.csv?${YEAR}&scope=household`,
      `/api/export/report.csv?${YEAR}`,
    ];
    for (const path of paths) {
      const answer = await eero.call("GET", path);
      expect(answer.status, path).toBe(200);
      const text = JSON.stringify(answer.body).toLowerCase();
      // its merchants, its id, its biggest amounts in cents and as the export writes them
      for (const word of [SHOP, KIOSK, "asunto oy", "esimerkki oy", "joint", "300001", "73333", "3000,01", "733,33"]) expect(text.includes(word.toLowerCase()), `${path}: ${word}`).toBe(false);
    }
    expect(await totalsOf(eero, YEAR)).toMatchObject({ incomeCents: 0, expenseCents: 4500 });
    expect((await get(eero, "/api/transactions?limit=500")).total).toBe(1);

    // near miss: shared with him, his three quarters of it are in his own view
    expect((await aino.call("PUT", `/api/accounts/joint/shares/${eero.id}`)).status).toBe(200);
    const his = await partOfJoint(eero);
    expect([his.to - his.from, his.of]).toEqual([3, 4]);
    expect(await totalsOf(eero)).toMatchObject({ incomeCents: partCents(300001, his), expenseCents: sum(jointCents(out), his) + 4500 });
    expect((await get(eero, `/api/transactions?${SEPTEMBER}`)).total).toBe(7);
  });

  it("an account another member uses alone is in no figure and no list of the own view, and whole in the household view", async () => {
    const { aino } = await household({ kid: true });
    const own = await get(aino, "/api/transactions?limit=500");
    expect(own.items.some((t: { accountId: string }) => t.accountId === "kid")).toBe(false);
    expect(own.items.some((t: { merchant: string }) => t.merchant === SHOP)).toBe(true);
    expect(own.total).toBe(JOINT.length + 3);
    for (const path of ["/api/merchants", "/api/merchants/uncategorised", `/api/export/transactions.csv?${YEAR}`, `/api/dashboard?${YEAR}`, `/api/reports?${YEAR}`]) {
      expect(JSON.stringify(await get(aino, path)).includes(TOYS), path).toBe(false);
    }
    expect(await get(aino, `/api/merchants/summary?merchant=${encodeURIComponent(TOYS)}`)).toEqual({ summary: null });
    expect((await get(aino, `/api/merchants/summary?merchant=${encodeURIComponent(TOYS)}&scope=household`)).summary).toMatchObject({ count: 1, outCents: 3000 });
    // the 25 she moved to it left her own figures for good: money to a person, not a transfer of her own
    const hers = await partOfJoint(aino);
    expect((await totalsOf(aino)).expenseCents).toBe(sum(jointCents(out), hers) + 2000 + 2500);
    // and Tapahtumat, its export and Kauppiaat say the same of the row, with the bank's amount on it
    const september = await get(aino, `/api/transactions?${SEPTEMBER}`);
    expect(september.outCents).toBe(sum(jointCents(out), hers) + 2000 + 2500);
    expect(september.items.find((t: { amountCents: number }) => t.amountCents === -2500)).toMatchObject({ accountId: "aino-own", category: "p2p", isTransfer: false });
    expect((await get(aino, `/api/transactions?${SEPTEMBER}&category=p2p`)).items.map((t: { amountCents: number }) => t.amountCents)).toEqual([-2500]);
    expect((await get(aino, "/api/merchants")).items.find((m: { merchant: string }) => m.merchant === "Korhonen Eero")).toMatchObject({ totalCents: 2500, category: "p2p" });
    const moved = (csv: string) => csv.split("\n").filter((line) => line.includes(";-25;")).map((line) => line.trim().endsWith(";kyllä"));
    expect(moved(await get(aino, `/api/export/transactions.csv?${SEPTEMBER}`))).toEqual([false]);

    const whole = await get(aino, "/api/transactions?limit=500&scope=household");
    expect(whole.total).toBe(JOINT.length + 5);
    expect(whole.items.find((t: { merchant: string }) => t.merchant === TOYS)).toMatchObject({ accountId: "kid", amountCents: -3000 });
    // near miss: in the household view the 25 is the transfer her categorisation stored, on both of its legs
    expect(whole.items.filter((t: { amountCents: number }) => Math.abs(t.amountCents) === 2500).map((t: { isTransfer: boolean }) => t.isTransfer)).toEqual([true, true]);
    expect(moved(await get(aino, `/api/export/transactions.csv?${SEPTEMBER}&scope=household`))).toEqual([true]);
    expect(await get(aino, `/api/export/transactions.csv?${YEAR}&scope=household`)).toContain(TOYS);
    // there the 25 is a transfer between two accounts in view, and the account's own purchase counts
    expect((await get(aino, `/api/dashboard?${SEPTEMBER}&scope=household`)).totals.expenseCents).toBe(sum(jointCents(out)) + 2000 + 3000);
  });

  it("the export keeps the bank's amounts and its columns in the own view", async () => {
    const { aino } = await household();
    const csv: string = await get(aino, `/api/export/transactions.csv?${SEPTEMBER}`);
    expect(csv.split("\n")[0]!.replace(/^﻿/, "").trim()).toBe("Päivä;Tili;Kauppias;Saaja/maksaja;Viesti;Kategoria;Ryhmä;Summa €;Tila;Lähde;Siirto");
    expect(csv).toContain("-733,33");
    expect(csv).toContain("3000,01");
  });
});

describe("money a user pays into the joint account", () => {
  it("his monthly 400: Tapahtumat and Kauppiaat say what the front page says, in her view and in his", async () => {
    const { s, aino, eero } = await household();
    await book(s, aino.id, "joint", [raw("2026-07-01", 400, EERO)]);
    await book(s, eero.id, "eero-own", [raw("2026-07-01", -400, AINO)]);
    const seen: Record<string, unknown> = {};
    for (const [name, m] of [["aino", aino], ["eero", eero]] as const) {
      const totals = await totalsOf(m, JULY);
      const list = await get(m, `/api/transactions?${JULY}`);
      const merchants = (await get(m, `/api/merchants?${JULY}`)).items.map((x: { merchant: string; totalCents: number; inCents: number }) => [x.merchant, x.totalCents, x.inCents]);
      const rows = list.items.map((t: { accountId: string; amountCents: number; category: string; isTransfer: boolean }) => [t.accountId, t.amountCents, t.category, t.isTransfer]).sort();
      seen[name] = { dashboard: [totals.incomeCents, totals.expenseCents], list: [list.inCents, list.outCents], rows, merchants };
    }
    // one movement in both views: a transfer on the row, in no sum, and the bank's 400 still on the row
    expect(seen).toEqual({
      aino: { dashboard: [0, 0], list: [0, 0], rows: [["joint", 40000, "transfer", true]], merchants: [] },
      eero: { dashboard: [0, 0], list: [0, 0], rows: [["eero-own", -40000, "transfer", true], ["joint", 40000, "transfer", true]], merchants: [] },
    });
    // the category filter, a merchant's summary, the unrecognised spending and the export follow the view
    expect([(await get(aino, `/api/transactions?${JULY}&category=transfer`)).total, (await get(aino, `/api/transactions?${JULY}&category=p2p_in`)).total]).toEqual([1, 0]);
    expect((await get(aino, `/api/merchants/summary?merchant=${encodeURIComponent("Korhonen Eero")}`)).summary).toMatchObject({ count: 1, transfers: 1, inCents: 0, outCents: 0, category: "transfer" });
    expect((await get(eero, "/api/merchants/uncategorised")).items.map((m: { merchant: string }) => m.merchant)).not.toContain("Meikalainen Aino");
    const lines = ((await get(eero, `/api/export/transactions.csv?${JULY}`)) as string).trim().split("\n").slice(1).map((line) => line.trim());
    expect(lines.map((line) => line.endsWith(";kyllä"))).toEqual([true, true]);
    expect(lines.filter((line) => line.includes(";-400;") || line.includes(";400;"))).toHaveLength(2);

    // near miss: the household view counts the stored rows whole. Nobody shares his own account with her, so there
    // his 400 is money from a person
    const whole = await get(aino, `/api/transactions?${JULY}&scope=household`);
    expect([whole.inCents, whole.outCents, whole.items.map((t: { category: string }) => t.category)]).toEqual([40000, 0, ["p2p_in"]]);
    expect((await get(aino, `/api/dashboard?${JULY}&scope=household`)).totals).toMatchObject({ incomeCents: 40000, expenseCents: 0 });
  });

  it("his 400 from an account she does not see is no income of hers, and money from a person in the household view", async () => {
    const { s, aino } = await household();
    await book(s, aino.id, "joint", [raw("2026-07-01", 400, EERO), raw("2026-07-02", 55, "VIERAS VEIKKO")]);
    const hers = await partOfJoint(aino);
    // near miss: the 55 of somebody who holds no part of the account is income, at her part
    expect((await totalsOf(aino, "from=2026-07-01&to=2026-07-31")).incomeCents).toBe(partCents(5500, hers));
    expect((await get(aino, "/api/dashboard?from=2026-07-01&to=2026-07-31&scope=household")).totals.incomeCents).toBe(45500);
  });
});

describe("a card's bill paid from a joint account both partners linked", () => {
  const BILL = "YHTEISKORTTI LASKU";
  const MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09"];
  /** What the joint account booked, on each partner's copy of it: the card's bill on the 13th and one purchase. */
  const paid = [...MONTHS.map((m) => raw(`${m}-13`, -200, BILL)), raw("2026-09-03", -84.37, SHOP.toUpperCase(), card)];
  const used = [...MONTHS, "2026-10"].map((m) => raw(`${m}-02`, -200, "YHTEINEN MATKA OY", { mcc: "4722" }));

  /**
   * Aino and Eero both linked the joint account and said 400 and 600 a month of it. Aino alone linked the card both
   * hold, and shared it: 200 of purchases a month and the bill that pays them. Each has an account in their own
   * name, which is what tells the bank's line of two holders who they are.
   */
  async function cardHousehold() {
    const app = await setupApp();
    const eero: Member = await app.member("eero", "Eero");
    const aino: Member = Object.assign(app.admin, { id: app.adminId });
    await link(app.s, aino.id, "aino-save", AINO, { type: "savings" });
    await link(app.s, eero.id, "eero-save", EERO, { type: "savings" });
    await link(app.s, aino.id, "aino-joint", `${AINO}, ${EERO}`, { identity: "idn-joint" });
    await link(app.s, eero.id, "eero-joint", `${EERO}, ${AINO}`, { identity: "idn-joint" });
    await link(app.s, aino.id, "joint-card", `${AINO}, ${EERO}`, { type: "credit_card" });
    const repo = app.s.finance(aino.id);
    await ingestTransactions(repo, "aino-joint", paid, "enablebanking");
    await ingestTransactions(repo, "joint-card", [...used, ...MONTHS.map((m) => raw(`${m}-13`, 200, BILL))], "enablebanking");
    await reprocess(repo, app.s.settings);
    await book(app.s, eero.id, "eero-joint", paid);
    await repo.setAccountBalance("aino-joint", 100_001, NOW.toISOString());
    await repo.setAccountBalance("joint-card", -20_000, NOW.toISOString());
    await app.s.finance(eero.id).setAccountBalance("eero-joint", 100_001, NOW.toISOString());
    expect((await aino.call("PUT", `/api/accounts/joint-card/shares/${eero.id}`)).status).toBe(200);
    const said = [{ userId: aino.id, weight: 40_000 }, { userId: eero.id, weight: 60_000 }];
    expect((await aino.call("PUT", "/api/accounts/aino-joint/use", { users: said })).status).toBe(200);
    return { ...app, aino, eero };
  }
  const spent = async (c: Client, scope: Scope) => (await get(c, `/api/dashboard?${SEPTEMBER}&scope=${scope}`)).totals.consumptionCents as number;
  const paidOut = async (c: Client, scope: Scope) => (await get(c, `/api/transactions?${SEPTEMBER}&scope=${scope}`)).outCents as number;

  it("the card's purchases are spent once: the two own views of a month add up to the household's, to the cent", async () => {
    const { aino, eero } = await cardHousehold();
    // 200,00 on the card and 84,37 from the account; the bill of 200,00 only moves money to the card
    expect(await spent(aino, "household")).toBe(28437);
    expect((await spent(aino, "own")) + (await spent(eero, "own"))).toBe(28437);
    expect((await paidOut(aino, "own")) + (await paidOut(eero, "own"))).toBe(28437);
    const his: Part = (await get(eero, "/api/meta")).accounts.find((a: { id: string }) => a.id === "eero-joint").part;
    expect(await spent(eero, "own")).toBe(10000 - partCents(-8437, his));
    // the bill on his copy of the account: a transfer in his view, at his part, with the bank's sum beside it
    const rows = (await get(eero, `/api/transactions?${SEPTEMBER}&category=transfer`)).items.map((t: { accountId: string; amountCents: number; partCents?: number }) => [t.accountId, t.amountCents, t.partCents]);
    expect(rows.sort()).toEqual([["eero-joint", -20000, partCents(-20000, his)], ["joint-card", 20000, 10000]]);
  });

  it("his payday window expects the card's bill, and no bill named after the card", async () => {
    const { eero } = await cardHousehold();
    const { ahead } = await get(eero, "/api/dashboard");
    // the balance it follows is his part of the joint account, the one account that pays the bill
    expect(ahead.balance).toMatchObject({ counts: "part", accounts: 1 });
    expect(ahead.rows).toMatchObject([{ date: "2026-10-13", name: "joint-card", category: "transfer", source: "card" }]);
    expect(ahead.totals).toMatchObject({ recurringCents: 0, cardCents: -ahead.rows[0].cents });
    expect(ahead.upcoming.map((r: { name: string }) => r.name)).toEqual(["Yhteinen Matka Oy"]);
  });
});

describe("a bill paid another way settles only by the rows the view holds", () => {
  const INSURANCE = "ESIMERKKI VAKUUTUS OY";
  const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  /** The bill's rows in Aino's own account: 50,00 on the 15th, so the 15.10. is due. */
  const bill = MONTHS.map((m) => raw(`${m}-15`, -50, INSURANCE));
  const insurance = async (c: Client, scope?: Scope) => {
    const { ahead } = await get(c, `/api/dashboard${scope ? `?scope=${scope}` : ""}`);
    return ahead.rows.filter((r: { name: string }) => /vakuutus/i.test(r.name)) as { date: string; source: string; cents: number; pending?: true }[];
  };

  it("a payment on an account another member uses alone settles nothing in the own view, and the bill in Koko talous", async () => {
    const { aino, eero, s } = await household();
    await book(s, aino.id, "aino-own", bill);
    await book(s, eero.id, "eero-own", [raw("2026-10-08", -50, INSURANCE)]);
    expect((await eero.call("PUT", `/api/accounts/eero-own/shares/${aino.id}`)).status).toBe(200);
    // the member's own view does not hold his row: the bill is still due, in full
    expect(await insurance(aino)).toMatchObject([{ date: "2026-10-15", source: "recurring", cents: -5000 }]);
    // Koko talous holds both accounts: the bill is paid
    expect(await insurance(aino, "household")).toEqual([]);
  });

  it("a payment on the joint account, seen at a part, settles the bill by the bank's whole sum, in both views", async () => {
    const { aino, s } = await household();
    await book(s, aino.id, "aino-own", bill);
    expect(await insurance(aino)).toHaveLength(1);
    await book(s, aino.id, "joint", [raw("2026-10-08", -50, INSURANCE)]);
    expect(await insurance(aino)).toEqual([]);
    expect(await insurance(aino, "household")).toEqual([]);
  });

  it("the same payment, not booked yet: paid and waiting where the balance counts the joint account, no row where it does not", async () => {
    const { aino, s } = await household();
    await book(s, aino.id, "aino-own", bill);
    await book(s, aino.id, "joint", [raw("2026-10-08", -50, INSURANCE, { status: "pending" })]);
    // Koko talous counts both accounts: the joint account's balance still holds the money until the bank books the row
    expect(await insurance(aino, "household")).toMatchObject([{ date: "2026-10-15", cents: -5000, pending: true }]);
    // the own view's balance is her own account's alone: the joint account's payment is in no figure of it
    expect((await get(aino, "/api/dashboard")).ahead.balance).toMatchObject({ counts: "own" });
    expect(await insurance(aino)).toEqual([]);
  });
});

describe("Kauppiaat and the unrecognised spending follow the view", () => {
  it("the household view is whole, also for a member nobody shares an account with", async () => {
    const { aino } = await household({ shared: false });
    const hers = await partOfJoint(aino);
    const shopIn = async (query: string) => (await get(aino, `/api/merchants${query}`)).items.find((m: { merchant: string }) => m.merchant === SHOP);
    const [own, whole] = [await shopIn(""), await shopIn("?scope=household")];
    expect(own).toMatchObject({ count: 4, totalCents: sum([-6000, -8437, -1], hers), inCents: partCents(1599, hers) });
    expect(whole).toMatchObject({ count: 4, totalCents: 14438, inCents: 1599 });
    // the figure per month is a part of the whole one too
    expect(whole.monthlyCents).toBeGreaterThan(0);
    expect(Math.abs(own.monthlyCents * 2 - whole.monthlyCents)).toBeLessThanOrEqual(2);
    const kiosk = async (query: string) => (await get(aino, `/api/merchants/uncategorised${query}`)).items.find((m: { merchant: string }) => m.merchant === KIOSK);
    expect(await kiosk("?scope=household")).toMatchObject({ totalCents: 1234, count: 1 });
    expect(await kiosk("")).toMatchObject({ totalCents: partCents(1234, hers), count: 1 });
  });
});

describe("a household where nobody uses an account together", () => {
  const RANGE = { from: "2026-01-01", to: "2026-12-31" };
  /** The rows of a view, and what the front page and the reports make of them. */
  async function answers(s: App["s"], userId: string, view: Pick<ScopeData, "ctx" | "accounts">) {
    const { balances, inputs } = await requestInputs(s, userId, view.accounts);
    return { rows: view.ctx.txs, dashboard: buildDashboard(view.ctx, RANGE, balances, inputs), reports: buildReports({ ctx: view.ctx, range: RANGE, balances, inputs }) };
  }
  /**
   * Holds a view against the own view as 0.10.0 built it: the accounts the member linked, with their rows as they are
   * stored and nothing told again.
   */
  async function unchanged(s: App["s"], userId: string, scope: Scope = "own") {
    const seen = await s.analysis.get(s, userId, scope);
    const repo = s.finance(userId);
    const accounts = (await repo.listAccounts()).map((a) => ({ ...a, ownerName: null }));
    expect(seen.accounts.map(({ use: _use, part: _part, ...a }) => a)).toEqual(accounts);
    const balances = (await requestInputs(s, userId, seen.accounts)).balances;
    expect(balances.map((b) => [b.id, b.balanceCents, b.creditLimitCents ?? null])).toEqual(accounts.map((a) => [a.id, a.balanceCents, a.creditLimitCents ?? null]));
    const stored = { ctx: createContext(await repo.allTransactions(), accounts, s.today()), accounts: seen.accounts };
    expect(await answers(s, userId, seen)).toEqual(await answers(s, userId, stored));
    return seen;
  }

  it("the demo data with another member's account shared and no part in it: the own view is the stored rows, row for row", async () => {
    const app = await setupApp();
    const eero = await app.member("eero", "Eero");
    const { s, admin: aino, adminId } = app;
    for (const id of [adminId, eero.id]) await loadDemoData(s.finance(id), s.settings, s.today());
    // 25 she paid to a person who paid it back, and 25 from somebody else onto another account of hers a day later
    await link(s, adminId, "aino-own", AINO);
    await link(s, adminId, "aino-savings", AINO);
    await book(s, adminId, "aino-own", [raw("2026-09-01", -25, "VIERAS VEIKKO"), raw("2026-09-03", 25, "VIERAS VEIKKO")]);
    await book(s, adminId, "aino-savings", [raw("2026-09-02", 25, "TOINEN TYYPPI")]);
    expect(await app.db.all("SELECT amount_cents, category_source, is_transfer FROM transactions WHERE account_id IN ('aino-own', 'aino-savings') ORDER BY amount_cents, account_id")).toEqual([
      { amount_cents: -2500, category_source: "default", is_transfer: 0 },
      { amount_cents: 2500, category_source: "match", is_transfer: 0 },
      { amount_cents: 2500, category_source: "default", is_transfer: 0 },
    ]);
    const his = (await get(eero, "/api/meta")).accounts.find((a: { type: string }) => a.type === "checking");
    expect((await eero.call("PUT", `/api/accounts/${his.id}/shares/${adminId}`)).status).toBe(200);
    // his account is in her household view, and no part of it is hers
    expect((await get(aino, "/api/meta")).sharedAccounts.map((a: { id: string; part: Part }) => [a.id, a.part])).toEqual([[his.id, { from: 0, to: 0, of: 1 }]]);

    const own = await unchanged(s, adminId);
    expect(own.ctx.txs.length).toBeGreaterThan(500);
    expect(own.told.size).toBe(0);
    expect(await s.analysis.get(s, adminId, "used")).toBe(own);
    await unchanged(s, eero.id);
    // and the sums of Tapahtumat are sums of the stored rows
    const list = await get(aino, `/api/transactions?${SEPTEMBER}&accountId=aino-savings`);
    expect([list.inCents, list.outCents]).toEqual([2500, 0]);
  });

  it("the frozen database of 0.10.0: the rows and figures of that release, but for the half of the account with two holders", async () => {
    const file = join(scratchDir("talous-own-view-"), "banking.db");
    loadFixture(file, "0.10.0.sql");
    const { db } = await openDatabase(file);
    const config = loadConfig({ APP_SECRET: "test-secret-that-is-long-enough-0123456789", INDUSTRY_LOOKUP: "false", APP_BASE_URL: "http://localhost:8080" });
    const s = createApp({ db, config, now: () => NOW }).services;
    // Eero has one account of his own, and Aino's a-1 is shared with him: he has no part in it
    await unchanged(s, "u-eero");
    // Aino's household view counts every account of hers whole: what 0.10.0 showed her as her own figures
    await unchanged(s, "u-aino", "household");
    // her own view differs by the account the bank gives two holders, and by nothing else: its balance is halved
    const own = await s.analysis.get(s, "u-aino", "own");
    const whole = await s.analysis.get(s, "u-aino", "household");
    expect(own.accounts.filter((a) => a.part!.of !== 1).map((a) => [a.id, a.part])).toEqual([["a-5", { from: 0, to: 1, of: 2 }]]);
    expect(own.ctx.txs).toEqual(whole.ctx.txs);
    const balances = async (view: ScopeData) => (await requestInputs(s, "u-aino", view.accounts)).balances.map((b) => [b.id, b.balanceCents]);
    expect(await balances(own)).toEqual((await balances(whole)).map(([id, cents]) => [id, id === "a-5" ? 122500 : cents]));
    db.close();
  });
});
