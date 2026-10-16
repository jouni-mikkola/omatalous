/**
 * The settlement between partners through the routes: who may ask, a month's figures, dated agreements, household
 * members who have no login, the stores in the data export, and what the trace reads of the agreements. Made-up names
 * and sums; the first user by id is "Aino".
 */
import { describe, expect, it } from "vitest";
import { ingestTransactions } from "../src/services/ingest.ts";
import { ensureTrace } from "../src/services/money-trace.ts";
import { AINO, cents, fromAino, fromVille, IBAN, KEY, link, type R, raw, VILLE, type World, world } from "./trace-world.ts";

const MONTH = "2026-09";

/** 1000,00 from Aino and 600,00 from Ville, then rent 800,00 and a shop 100,00: by the lots Aino paid 562,50 and Ville 337,50. */
const SEPTEMBER: R[] = [fromAino("2026-09-01", 1000), fromVille("2026-09-02", 600), ["2026-09-05", -800, "ESIMERKKI KIINTEISTÖT OY"], ["2026-09-10", -100, "ESIMERKKI OY"]];
/** Both partners linked the joint account. */
const both = (rows: R[], over: Parameters<typeof world>[0] extends infer O ? Partial<O> : never = {}) =>
  world({ copies: [{ by: "aino", id: "pool-a", rows }, { by: "ville", id: "pool-v", rows }], balance: cents(rows), ...over });

const get = async (w: World, userId: string, month = MONTH) => {
  const res = await w.as(userId).call("GET", `/api/settlement?month=${month}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.pools as { accountId: string; names: Record<string, string>; settlement: any }[];
};
const members = (pool: { settlement: any }) => Object.fromEntries(pool.settlement.members.map((m: any) => [m.owner, m]));
const put = (w: World, userId: string, body: unknown, id = "pool-a") => w.as(userId).call("PUT", `/api/settlement/agreements/${id}`, body);
const stored = (w: World) => w.db.all<{ account_key: string; valid_from: string; kind: string; value: string }>("SELECT account_key, valid_from, kind, value FROM account_agreement ORDER BY valid_from");

describe("settlement routes", () => {
  it("serves a month to the members who are weighted in the pool and to nobody else", async () => {
    const w = await both(SEPTEMBER);
    const [a, v] = [w.aino, w.ville].map((id) => `u:${id}`) as [string, string];
    const pools = await get(w, w.aino);
    expect(pools).toHaveLength(1);
    const m = members(pools[0]!);
    expect(m[a]).toMatchObject({ paid: 56250, owed: 45000, over: 11250 });
    expect(m[v]).toMatchObject({ paid: 33750, owed: 45000, over: -11250 });
    expect(pools[0]!.settlement).toMatchObject({ netCost: 90000, unknownPaid: 0, unknownOwed: 0, status: { open: false } });
    expect(pools[0]!.names).toMatchObject({ [`u:${w.adminId}`]: "Aino", [w.adminId === w.aino ? v : a]: "Ville" });
    expect(members((await get(w, w.ville))[0]!)[v]!.over).toBe(-11250);

    // a third member who sees the account (it is shared with them) but is no user of it: nothing, as if it were not there
    const cecilia = await w.member("cecilia", "Cecilia");
    expect(await w.s.household.share(w.aino, "pool-a", cecilia.id)).toBe(true);
    expect((await cecilia.call("GET", `/api/settlement?month=${MONTH}`)).body).toEqual({ month: MONTH, pools: [] });
    // and the words of the pool are those of its users: Cecilia is a user of the household and none of the pool
    expect(Object.keys((await get(w, w.aino))[0]!.names).sort()).toEqual([a, v].sort());
    expect((await cecilia.call("GET", "/api/settlement/agreements/pool-a")).status).toBe(404);
    expect((await cecilia.call("PUT", "/api/settlement/agreements/pool-a", { validFrom: "2026-01-01", kind: "equal", value: { who: [a, v] } })).status).toBe(404);
    expect((await cecilia.call("PUT", "/api/settlement/agreements/pool-v", { validFrom: "2026-01-01", kind: "equal", value: { who: [a, v] } })).status).toBe(404);
    expect(await stored(w)).toEqual([]);
    // a month that is none, and a write with no CSRF header
    expect((await w.as(w.aino).call("GET", "/api/settlement?month=2026-13")).status).toBe(400);
    expect((await w.as(w.aino).call("PUT", "/api/settlement/agreements/pool-a", { validFrom: "2026-01-01", kind: "equal", value: { who: [a, v] } }, { "X-Requested-With": "" })).status).toBe(403);
  });

  it("splits a month by the agreement of each row's day and never rewrites a row", async () => {
    const rows: R[] = [fromAino("2026-09-01", 1000), fromVille("2026-09-02", 1000), ["2026-09-29", -100, "ESIMERKKI OY"], ["2026-09-30", -100, "ESIMERKKI OY"]];
    const w = await both(rows);
    const [a, v] = [`u:${w.aino}`, `u:${w.ville}`] as [string, string];
    const versions = () => Promise.all([w.aino, w.ville].map((id) => w.s.settings.get(`data_version:${id}`)));
    const was = await versions();
    expect((await put(w, w.aino, { validFrom: "2026-01-01", kind: "equal", value: { who: [a, v] } })).status).toBe(200);
    const changed = await put(w, w.ville, { validFrom: "2026-09-30", kind: "share", value: { weights: { [a]: 60, [v]: 40 } } }, "pool-v");
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.agreements.map((r: any) => [r.validFrom, r.kind])).toEqual([["2026-01-01", "equal"], ["2026-09-30", "share"]]);
    expect(changed.body.users.map((u: any) => u.name).sort()).toEqual(["Aino", "Ville"]);

    expect(await versions()).toEqual(was);
    const pool = (await get(w, w.aino))[0]!;
    const m = members(pool);
    // 29.9. is cut 50:50 and 30.9. 60:40: Aino owes 50 + 60, Ville 50 + 40, and each paid 100
    expect([m[a]!.owed, m[v]!.owed]).toEqual([11000, 9000]);
    expect([m[a]!.over, m[v]!.over]).toEqual([-1000, 1000]);
    expect(pool.settlement.lines.filter((l: any) => l.kind === "cost").map((l: any) => l.how)).toEqual(["equal", "share"]);
    expect(pool.settlement.agreements).toEqual([{ accountKey: KEY, validFrom: "2026-01-01" }, { accountKey: KEY, validFrom: "2026-09-30" }]);

    // the day has a row already: refused, and the row stays as it was
    const again = await put(w, w.aino, { validFrom: "2026-09-30", kind: "equal", value: { who: [a, v] } });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("Tälle päivälle on jo sopimus.");
    expect(JSON.parse((await stored(w))[1]!.value)).toEqual({ weights: { [a]: 60, [v]: 40 } });
    // a row from a later day leaves September as it was
    expect((await put(w, w.aino, { validFrom: "2026-10-01", kind: "equal", value: { who: [a] } })).status).toBe(200);
    expect(members((await get(w, w.aino))[0]!)[a]!.owed).toBe(11000);
  });

  it("refuses an agreement that names nobody who uses the pool, and anything of another shape", async () => {
    const w = await both(SEPTEMBER);
    const [a, v] = [`u:${w.aino}`, `u:${w.ville}`] as [string, string];
    const bad = async (body: unknown) => (await put(w, w.aino, body)).status;
    expect(await bad({ validFrom: "2026-01-01", kind: "equal", value: { who: [] } })).toBe(400);
    expect(await bad({ validFrom: "2026-01-01", kind: "equal", value: { who: ["u:nobody"] } })).toBe(400);
    expect(await bad({ validFrom: "2026-01-01", kind: "equal", value: { who: ["u:"] } })).toBe(400);
    expect(await bad({ validFrom: "2026-01-01", kind: "share", value: { weights: { [a]: 0, [v]: 1 } } })).toBe(400);
    expect(await bad({ validFrom: "2026-01-01", kind: "share", value: { weights: { [a]: 1.5 } } })).toBe(400);
    expect(await bad({ validFrom: "2026-01-01", kind: "fixed", value: { cents: { "u:nobody": 100 } } })).toBe(400);
    expect(await bad({ validFrom: "2026-01-01", kind: "fixed", value: { cents: { [a]: 100 }, rest: { kind: "weird" } } })).toBe(400);
    expect(await bad({ validFrom: "2026-02-30", kind: "equal", value: { who: [a] } })).toBe(400);
    expect(await bad({ validFrom: "2026-01-01", kind: "other", value: { who: [a] } })).toBe(400);
    expect(await bad({ validFrom: "2026-01-01", kind: "equal", value: { who: [a] }, setBy: a })).toBe(400);
    expect(await stored(w)).toEqual([]);
    // the near miss: one named user is a row (the one who is left pays all of it)
    expect(await bad({ validFrom: "2026-01-01", kind: "equal", value: { who: [a] } })).toBe(200);
    expect(await stored(w)).toHaveLength(1);
  });

  it("owes a fixed amount in a month that starts under it, and cuts per row from the day a fixed one starts inside the month", async () => {
    const w = await both(SEPTEMBER);
    const [a, v] = [`u:${w.aino}`, `u:${w.ville}`] as [string, string];
    const done = await put(w, w.aino, { validFrom: "2026-09-01", kind: "fixed", value: { cents: { [v]: 30000 }, rest: { kind: "equal" } } });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const pool = (await get(w, w.aino))[0]!;
    const m = members(pool);
    // the month costs 900,00: Ville owes the 300,00 said, Aino the 600,00 left
    expect([m[a]!.owed, m[v]!.owed]).toEqual([60000, 30000]);
    expect([m[a]!.over, m[v]!.over]).toEqual([-3750, 3750]);
    expect(pool.settlement.lines.find((l: any) => l.kind === "fixed")).toMatchObject({ cents: 90000, fixed: { fsum: 30000, c: 90000, r: 60000 } });

    // from the 2nd the month's first day is not covered: it is cut per row by the use as said (equal)
    const late = await both(SEPTEMBER);
    const [la, lv] = [`u:${late.aino}`, `u:${late.ville}`] as [string, string];
    expect((await put(late, late.aino, { validFrom: "2026-09-02", kind: "fixed", value: { cents: { [lv]: 30000 } } })).status).toBe(200);
    const m2 = members((await get(late, late.aino))[0]!);
    expect([m2[la]!.owed, m2[lv]!.owed]).toEqual([45000, 45000]);
  });

  it("names a household member who has no login, and counts the holder as that member from then on", async () => {
    const rows: R[] = [fromAino("2026-09-01", 1000), ["2026-09-05", -800, "ESIMERKKI KIINTEISTÖT OY"]];
    const w = await world({ copies: [{ by: "aino", id: "pool-a", rows }], balance: cents(rows), holder: `${AINO}, ESIMERKKI LIISA`, now: "2026-09-20" });
    const a = `u:${w.aino}`;
    // read on 20.9. while September is open: a month that has closed is kept as it was and would not take the member in
    const before = (await get(w, w.aino))[0]!;
    // two holders who split equally: the holder nobody names has her own half, known, and nothing reads as unknown
    expect(Object.keys(members(before))).toEqual([a, "u:"]);
    expect(before.settlement).toMatchObject({ unknownOwed: 0, unknownPaid: 0 });
    expect(members(before)[a]).toMatchObject({ paid: 80000, owed: 40000, over: 40000 });
    expect(members(before)["u:"]).toMatchObject({ paid: 0, owed: 40000, over: -40000 });

    // only an admin names members
    const plain = w.aino === w.adminId ? w.ville : w.aino;
    expect((await w.as(plain).call("PUT", "/api/admin/household-members", { members: [{ name: "Liisa Esimerkki" }] })).status).toBe(403);
    expect((await w.as(plain).call("GET", "/api/admin/household-members")).status).toBe(403);
    const named = await w.admin.call("PUT", "/api/admin/household-members", { members: [{ name: "Liisa Esimerkki" }] });
    expect(named.status, JSON.stringify(named.body)).toBe(200);
    const id = named.body.members[0].id as string;
    const l = `m:${id}`;

    const after = (await get(w, w.aino))[0]!;
    expect(members(after)[l]).toMatchObject({ paid: 0, owed: 40000, over: -40000 });
    expect(members(after)[a]).toMatchObject({ paid: 80000, owed: 40000, over: 40000 });
    expect(after.settlement).toMatchObject({ unknownOwed: 0, unknownPaid: 0 });
    expect(after.names[l]).toBe("Liisa Esimerkki");
    // she can be named by an agreement of the pool
    const said = await put(w, w.aino, { validFrom: "2026-01-01", kind: "share", value: { weights: { [a]: 3, [l]: 1 } } });
    expect(said.status, JSON.stringify(said.body)).toBe(200);
    expect(members((await get(w, w.aino))[0]!)[l]!.owed).toBe(20000);

    // a rename keeps the member (and so the agreements that name her); a name twice, an unknown id and a stranger's name are refused
    const renamed = await w.admin.call("PUT", "/api/admin/household-members", { members: [{ id, name: "Liisa Esimerkki-Meikalainen" }] });
    expect(renamed.body.members).toEqual([{ id, name: "Liisa Esimerkki-Meikalainen" }]);
    expect((await w.admin.call("PUT", "/api/admin/household-members", { members: [{ name: "Maija" }, { name: "maija" }] })).status).toBe(400);
    expect((await w.admin.call("PUT", "/api/admin/household-members", { members: [{ id: "nope", name: "Maija" }] })).status).toBe(400);
    expect((await w.admin.call("PUT", "/api/admin/household-members", { members: [{ name: "Maija", weight: 5 }] })).status).toBe(400);
    expect((await w.admin.call("GET", "/api/admin/household-members")).body.members).toEqual([{ id, name: "Liisa Esimerkki-Meikalainen" }]);
    // taking her out of the list leaves the agreement row, which is read without her: Aino is the one it names now
    expect((await w.admin.call("PUT", "/api/admin/household-members", { members: [] })).body.members).toEqual([]);
    expect(await stored(w)).toHaveLength(1);
    const gone = (await get(w, w.aino))[0]!;
    expect(members(gone)[a]!.owed).toBe(80000);
    expect(Object.keys(members(gone))).toEqual([a]);
  });

  it("leaves out the bill of a card that is not connected, and counts the same row as a cost when the bank does not call it a card bill", async () => {
    const rows: R[] = [fromAino("2026-09-01", 1000), fromVille("2026-09-02", 1000), ["2026-09-12", -120, "ESIMERKKI KORTTI"]];
    const w = await both(rows);
    await w.db.run("UPDATE transactions SET category = 'card_bill' WHERE amount_cents = -12000");
    const pool = (await get(w, w.aino))[0]!;
    expect(pool.settlement.unknownHolder).toMatchObject([{ cents: 12000 }]);
    expect(pool.settlement.members.map((m: any) => m.owed)).toEqual([0, 0]);
    expect(pool.settlement.members.reduce((n: number, m: any) => n + m.over, 0)).toBe(0);

    const other = await both(rows);
    const shared = (await get(other, other.aino))[0]!;
    expect(shared.settlement.unknownHolder).toEqual([]);
    expect(shared.settlement.members.map((m: any) => m.owed)).toEqual([6000, 6000]);
  });

  it("builds the trace again when an agreement of a card is stored, and not for one of any other account", async () => {
    const w = await both(SEPTEMBER);
    await link(w, w.aino, "card-a", AINO, null, "idn-card", "credit_card");
    const sign = async () => (await ensureTrace(w.s, KEY))!.signature;
    const first = await sign();
    expect(await sign()).toBe(first);
    expect(await w.s.agreements.addAgreement({ accountKey: KEY, validFrom: "2026-01-01", kind: "equal", value: "{}", setBy: null, setAt: "2026-10-01T00:00:00Z" })).toBe(true);
    expect(await sign()).toBe(first);
    expect(await w.s.agreements.addAgreement({ accountKey: "idn-card", validFrom: "2026-01-01", kind: "equal", value: "{}", setBy: null, setAt: "2026-10-01T00:00:00Z" })).toBe(true);
    expect(await sign()).not.toBe(first);
    // the same day twice is left as it was
    expect(await w.s.agreements.addAgreement({ accountKey: "idn-card", validFrom: "2026-01-01", kind: "share", value: "{}", setBy: null, setAt: "2026-10-02T00:00:00Z" })).toBe(false);
  });

  it("reads a stored row that is of a kind nobody knows as no agreement", async () => {
    const w = await both(SEPTEMBER);
    await w.db.run("INSERT INTO account_agreement (account_key, valid_from, kind, value, set_by, set_at) VALUES (?, '2026-01-01', 'terms', '{}', NULL, '2026-10-01T00:00:00Z')", [KEY]);
    await w.db.run("INSERT INTO account_agreement (account_key, valid_from, kind, value, set_by, set_at) VALUES (?, '2026-02-01', 'equal', '[1]', NULL, '2026-10-01T00:00:00Z')", [KEY]);
    expect((await w.as(w.aino).call("GET", "/api/settlement/agreements/pool-a")).body.agreements).toEqual([]);
    expect(members((await get(w, w.aino))[0]!)[`u:${w.aino}`]!.owed).toBe(45000);
  });

  it("carries the agreements and the members in the export and back through an import, to the members who may have them", async () => {
    const w = await both(SEPTEMBER);
    const [a, v] = [`u:${w.aino}`, `u:${w.ville}`] as [string, string];
    expect((await put(w, w.aino, { validFrom: "2026-01-01", kind: "share", value: { weights: { [a]: 2, [v]: 1 } } })).status).toBe(200);
    expect((await w.admin.call("PUT", "/api/admin/household-members", { members: [{ name: "Liisa Esimerkki" }] })).status).toBe(200);
    // asking stores the month that has closed, as the server worked it out with the agreement
    expect(members((await get(w, w.aino))[0]!)[a]!.owed).toBe(60000);
    const [closed] = await w.db.all<{ month: string; closed_on: string; snapshot: string }>("SELECT month, closed_on, snapshot FROM settlement_closed");
    const exportOf = async (c: World["admin"]) => {
      const res = await c.call("POST", "/api/data/export", {});
      expect(res.status).toBe(200);
      return typeof res.body === "string" ? JSON.parse(res.body) : res.body;
    };
    const file = await exportOf(w.as(w.ville));
    expect(file.accountAgreements).toMatchObject([{ account_key: KEY, valid_from: "2026-01-01", kind: "share" }]);
    expect(file.settlementClosed).toMatchObject([{ account_key: KEY, month: MONTH, closed_on: closed!.closed_on, snapshot: closed!.snapshot }]);
    // a member who holds no account of the pool gets none of it
    const cecilia = await w.member("cecilia", "Cecilia");
    expect((await exportOf(cecilia)).accountAgreements).toEqual([]);
    expect((await exportOf(cecilia)).settlementClosed).toEqual([]);

    const adminFile = await exportOf(w.admin);
    expect(adminFile.householdMembers).toMatchObject([{ name: "Liisa Esimerkki" }]);
    await w.db.run("DELETE FROM account_agreement");
    await w.db.run("DELETE FROM household_member");
    await w.db.run("DELETE FROM settlement_closed");
    const send = async (c: World["admin"], f: Record<string, any>) => {
      const started = await c.call("POST", "/api/data/import", { format: f.format, version: f.version, appVersion: f.appVersion, exportedAt: f.exportedAt });
      const id = started.body.session as string;
      expect((await c.call("POST", `/api/data/import/${id}/chunk`, { seq: 0, stores: { accountAgreements: f.accountAgreements, householdMembers: f.householdMembers, settlementClosed: f.settlementClosed } })).status).toBe(200);
      expect((await c.call("POST", `/api/data/import/${id}/check`, {})).status).toBe(200);
      expect((await c.call("POST", `/api/data/import/${id}/commit`, {})).status).toBe(200);
    };
    await send(w.admin, adminFile);
    expect((await stored(w)).map((r) => [r.account_key, r.valid_from, r.kind])).toEqual([[KEY, "2026-01-01", "share"]]);
    expect((await w.s.agreements.members()).map((m) => m.name)).toEqual(["Liisa Esimerkki"]);
    // the month came in the same file as the agreement it was worked out with: this server did not have that agreement when the file was read, so it works the month out differently and takes none
    expect(await w.db.all("SELECT month FROM settlement_closed")).toEqual([]);
    // read again with the agreement in place, the same file brings the month back
    await send(w.admin, adminFile);
    expect(await w.db.all("SELECT month, closed_on, snapshot FROM settlement_closed")).toEqual([{ month: MONTH, closed_on: closed!.closed_on, snapshot: closed!.snapshot }]);
    // restored, the agreement is read again: Aino owes two thirds of the 900,00
    expect(members((await get(w, w.aino))[0]!)[a]!.owed).toBe(60000);
    void IBAN;
    void VILLE;
  });

  it("keeps a month as it first read closed: a later answer reaches the month after as one line and never this one", async () => {
    const STRANGER = "FI7700000000000007";
    const rows: R[] = [fromAino("2026-09-01", 1000), ["2026-09-02", 200, "ESIMERKKI OY", STRANGER], ["2026-09-05", -600, "ESIMERKKI KIINTEISTÖT OY"]];
    const w = await both(rows);
    const say = (owner: string) => w.as(w.aino).call("PUT", "/api/accounts/pool-a/answers", { kind: "in", key: `g:iban:${STRANGER}`, owner });
    const kept = () => w.db.all<{ month: string; closed_on: string; written_at: string; snapshot: string }>("SELECT month, closed_on, written_at, snapshot FROM settlement_closed ORDER BY month");

    // the 200,00 has no payer: the month is open and nothing is kept
    expect((await get(w, w.aino))[0]!.settlement.status.open).toBe(true);
    expect(await kept()).toEqual([]);
    expect((await say(`u:${w.ville}`)).status).toBe(200);
    const first = (await get(w, w.aino))[0]!.settlement;
    expect(first.status).toMatchObject({ open: false, by: "resolved" });
    const was = await kept();
    expect(was).toHaveLength(1);
    expect(was[0]).toMatchObject({ month: MONTH, closed_on: first.status.closedOn });
    expect(JSON.parse(was[0]!.snapshot)).toEqual(first);

    // five days on the answer is changed: September reads as it did, to both members, and the row is not written again
    w.clock.at = new Date("2026-10-14T10:00:00Z");
    expect((await say(`u:${w.aino}`)).status).toBe(200);
    expect((await get(w, w.ville))[0]!.settlement).toEqual(first);
    expect(await kept()).toEqual(was);
    // October is open (nothing is kept for it) and holds the difference once: Aino paid 100,00 more, Ville 100,00 less
    const october = (await get(w, w.aino, "2026-10"))[0]!.settlement;
    expect(october.status.open).toBe(true);
    const late = october.lines.filter((l: any) => l.kind === "late_change");
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ key: MONTH, cents: 0 });
    expect(Object.fromEntries(late[0].paid.map((e: any) => [e.owner, e.cents]))).toEqual({ [`u:${w.aino}`]: 10000, [`u:${w.ville}`]: -10000 });
    expect(await kept()).toEqual(was);
    // the near miss: with no answer changed, the month after has no such line
    const quiet = await both(rows);
    expect((await quiet.as(quiet.aino).call("PUT", "/api/accounts/pool-a/answers", { kind: "in", key: `g:iban:${STRANGER}`, owner: `u:${quiet.ville}` })).status).toBe(200);
    await get(quiet, quiet.aino);
    expect((await get(quiet, quiet.aino, "2026-10"))[0]!.settlement.lines.filter((l: any) => l.kind === "late_change")).toEqual([]);
  });

  it("reads a stored month that is no settlement as no snapshot, and keeps the month that is stored when a second one is written", async () => {
    const w = await both(SEPTEMBER);
    await w.db.run("INSERT INTO settlement_closed (account_key, month, closed_on, snapshot, written_at) VALUES (?, ?, '2026-09-30', '{\"month\":\"2026-09\"}', '2026-10-01T00:00:00Z')", [KEY, MONTH]);
    const pool = (await get(w, w.aino))[0]!;
    expect(pool.settlement.status).toMatchObject({ open: false });
    expect(members(pool)[`u:${w.aino}`]!.owed).toBe(45000);
    expect(await w.db.all("SELECT snapshot FROM settlement_closed")).toEqual([{ snapshot: '{"month":"2026-09"}' }]);
    expect(await w.s.agreements.addClosedMonth({ accountKey: KEY, month: MONTH, closedOn: "2026-09-30", snapshot: "{}", writtenAt: "2026-10-02T00:00:00Z" })).toBe(false);
    // the near miss: another month of the key is kept
    expect(await w.s.agreements.addClosedMonth({ accountKey: KEY, month: "2026-08", closedOn: "2026-08-31", snapshot: "{}", writtenAt: "2026-10-02T00:00:00Z" })).toBe(true);
    expect((await w.s.agreements.closedMonths(KEY)).map((c) => c.month)).toEqual(["2026-08", MONTH]);
  });

  it("takes an agreement for a card the member holds, for the card's holders only, and refuses a fixed one", async () => {
    const w = await both(SEPTEMBER);
    await link(w, w.aino, "card-a", `${AINO}, ${VILLE}`, null, "idn-card", "credit_card");
    await link(w, w.aino, "card-solo", AINO, null, "idn-solo", "credit_card");
    const [a, v] = [`u:${w.aino}`, `u:${w.ville}`] as [string, string];
    const sign = async () => (await ensureTrace(w.s, KEY))!.signature;
    const was = await sign();
    const ok = await put(w, w.aino, { validFrom: "2026-01-01", kind: "equal", value: { who: [a, v] } }, "card-a");
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.users.map((u: any) => u.owner).sort()).toEqual([a, v].sort());
    expect(ok.body.agreements.map((r: any) => [r.validFrom, r.kind])).toEqual([["2026-01-01", "equal"]]);
    expect((await stored(w)).map((r) => [r.account_key, r.valid_from, r.kind])).toEqual([["idn-card", "2026-01-01", "equal"]]);
    expect((await w.as(w.aino).call("GET", "/api/settlement/agreements/card-a")).body.agreements).toHaveLength(1);
    // the bill of a card is whose by the row, so the trace is built again
    expect(await sign()).not.toBe(was);

    // fixed has no meaning on a card; the same row on the pool is taken
    const fixed = await put(w, w.aino, { validFrom: "2026-02-01", kind: "fixed", value: { cents: { [a]: 1000 } } }, "card-a");
    expect(fixed.status).toBe(400);
    expect(fixed.body.error).toBe("Kortille ei voi sopia kiinteää määrää.");
    expect((await put(w, w.aino, { validFrom: "2026-02-01", kind: "fixed", value: { cents: { [a]: 1000 } } })).status).toBe(200);
    // a day that has a row is refused, and the row stays
    const again = await put(w, w.aino, { validFrom: "2026-01-01", kind: "share", value: { weights: { [a]: 1, [v]: 2 } } }, "card-a");
    expect([again.status, again.body.error]).toEqual([400, "Tälle päivälle on jo sopimus."]);
    expect((await stored(w)).filter((r) => r.account_key === "idn-card").map((r) => r.kind)).toEqual(["equal"]);

    // only the users of that card: Ville uses the pool but not the card he does not hold; the card of one holder takes that holder
    const solo = (who: string[]) => put(w, w.aino, { validFrom: "2026-01-01", kind: "equal", value: { who } }, "card-solo");
    expect((await solo([v])).status).toBe(400);
    expect((await solo(["u:nobody"])).status).toBe(400);
    expect((await solo([a])).status).toBe(200);
    // a member who does not see the card, and one who sees it but holds nothing of it, find no such account
    expect((await put(w, w.ville, { validFrom: "2026-03-01", kind: "equal", value: { who: [v] } }, "card-a")).status).toBe(404);
    const cecilia = await w.member("cecilia", "Cecilia");
    expect(await w.s.household.share(w.aino, "card-solo", cecilia.id)).toBe(true);
    expect((await cecilia.call("PUT", "/api/settlement/agreements/card-solo", { validFrom: "2026-03-01", kind: "equal", value: { who: [a] } })).status).toBe(404);
    expect((await cecilia.call("GET", "/api/settlement/agreements/card-solo")).status).toBe(404);
  });

  it("keeps every closed month that has none when any month is asked, oldest first, and no month that is still open", async () => {
    const STRANGER = "FI7700000000000007";
    const rows: R[] = [fromAino("2026-07-01", 1000), ["2026-07-05", -100, "ESIMERKKI KIINTEISTÖT OY"], fromVille("2026-08-01", 500), ["2026-08-05", -100, "ESIMERKKI KIINTEISTÖT OY"], ["2026-09-02", 200, "ESIMERKKI OY", STRANGER], ["2026-09-05", -1500, "ESIMERKKI KIINTEISTÖT OY"]];
    const w = await both(rows);
    const kept = () => w.db.all<{ month: string; snapshot: string }>("SELECT month, snapshot FROM settlement_closed ORDER BY month");
    // asking for the month in progress keeps July and August; September has an unknown payer and stays open
    const october = (await get(w, w.aino, "2026-10"))[0]!.settlement;
    expect((await kept()).map((r) => r.month)).toEqual(["2026-07", "2026-08"]);
    expect(october.status.open).toBe(true);
    expect((await get(w, w.aino, MONTH))[0]!.settlement.status.open).toBe(true);
    const was = await kept();
    // the payer is said: September is kept when it is next read, and the two before it stay as they were
    expect((await w.as(w.aino).call("PUT", "/api/accounts/pool-a/answers", { kind: "in", key: `g:iban:${STRANGER}`, owner: `u:${w.ville}` })).status).toBe(200);
    await get(w, w.ville, "2026-10");
    expect((await kept()).map((r) => r.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect((await kept()).slice(0, 2)).toEqual(was);
    // a month never asked is what a later read of it gives
    expect((await get(w, w.aino, "2026-07"))[0]!.settlement).toEqual(JSON.parse(was[0]!.snapshot));
  });

  it("splits the bill of a card by the card's agreement from the day it stands, through the route", async () => {
    const rows: R[] = [fromAino("2026-09-01", 1000), fromVille("2026-09-02", 1000), ["2026-09-05", -120, "ESIMERKKI KORTTI"]];
    const build = async (agreement: boolean) => {
      const w = await both(rows);
      await link(w, w.aino, "card-a", `${AINO}, ${VILLE}`, null, "idn-card", "credit_card");
      await ingestTransactions(w.s.finance(w.aino), "card-a", [raw(["2026-09-06", 120, "ESIMERKKI KORTTI"])], "enablebanking");
      if (agreement) {
        const said = await put(w, w.aino, { validFrom: "2026-01-01", kind: "share", value: { weights: { [`u:${w.aino}`]: 3, [`u:${w.ville}`]: 1 } } }, "card-a");
        expect(said.status, JSON.stringify(said.body)).toBe(200);
      }
      return w;
    };
    const plain = await build(false);
    const split = await build(true);
    const [a, v] = [`u:${split.aino}`, `u:${split.ville}`] as [string, string];
    const owed = (w: World, pool: any) => [members(pool)[`u:${w.aino}`]!.owed, members(pool)[`u:${w.ville}`]!.owed];
    const without = (await get(plain, plain.aino))[0]!;
    const withIt = (await get(split, split.aino))[0]!;
    // the near miss first: no agreement, two holders: the bill is the pool's, cut by the weights of the card's users (half each)
    expect(owed(plain, without)).toEqual([6000, 6000]);
    // the card's agreement says three to one: 90,00 and 30,00, and what was paid stays
    expect(owed(split, withIt)).toEqual([9000, 3000]);
    expect(withIt.settlement.netCost).toBe(12000);
    expect(members(withIt)[a]!.over + members(withIt)[v]!.over).toBe(0);
    expect(withIt.settlement.lines.find((l: any) => l.kind === "cost")).toMatchObject({ how: "share" });
  });

  const snap = (month: string, closedOn: string, by: "time" | "resolved", over = 0) =>
    JSON.stringify({ month, status: { open: false, closedOn, by }, members: [{ owner: "u:x", paid: 0, owed: over, over: -over }], lines: [], unknownPaidBy: [], unknownOwedBy: [] });
  const row = (month: string, closedOn: string, snapshot: string) => ({ account_key: KEY, month, closed_on: closedOn, snapshot, written_at: "2026-10-01T00:00:00.000Z" });
  /** Sends the stores as the member's own import and answers the counts of each store. */
  const importAs = async (w: World, userId: string, stores: Record<string, unknown[]>) => {
    const c = w.as(userId);
    const head = (await c.call("POST", "/api/data/export", {})).body;
    const f = typeof head === "string" ? JSON.parse(head) : head;
    const id = (await c.call("POST", "/api/data/import", { format: f.format, version: f.version, appVersion: f.appVersion, exportedAt: f.exportedAt })).body.session as string;
    expect((await c.call("POST", `/api/data/import/${id}/chunk`, { seq: 0, stores })).status).toBe(200);
    expect((await c.call("POST", `/api/data/import/${id}/check`, {})).status).toBe(200);
    const done = await c.call("POST", `/api/data/import/${id}/commit`, {});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    return Object.fromEntries((done.body.stores as { key: string }[]).map((x) => [x.key, x])) as unknown as Record<string, { add: number; exists: number; skipped: { reason: string; n: number }[] }>;
  };

  it("takes a closed month in an import only when it equals what this server works out for it, for a pool the member weighs in, and never replaces a stored one", async () => {
    const w = await both(SEPTEMBER);
    const kept = () => w.db.all<{ month: string; closed_on: string; snapshot: string }>("SELECT month, closed_on, snapshot FROM settlement_closed ORDER BY month");
    // asking stores September as the server works it out; the import below brings that month back to an empty table
    await get(w, w.aino);
    const [real] = await kept();
    expect(real!.month).toBe(MONTH);
    await w.db.run("DELETE FROM settlement_closed");
    // today is 9.10.: the review case is an open month (October) and one that has not begun (January), with figures nobody earned
    const figures = (over: number) => JSON.stringify({ ...JSON.parse(real!.snapshot), members: [{ owner: "u:x", paid: 0, owed: over, over: -over }] });
    const made = await importAs(w, w.ville, {
      settlementClosed: [
        // a closed month with the right closing but other figures: the cents differ from this server's
        row(MONTH, real!.closed_on, figures(123456)),
        row("2026-10", "2026-10-31", snap("2026-10", "2026-10-31", "time", 123456)),
        row("2027-01", "2027-01-31", snap("2027-01", "2027-01-31", "time", 123456)),
        // near misses: closed before its last day, a reason core would not give, a closing day that is yet to come
        row("2026-08", "2026-08-15", snap("2026-08", "2026-08-15", "resolved")),
        row("2026-07", "2026-07-31", snap("2026-07", "2026-07-31", "time")),
        row("2026-06", "2026-10-30", snap("2026-06", "2026-10-30", "resolved")),
        // closed by the rules, but a month this server has no settlement of: nothing before the first booked row
        row("2026-05", "2026-05-31", snap("2026-05", "2026-05-31", "resolved")),
        row("2026-04", "2026-07-29", snap("2026-04", "2026-07-29", "time")),
        row("1999-12", "1999-12-31", snap("1999-12", "1999-12-31", "resolved", 123456)),
      ],
    });
    expect(made.settlementClosed).toMatchObject({ add: 0, exists: 0, skipped: [{ reason: "refused", n: 9 }] });
    expect(await kept()).toEqual([]);

    // the month as this server works it out is taken, and is the same text
    const plan = await importAs(w, w.ville, { settlementClosed: [row(MONTH, real!.closed_on, real!.snapshot)] });
    expect(plan.settlementClosed).toMatchObject({ add: 1, exists: 0 });
    expect(await kept()).toEqual([real]);

    // a month that is stored stays as it is, whatever a file says of it; the file's own copy of it is not a new row
    const again = await importAs(w, w.ville, { settlementClosed: [row(MONTH, "2026-10-03", snap(MONTH, "2026-10-03", "resolved", 5))] });
    expect(again.settlementClosed).toMatchObject({ add: 0, skipped: [{ reason: "refused", n: 1 }] });
    expect((await importAs(w, w.ville, { settlementClosed: [row(MONTH, real!.closed_on, real!.snapshot)] })).settlementClosed).toMatchObject({ add: 0, exists: 1 });
    expect(await kept()).toEqual([real]);

    // a member whose weight in the pool is nothing brings no month of it, though it is the very month this server has; weighed again, the same file is taken
    const w0 = await both(SEPTEMBER);
    await get(w0, w0.aino);
    const [own] = await w0.db.all<{ month: string; closed_on: string; snapshot: string }>("SELECT month, closed_on, snapshot FROM settlement_closed");
    await w0.db.run("DELETE FROM settlement_closed");
    await w0.s.household.setUse(KEY, [{ userId: w0.aino, weight: 1 }, { userId: w0.ville, weight: 0 }], w0.aino, "2026-10-01T00:00:00.000Z");
    const none = await importAs(w0, w0.ville, { settlementClosed: [row(MONTH, own!.closed_on, own!.snapshot)] });
    expect(none.settlementClosed).toMatchObject({ add: 0, skipped: [{ reason: "refused", n: 1 }] });
    expect(await w0.db.all("SELECT month FROM settlement_closed")).toEqual([]);
    await w0.s.household.setUse(KEY, [{ userId: w0.aino, weight: 1 }, { userId: w0.ville, weight: 1 }], w0.aino, "2026-10-01T00:00:00.000Z");
    expect((await importAs(w0, w0.ville, { settlementClosed: [row(MONTH, own!.closed_on, own!.snapshot)] })).settlementClosed).toMatchObject({ add: 1 });
  });

  it("gives the export of agreements and months of a pool to the members weighted in it and to nobody who only sees it", async () => {
    const w = await both(SEPTEMBER);
    const [a, v] = [`u:${w.aino}`, `u:${w.ville}`] as [string, string];
    expect((await put(w, w.aino, { validFrom: "2026-01-01", kind: "share", value: { weights: { [a]: 2, [v]: 1 } } })).status).toBe(200);
    await get(w, w.aino);
    const exportOf = async (c: World["admin"]) => {
      const res = await c.call("POST", "/api/data/export", {});
      return (typeof res.body === "string" ? JSON.parse(res.body) : res.body) as { accountAgreements: unknown[]; settlementClosed: unknown[] };
    };
    const cecilia = await w.member("cecilia", "Cecilia");
    expect(await w.s.household.share(w.aino, "pool-a", cecilia.id)).toBe(true);
    // she sees the account and is no user of the pool: the routes say nothing of it, and so does the export
    expect((await cecilia.call("GET", "/api/settlement/agreements/pool-a")).status).toBe(404);
    const hers = await exportOf(cecilia);
    expect([hers.accountAgreements, hers.settlementClosed]).toEqual([[], []]);
    // the near miss: Ville, weighted in it, has both
    const his = await exportOf(w.as(w.ville));
    expect([his.accountAgreements.length, his.settlementClosed.length]).toEqual([1, 1]);
    // weighed at nothing, he has none, as the routes give him no pool
    await w.s.household.setUse(KEY, [{ userId: w.aino, weight: 1 }, { userId: w.ville, weight: 0 }], w.aino, "2026-10-01T00:00:00.000Z");
    const none = await exportOf(w.as(w.ville));
    expect([none.accountAgreements, none.settlementClosed]).toEqual([[], []]);
    expect((await w.as(w.ville).call("GET", "/api/settlement/agreements/pool-v")).status).toBe(404);
  });

  it("keeps no month from before the pool's first booked row, however a month is asked", async () => {
    const w = await both(SEPTEMBER);
    const kept = async () => (await w.db.all<{ month: string }>("SELECT month FROM settlement_closed ORDER BY month")).map((r) => r.month);
    for (const month of ["1999-12", "2001-01", "2026-08"]) expect((await w.as(w.aino).call("GET", `/api/settlement?month=${month}`)).status).toBe(200);
    // September, the month of the first row, is the one kept; the months before it read as empty and are not written
    expect(await kept()).toEqual([MONTH]);
    expect(members((await get(w, w.aino, "2026-08"))[0]!)[`u:${w.aino}`]).toMatchObject({ paid: 0, owed: 0 });
  });

  it("puts an income agreement in force only when every user it names has put it, and shows it waiting to those users only", async () => {
    // read on 20.9., while September is open: a month that has closed is kept as it was and takes no new row
    const w = await both(SEPTEMBER, { now: "2026-09-20" });
    const [a, v] = [`u:${w.aino}`, `u:${w.ville}`] as [string, string];
    // a third user of the pool, who the income row does not name
    const cecilia = await w.member("cecilia", "Cecilia");
    await link(w, cecilia.id, "pool-c", `${AINO}, ${VILLE}, LEHTINEN CECILIA`, IBAN.pool, KEY);
    const how = async (id: string) => [...new Set((await get(w, id))[0]!.settlement.lines.filter((l: any) => l.kind === "cost").map((l: any) => l.how))];
    expect((await put(w, w.aino, { validFrom: "2025-01-01", kind: "share", value: { weights: { [a]: 2, [v]: 1 } } })).status).toBe(200);
    expect(await how(w.aino)).toEqual(["share"]);

    const mine = await put(w, w.aino, { validFrom: "2026-01-01", kind: "income", value: { who: [a, v] } });
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    // one partner's PUT changes nothing: the earlier row holds, in the answer and in the trace
    expect(mine.body.agreements.map((r: any) => [r.validFrom, r.kind, r.pending?.waiting ?? null])).toEqual([["2025-01-01", "share", null], ["2026-01-01", "income", [v]]]);
    expect(mine.body.agreements[1].value).toEqual({ who: [a, v] });
    expect(await how(w.aino)).toEqual(["share"]);
    expect((await get(w, w.aino))[0]!.settlement.agreements).toEqual([{ accountKey: KEY, validFrom: "2025-01-01" }]);
    // the user it names sees it waiting; the user it does not name sees only the row in force
    const seen = async (c: World["admin"]) => (await c.call("GET", "/api/settlement/agreements/pool-c")).body;
    const theirs = (await w.as(w.ville).call("GET", "/api/settlement/agreements/pool-v")).body.agreements.map((r: any) => r.kind);
    expect(theirs).toEqual(["share", "income"]);
    const third = await seen(cecilia);
    expect(third.users).toHaveLength(3);
    expect(third.agreements.map((r: any) => r.kind)).toEqual(["share"]);
    // she cannot put it either: she is not named, and the day has a row
    expect((await cecilia.call("PUT", "/api/settlement/agreements/pool-c", { validFrom: "2026-01-01", kind: "income", value: { who: [a, v] } })).status).toBe(400);
    expect((await w.as(w.ville).call("GET", "/api/settlement/agreements/pool-v")).body.agreements[1].pending.confirmed).toEqual([a]);
    // the same user putting it again changes nothing
    expect((await put(w, w.aino, { validFrom: "2026-01-01", kind: "income", value: { who: [a, v] } })).status).toBe(200);
    expect((await w.as(w.ville).call("GET", "/api/settlement/agreements/pool-v")).body.agreements[1].pending.confirmed).toEqual([a]);
    // another row of that day, or the same row naming others, is no confirmation
    expect((await put(w, w.ville, { validFrom: "2026-01-01", kind: "income", value: { who: [v] } }, "pool-v")).status).toBe(400);
    expect((await put(w, w.ville, { validFrom: "2026-01-01", kind: "equal", value: { who: [a, v] } }, "pool-v")).status).toBe(400);
    expect(await how(w.aino)).toEqual(["share"]);

    // the second partner puts the same row: it stands from its day, and the third user sees it as any other
    const done = await put(w, w.ville, { validFrom: "2026-01-01", kind: "income", value: { who: [a, v] } }, "pool-v");
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.agreements[1]).toMatchObject({ kind: "income", value: { who: [a, v] } });
    expect(done.body.agreements[1].pending).toBeUndefined();
    expect(await how(w.aino)).toEqual(["income"]);
    expect((await get(w, w.aino))[0]!.settlement.agreements).toEqual([{ accountKey: KEY, validFrom: "2026-01-01" }]);
    expect((await seen(cecilia)).agreements.map((r: any) => r.kind)).toEqual(["share", "income"]);
    // a row naming one user alone is that user's to put
    const solo = await put(w, w.aino, { validFrom: "2026-02-01", kind: "income", value: { who: [a] } });
    expect(solo.body.agreements.at(-1).pending).toBeUndefined();
  });

  it("takes an income row from an import as put by the importing user alone", async () => {
    const w = await both(SEPTEMBER);
    const [a, v] = [`u:${w.aino}`, `u:${w.ville}`] as [string, string];
    const plan = await importAs(w, w.ville, { accountAgreements: [{ account_key: KEY, valid_from: "2026-01-01", kind: "income", value: JSON.stringify({ who: [a, v], confirmed: [a, v] }), set_by: w.ville, set_at: "2026-10-01T00:00:00.000Z" }] });
    expect(plan.accountAgreements).toMatchObject({ add: 1 });
    expect((await stored(w)).map((r) => JSON.parse(r.value))).toEqual([{ who: [a, v], confirmed: [v] }]);
    expect((await w.as(w.ville).call("GET", "/api/settlement/agreements/pool-v")).body.agreements[0].pending.waiting).toEqual([a]);
    expect((await get(w, w.aino))[0]!.settlement.agreements).toEqual([]);
  });

  it("holds a fixed agreement whose remainder follows income back until every user of the pool has put it", async () => {
    const w = await both(SEPTEMBER, { now: "2026-09-20" });
    const [a, v] = [`u:${w.aino}`, `u:${w.ville}`] as [string, string];
    const fixed = (rest: unknown, cents = 10000) => ({ validFrom: "2026-01-01", kind: "fixed", value: { cents: { [a]: cents }, rest } });
    // one partner's PUT: kept and shown waiting, with no trace of who has put it; the sums do not read it
    const mine = await put(w, w.aino, fixed({ kind: "income" }));
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.agreements).toMatchObject([{ kind: "fixed", value: { cents: { [a]: 10000 }, rest: { kind: "income" } }, pending: { confirmed: [a], waiting: [v] } }]);
    expect(mine.body.agreements[0].value.who).toBeUndefined();
    expect((await get(w, w.aino))[0]!.settlement.agreements).toEqual([]);
    expect((await stored(w)).map((r) => JSON.parse(r.value).who)).toEqual([[a, v]]);
    // the same day with other figures, or with another remainder, is no confirmation
    expect((await put(w, w.ville, fixed({ kind: "income" }, 20000), "pool-v")).status).toBe(400);
    expect((await put(w, w.ville, fixed({ kind: "equal" }), "pool-v")).status).toBe(400);
    expect((await get(w, w.aino))[0]!.settlement.agreements).toEqual([]);
    // the second user puts the same row: in force from its day
    const done = await put(w, w.ville, fixed({ kind: "income" }), "pool-v");
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.agreements[0].pending).toBeUndefined();
    expect(done.body.agreements[0].value).toEqual({ cents: { [a]: 10000 }, rest: { kind: "income" } });
    expect((await get(w, w.aino))[0]!.settlement.agreements).toEqual([{ accountKey: KEY, validFrom: "2026-01-01" }]);
    // a fixed row whose remainder is equal shows no ratio and stands at once
    const plain = await put(w, w.aino, { ...fixed({ kind: "equal" }), validFrom: "2026-02-01" });
    expect(plain.body.agreements.at(-1).pending).toBeUndefined();
  });

  it("keeps an income row whose list of users holds a value that is no name pending, in the sums and from an import", async () => {
    const w = await both(SEPTEMBER);
    const [a, v] = [`u:${w.aino}`, `u:${w.ville}`] as [string, string];
    // the review case: a number among the names, and no list of who has put it; core would read who as [a, v]
    const bad = JSON.stringify({ who: [a, v, 0] });
    const plan = await importAs(w, w.ville, { accountAgreements: [{ account_key: KEY, valid_from: "2026-01-01", kind: "income", value: bad, set_by: w.ville, set_at: "2026-10-01T00:00:00.000Z" }] });
    expect(plan.accountAgreements).toMatchObject({ add: 0, skipped: [{ reason: "refused", n: 1 }] });
    expect(await stored(w)).toEqual([]);
    // the same row stored by other means is still waiting for both: nobody has put it, and the earlier use holds
    await w.db.run("INSERT INTO account_agreement (account_key, valid_from, kind, value, set_by, set_at) VALUES (?, '2026-01-01', 'income', ?, NULL, '2026-10-01T00:00:00Z')", [KEY, bad]);
    expect((await get(w, w.aino))[0]!.settlement.agreements).toEqual([]);
    expect((await w.as(w.ville).call("GET", "/api/settlement/agreements/pool-v")).body.agreements[0].pending).toMatchObject({ confirmed: [], waiting: [a, v] });
    // the near miss, a list of names only, is taken as put by the importer
    await w.db.run("DELETE FROM account_agreement");
    const ok = await importAs(w, w.ville, { accountAgreements: [{ account_key: KEY, valid_from: "2026-01-01", kind: "income", value: JSON.stringify({ who: [a, v] }), set_by: w.ville, set_at: "2026-10-01T00:00:00.000Z" }] });
    expect(ok.accountAgreements).toMatchObject({ add: 1 });
    expect((await stored(w)).map((r) => JSON.parse(r.value))).toEqual([{ who: [a, v], confirmed: [v] }]);
  });

  it("gives a waiting income row in the export only to the users it names or who have put it, and names no user who weighs nothing", async () => {
    const w = await both(SEPTEMBER, { now: "2026-09-20" });
    const [a, v] = [`u:${w.aino}`, `u:${w.ville}`] as [string, string];
    const cecilia = await w.member("cecilia", "Cecilia");
    await link(w, cecilia.id, "pool-c", `${AINO}, ${VILLE}, LEHTINEN CECILIA`, IBAN.pool, KEY);
    const exported = async (c: World["admin"]) => {
      const res = await c.call("POST", "/api/data/export", {});
      expect(res.status).toBe(200);
      return ((typeof res.body === "string" ? JSON.parse(res.body) : res.body).accountAgreements as { kind: string }[]).map((r) => r.kind);
    };
    expect((await put(w, w.aino, { validFrom: "2025-01-01", kind: "share", value: { weights: { [a]: 2, [v]: 1 } } })).status).toBe(200);
    expect((await put(w, w.aino, { validFrom: "2026-01-01", kind: "income", value: { who: [a, v] } })).status).toBe(200);
    // the user who put it and the user it names have it; the third user of the pool has the row in force only
    expect(await exported(w.as(w.aino))).toEqual(["share", "income"]);
    expect(await exported(w.as(w.ville))).toEqual(["share", "income"]);
    expect(await exported(cecilia)).toEqual(["share"]);
    expect((await put(w, w.ville, { validFrom: "2026-01-01", kind: "income", value: { who: [a, v] } }, "pool-v")).status).toBe(200);
    expect(await exported(cecilia)).toEqual(["share", "income"]);
    // a pool user who weighs nothing is no name on the page of the others
    await w.s.household.setUse(KEY, [{ userId: w.aino, weight: 1 }, { userId: w.ville, weight: 1 }, { userId: cecilia.id, weight: 0 }], w.aino, "2026-10-01T00:00:00.000Z");
    const names = (await w.as(w.aino).call("GET", `/api/settlement?month=${MONTH}`)).body.pools[0].names as Record<string, string>;
    expect(Object.keys(names).sort()).toEqual([a, v].sort());
  });

  it("lets a user it names decline a waiting income row and the one who put it withdraw it, and nobody else", async () => {
    const w = await both(SEPTEMBER, { now: "2026-09-20" });
    const [a, v] = [`u:${w.aino}`, `u:${w.ville}`] as [string, string];
    const cecilia = await w.member("cecilia", "Cecilia");
    await link(w, cecilia.id, "pool-c", `${AINO}, ${VILLE}, LEHTINEN CECILIA`, IBAN.pool, KEY);
    const income = { validFrom: "2026-01-01", kind: "income", value: { who: [a, v] } };
    const day = (id: string) => `/api/settlement/agreements/${id}/2026-01-01`;
    const rows = async (c: World["admin"], id: string) => (await c.call("GET", `/api/settlement/agreements/${id}`)).body.agreements.map((r: any) => [r.kind, r.pending?.mayRemove ?? null]);

    expect((await put(w, w.aino, { validFrom: "2025-01-01", kind: "share", value: { weights: { [a]: 2, [v]: 1 } } })).status).toBe(200);
    expect((await put(w, w.aino, income)).status).toBe(200);
    expect(await rows(w.as(w.aino), "pool-a")).toEqual([["share", null], ["income", "withdraw"]]);
    expect(await rows(w.as(w.ville), "pool-v")).toEqual([["share", null], ["income", "decline"]]);
    // a user it does not name does not see it, so there is nothing for her to take back
    expect((await cecilia.call("DELETE", day("pool-c"))).status).toBe(404);
    // the row in force of another day is no pending row
    expect((await w.as(w.ville).call("DELETE", "/api/settlement/agreements/pool-v/2025-01-01")).status).toBe(404);
    // the named user declines: only that row goes, and the day is free again
    const declined = await w.as(w.ville).call("DELETE", day("pool-v"));
    expect(declined.status, JSON.stringify(declined.body)).toBe(200);
    expect(declined.body.agreements.map((r: any) => r.kind)).toEqual(["share"]);
    expect((await stored(w)).map((r) => r.valid_from)).toEqual(["2025-01-01"]);
    expect((await w.as(w.ville).call("DELETE", day("pool-v"))).status).toBe(404);
    // the one who put it first takes it back
    expect((await put(w, w.aino, income)).status).toBe(200);
    const taken = await w.as(w.aino).call("DELETE", day("pool-a"));
    expect(taken.status, JSON.stringify(taken.body)).toBe(200);
    expect(taken.body.agreements.map((r: any) => r.kind)).toEqual(["share"]);
    // a row both have put stands, and neither can remove it
    expect((await put(w, w.aino, income)).status).toBe(200);
    expect((await put(w, w.ville, income, "pool-v")).status).toBe(200);
    expect((await w.as(w.ville).call("DELETE", day("pool-v"))).status).toBe(404);
    expect((await w.as(w.aino).call("DELETE", day("pool-a"))).status).toBe(404);
    expect((await stored(w)).map((r) => r.valid_from)).toEqual(["2025-01-01", "2026-01-01"]);
    // a user it names who has put it but did not put it first has no say over it: three users, the third not yet
    expect((await put(w, w.aino, { validFrom: "2026-03-01", kind: "income", value: { who: [a, v, `u:${cecilia.id}`] } })).status).toBe(200);
    expect((await put(w, w.ville, { validFrom: "2026-03-01", kind: "income", value: { who: [a, v, `u:${cecilia.id}`] } }, "pool-v")).status).toBe(200);
    const second = await w.as(w.ville).call("DELETE", "/api/settlement/agreements/pool-v/2026-03-01");
    expect(second.status).toBe(400);
    expect((await stored(w)).map((r) => r.valid_from)).toContain("2026-03-01");
    expect((await cecilia.call("DELETE", "/api/settlement/agreements/pool-c/2026-03-01")).status).toBe(200);
  });

  it("takes a fixed row with an income remainder from an import as put by the importing user alone", async () => {
    const w = await both(SEPTEMBER);
    const [a, v] = [`u:${w.aino}`, `u:${w.ville}`] as [string, string];
    const value = JSON.stringify({ cents: { [a]: 10000 }, rest: { kind: "income" }, who: [v], confirmed: [a, v] });
    expect((await importAs(w, w.ville, { accountAgreements: [{ account_key: KEY, valid_from: "2026-01-01", kind: "fixed", value, set_by: w.ville, set_at: "2026-10-01T00:00:00.000Z" }] })).accountAgreements).toMatchObject({ add: 1 });
    expect((await w.as(w.ville).call("GET", "/api/settlement/agreements/pool-v")).body.agreements[0].pending.waiting).toEqual([a]);
    expect((await get(w, w.aino))[0]!.settlement.agreements).toEqual([]);
  });

  it("names only the users of the pool, and flags a member who is gone and still on an old row", async () => {
    const rows: R[] = [fromAino("2026-09-01", 1000), ["2026-09-05", -800, "ESIMERKKI KIINTEISTÖT OY"]];
    const w = await world({ copies: [{ by: "aino", id: "pool-a", rows }], balance: cents(rows), holder: `${AINO}, ESIMERKKI LIISA, ${VILLE}` });
    const named = await w.admin.call("PUT", "/api/admin/household-members", { members: [{ name: "Liisa Esimerkki" }, { name: "Toinen Esimerkki" }] });
    const idOf = (name: string) => `m:${named.body.members.find((m: any) => m.name === name).id}`;
    const [liisa, other] = [idOf("Liisa Esimerkki"), idOf("Toinen Esimerkki")] as [string, string];
    const pool = (await get(w, w.aino))[0]! as unknown as { names: Record<string, string>; removed: string[]; settlement: any };
    expect(pool.settlement.status.open).toBe(false);
    expect(pool.settlement.members.map((m: any) => m.owner)).toContain(liisa);
    // the household has Liisa, Toinen and Ville: the pool names the ones it uses and not Toinen
    expect(Object.values(pool.names).sort()).toEqual(["Aino", "Liisa Esimerkki", "Ville"]);
    expect(pool.names[other]).toBeUndefined();
    expect(pool.removed).toEqual([]);
    expect((await put(w, w.aino, { validFrom: "2026-10-01", kind: "equal", value: { who: [liisa, `u:${w.aino}`] } })).status).toBe(200);

    // she goes from the list: September, kept as it closed, still names her, now with no name; so does the row that names her
    expect((await w.admin.call("PUT", "/api/admin/household-members", { members: [{ id: other.slice(2), name: "Toinen Esimerkki" }] })).status).toBe(200);
    const gone = (await get(w, w.aino))[0]! as unknown as typeof pool;
    expect(gone.settlement.members.map((m: any) => m.owner)).toContain(liisa);
    expect(gone.names[liisa]).toBeUndefined();
    expect(gone.removed).toEqual([liisa]);
    expect(Object.values(gone.names).sort()).toEqual(["Aino", "Ville"]);
    const rowsOf = (await w.as(w.aino).call("GET", "/api/settlement/agreements/pool-a")).body;
    expect(rowsOf.removed).toEqual([liisa]);
    expect(rowsOf.agreements[0].value).toEqual({ who: [liisa, `u:${w.aino}`] });
  });
});
