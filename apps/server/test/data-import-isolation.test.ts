/** "Tuo tiedot": a file never writes into, or shows anything of, the data of another user of the instance. */
import { describe, expect, it } from "vitest";
import { setupApp } from "./helpers.ts";

const AT = "2026-10-01T00:00:00Z";
const HEAD = { format: "omatalous-export", version: 1, appVersion: "x", exportedAt: AT };
type Res = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = { call: (m: string, p: string, b?: unknown) => Promise<Res> };
type Stores = Record<string, unknown[]>;

/** The page's part: the head, then each store's rows in one chunk of their own (or the first refusal). */
async function send(who: Who, stores: Stores, chunks: Stores[] = [stores]) {
  const st = await who.call("POST", "/api/data/import", HEAD);
  expect(st.status).toBe(200);
  const id = st.body.session as string;
  let seq = 0;
  for (const chunk of chunks) {
    for (const [k, rows] of Object.entries(chunk)) {
      const r = await who.call("POST", `/api/data/import/${id}/chunk`, { seq: seq++, stores: { [k]: rows } });
      if (r.status !== 200) return { id, refused: r };
    }
  }
  return { id, refused: null };
}
async function upload(who: Who, stores: Stores) {
  const r = await send(who, stores);
  expect(r.refused?.body).toBeUndefined();
  return r.id;
}
const check = async (who: Who, id: string) => {
  const r = await who.call("POST", `/api/data/import/${id}/check`, {});
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};
const commit = async (who: Who, id: string) => {
  const r = await who.call("POST", `/api/data/import/${id}/commit`, {});
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};
const countsOf = (plan: any, key: string) => plan.stores.find((s: { key: string }) => s.key === key); // eslint-disable-line @typescript-eslint/no-explicit-any

const acc = (id: string, user: string, identity: string | null, iban: string | null = null) => ({ id, user_id: user, provider: "csv", identity, name: "Oma tili", iban, currency: "EUR", type: "checking", created_at: AT });
const tx = (id: string, account: string, merchant: string, over: Record<string, unknown> = {}) => ({
  id, user_id: "K1", account_id: account, booking_date: "2026-09-30", amount_cents: -1250, currency: "EUR", status: "booked", counterparty: merchant, description: null, merchant,
  category: "other", category_source: "default", is_transfer: 0, source: "csv", imported_at: AT, ...over,
});
const bal = (key: string, day: string, cents: number) => ({ account_key: key, day, type: "closingBooked", cents, fetched_at: AT, source: "csv" });
const kaisa = { id: "K1", username: "kaisa", display_name: "Kaisa", role: "member", created_at: AT };

/** An instance with a member kaisa, and the admin's account (identity, id and IBAN as given) with a balance under its key. */
async function world(aino: { identity: string | null; iban?: string; id?: string } | null) {
  const a = await setupApp();
  const k = await a.member("kaisa");
  if (aino) {
    const id = aino.id ?? "aino-acc";
    await a.db.run("INSERT INTO accounts (id, user_id, provider, identity, name, iban, currency, type, created_at) VALUES (?, ?, 'csv', ?, 'Ainon tili', ?, 'EUR', 'checking', ?)", [id, a.adminId, aino.identity, aino.iban ?? null, AT]);
    await a.db.run("INSERT INTO account_balances (account_key, day, type, cents, fetched_at, source) VALUES (?, '2026-09-30', 'closingBooked', 5, ?, 'bank')", [aino.identity ?? id, AT]);
  }
  return { a, k };
}
const balances = (a: Awaited<ReturnType<typeof world>>["a"], key: string) => a.db.all<{ day: string; cents: number }>("SELECT day, cents FROM account_balances WHERE account_key = ? ORDER BY day", [key]);

describe("an account of the file that another user of the instance holds", () => {
  const file = (key: string): Stores => ({
    users: [kaisa],
    accounts: [acc("kacc", "K1", key)],
    accountBalances: [bal(key, "2026-09-30", 1), bal(key, "2026-10-02", 99999999)],
    answers: [{ account_key: key, kind: "in", key: "PROBE", owner: "u:K1", said_by: "K1", said_at: AT }],
  });

  it("is added without an identity, keeps its rows under its own key, and the dry run says what it would with no other user", async () => {
    const withAino = await world({ identity: "aino-ident" });
    const without = await world(null);
    const dry = await check(withAino.k, await upload(withAino.k, file("aino-ident")));
    const alone = await check(without.k, await upload(without.k, file("aino-ident")));
    expect(dry.stores).toEqual(alone.stores);
    expect(dry.otherUsers).toEqual(alone.otherUsers);
    expect(countsOf(dry, "accountBalances")).toMatchObject({ add: 2, exists: 0 });
    await commit(withAino.k, (await send(withAino.k, file("aino-ident"))).id);
    const mine = await withAino.a.db.all<{ id: string; identity: string | null }>("SELECT id, identity FROM accounts WHERE user_id = ?", [withAino.k.id]);
    expect(mine).toEqual([{ id: "kacc", identity: null }]);
    expect(await balances(withAino.a, "aino-ident")).toEqual([{ day: "2026-09-30", cents: 5 }]);
    expect(await balances(withAino.a, "kacc")).toEqual([{ day: "2026-09-30", cents: 1 }, { day: "2026-10-02", cents: 99999999 }]);
    expect(await withAino.a.db.all("SELECT key FROM owner_answer WHERE account_key = 'aino-ident'")).toEqual([]);
    expect(await withAino.a.db.all("SELECT key FROM owner_answer WHERE account_key = 'kacc'")).toEqual([{ key: "PROBE" }]);
  });

  it("is added without an identity when the other user holds its IBAN, or its identity is the key of their csv account", async () => {
    const byIban = await world({ identity: "aino-ident", iban: "FI2112345600000785" });
    await commit(byIban.k, await upload(byIban.k, { ...file("own-ident"), accounts: [acc("kacc", "K1", "own-ident", "fi21 1234 5600 0007 85")] }));
    expect(await byIban.a.db.all("SELECT id, identity FROM accounts WHERE user_id = ?", [byIban.k.id])).toEqual([{ id: "kacc", identity: null }]);
    expect(await balances(byIban.a, "own-ident")).toEqual([]);
    expect(await balances(byIban.a, "kacc")).toHaveLength(2);

    const byKey = await world({ identity: null, id: "aino-csv" });
    await commit(byKey.k, await upload(byKey.k, file("aino-csv")));
    expect(await byKey.a.db.all("SELECT identity FROM accounts WHERE user_id = ?", [byKey.k.id])).toEqual([{ identity: null }]);
    expect(await balances(byKey.a, "aino-csv")).toEqual([{ day: "2026-09-30", cents: 5 }]);
  });

  it("gets a fresh key when its own id is the key of the other user's account", async () => {
    const w = await world({ identity: "aino-ident" });
    const stores: Stores = { users: [kaisa], accounts: [acc("aino-ident", "K1", null)], accountBalances: [bal("aino-ident", "2026-10-02", 7)] };
    await commit(w.k, await upload(w.k, stores));
    const mine = await w.a.db.all<{ id: string }>("SELECT id FROM accounts WHERE user_id = ?", [w.k.id]);
    expect(mine[0]!.id).not.toBe("aino-ident");
    expect(await balances(w.a, "aino-ident")).toEqual([{ day: "2026-09-30", cents: 5 }]);
    expect(await balances(w.a, mine[0]!.id)).toEqual([{ day: "2026-10-02", cents: 7 }]);
  });

  it("near miss: an identity nobody else holds is kept, and one the importer holds too is joined", async () => {
    const w = await world({ identity: "joint-ident" });
    await w.a.db.run("INSERT INTO accounts (id, user_id, provider, identity, name, currency, type, created_at) VALUES ('k-joint', ?, 'csv', 'joint-ident', 'Yhteinen', 'EUR', 'checking', ?)", [w.k.id, AT]);
    const plan = await commit(w.k, await upload(w.k, file("joint-ident")));
    expect(countsOf(plan, "accounts")).toMatchObject({ add: 0, exists: 1 });
    expect(await balances(w.a, "joint-ident")).toEqual([{ day: "2026-09-30", cents: 5 }, { day: "2026-10-02", cents: 99999999 }]);
    const free = await world(null);
    await commit(free.k, await upload(free.k, file("free-ident")));
    expect(await free.a.db.all("SELECT identity FROM accounts WHERE user_id = ?", [free.k.id])).toEqual([{ identity: "free-ident" }]);
  });
});

describe("the owner of an answer or a part is a person of this instance", () => {
  it("u:<id> is mapped through the file's users to the importer; an unknown id, a local user's id and another person become the importer; u: stays", async () => {
    const a = await setupApp();
    const ka = await a.member("kaisa");
    const b = await setupApp();
    const kb = await b.member("kaisa");
    const stores: Stores = {
      users: [{ ...kaisa, id: ka.id }, { id: "U-AINO", username: "aino", display_name: "Aino", role: "admin", created_at: AT }],
      accounts: [{ ...acc("kacc", ka.id, "kaisa-ident"), user_id: ka.id }],
      transactions: [tx("t1", "kacc", "ESIMERKKI OY", { user_id: ka.id })],
      answers: ["SALARY", "RENT", "ADMIN", "NONE", "HOLDER"].map((key, i) => ({
        account_key: "kaisa-ident", kind: "in", key, said_by: ka.id, said_at: AT, owner: [`u:${ka.id}`, "u:U-AINO", `u:${b.adminId}`, "u:nobody", "u:"][i],
      })),
      parts: [`u:${ka.id}`, `u:${b.adminId}`, "u:"].map((owner, i) => ({ tx_id: "t1", owner, kind: "spend", grp: `g${i}`, cents: 100, passed: 0 })),
    };
    const id = await upload(kb, stores);
    const dry = await check(kb, id);
    expect(countsOf(dry, "answers")).toMatchObject({ add: 5 });
    await commit(kb, id);
    const owners = await b.db.all<{ key: string; owner: string }>("SELECT key, owner FROM owner_answer ORDER BY key");
    expect(owners).toEqual([
      { key: "ADMIN", owner: `u:${kb.id}` }, { key: "HOLDER", owner: "u:" }, { key: "NONE", owner: `u:${kb.id}` }, { key: "RENT", owner: `u:${kb.id}` }, { key: "SALARY", owner: `u:${kb.id}` },
    ]);
    const parts = await b.db.all<{ owner: string }>("SELECT owner FROM tx_part");
    expect(parts.length).toBeGreaterThan(0);
    for (const p of parts) expect([`u:${kb.id}`, "u:"]).toContain(p.owner);
    expect(await b.db.first("SELECT COUNT(*) AS n FROM owner_answer WHERE owner IN (?, ?)", [`u:${ka.id}`, `u:${b.adminId}`])).toEqual({ n: 0 });
  });
});

describe("what only the household's admin writes", () => {
  const stores = (): Stores => ({
    users: [kaisa],
    householdMembers: [{ id: "hm1", name: "Lapsi", weight: 1, created_at: AT }],
    valuedAssets: [{ id: "aino-asset", kind: "home", name: "Talo", day: "2026-10-01", cents: 5 }],
    payerRoles: [
      { scope: "household", user_id: null, counterparty_key: "ESIMERKKI", role: "sales", answered_by: null, answered_at: AT },
      { scope: "member", user_id: "K1", counterparty_key: "ESIMERKKI2", role: "sales", answered_by: "K1", answered_at: AT },
    ],
  });
  const seed = (a: Awaited<ReturnType<typeof world>>["a"]) => a.db.run("INSERT INTO valued_asset (id, kind, name, day, cents) VALUES ('aino-asset', 'car', 'Auto', '2026-09-01', 100)");

  it("a member's file adds no household member, asset or household payer role, and the dry run counts them as not imported", async () => {
    const w = await world(null);
    await seed(w.a);
    const id = await upload(w.k, stores());
    const dry = await check(w.k, id);
    for (const key of ["householdMembers", "valuedAssets"]) expect(countsOf(dry, key)).toMatchObject({ add: 0, exists: 0, skipped: [{ reason: "household", n: 1 }] });
    expect(countsOf(dry, "payerRoles")).toMatchObject({ add: 1, skipped: [{ reason: "household", n: 1 }] });
    await commit(w.k, id);
    expect(await w.a.db.first("SELECT COUNT(*) AS n FROM household_member")).toEqual({ n: 0 });
    expect(await w.a.db.all("SELECT id, kind, day FROM valued_asset")).toEqual([{ id: "aino-asset", kind: "car", day: "2026-09-01" }]);
    expect(await w.a.db.all("SELECT scope, user_id FROM payer_role")).toEqual([{ scope: "member", user_id: w.k.id }]);
  });

  it("an admin's file adds them; an asset id that is here with another kind or name gets a fresh id with all its days", async () => {
    const w = await world(null);
    await seed(w.a);
    const admin = w.a.admin;
    const file = stores();
    file.users = [{ ...kaisa, id: "U1", username: "aino", role: "admin" }];
    file.payerRoles = file.payerRoles!.map((r) => ({ ...(r as object), user_id: (r as { user_id: string | null }).user_id === null ? null : "U1", answered_by: (r as { answered_by: string | null }).answered_by === null ? null : "U1" }));
    file.valuedAssets = [
      { id: "aino-asset", kind: "home", name: "Talo", day: "2026-10-01", cents: 5 },
      { id: "aino-asset", kind: "home", name: "Talo", day: "2026-11-01", cents: 6 },
      { id: "aino-asset", kind: "car", name: "Auto", day: "2026-10-01", cents: 101 },
      { id: "new-asset", kind: "boat", name: "Vene", day: "2026-10-01", cents: 7 },
      { id: "new-asset", kind: "cabin", name: "Mokki", day: "2026-10-01", cents: 8 },
    ];
    const plan = await commit(admin, await upload(admin, file));
    expect(countsOf(plan, "householdMembers")).toMatchObject({ add: 1 });
    expect(countsOf(plan, "valuedAssets")).toMatchObject({ add: 5 });
    expect(await w.a.db.all("SELECT id FROM valued_asset GROUP BY id HAVING COUNT(DISTINCT kind || name) > 1")).toEqual([]);
    expect(await w.a.db.all("SELECT id, day, cents FROM valued_asset WHERE kind = 'car' ORDER BY day")).toEqual([{ id: "aino-asset", day: "2026-09-01", cents: 100 }, { id: "aino-asset", day: "2026-10-01", cents: 101 }]);
    const home = await w.a.db.all<{ id: string; day: string }>("SELECT id, day FROM valued_asset WHERE kind = 'home' ORDER BY day");
    expect(home).toHaveLength(2);
    expect(home[0]!.id).toBe(home[1]!.id);
    expect(home[0]!.id).not.toBe("aino-asset");
    expect(await w.a.db.first("SELECT COUNT(*) AS n FROM payer_role WHERE scope = 'household'")).toEqual({ n: 1 });
    // the same file again adds nothing of what is consistent
    const again = await check(admin, await upload(admin, { ...file, valuedAssets: file.valuedAssets!.slice(2, 3) }));
    expect(countsOf(again, "valuedAssets")).toMatchObject({ add: 0, exists: 1 });
  });
});

describe("the processing after a commit", () => {
  it("re-categorises a row its rules decide, and never a category the user set", async () => {
    const w = await world(null);
    await w.a.db.run("INSERT INTO accounts (id, user_id, provider, name, currency, type, created_at) VALUES ('kloc', ?, 'csv', 'Kaisan', 'EUR', 'checking', ?)", [w.k.id, AT]);
    const ins = (id: string, source: string, category: string) =>
      w.a.db.run(
        `INSERT INTO transactions (id, user_id, account_id, booking_date, amount_cents, currency, status, counterparty, merchant, category, category_source, is_transfer, source, imported_at, search_text)
         VALUES (?, ?, 'kloc', '2026-09-30', -500, 'EUR', 'booked', 'ESIMERKKI KAUPPA', 'ESIMERKKI KAUPPA', ?, ?, 0, 'csv', ?, 'esimerkki kauppa')`,
        [id, w.k.id, category, source, AT],
      );
    await ins("by-hand", "user", "groceries");
    await ins("by-default", "default", "other");
    const rule = { id: 1, user_id: "K1", field: "merchant", pattern: "ESIMERKKI KAUPPA", category: "transport", priority: 10, created_at: AT };
    await commit(w.k, await upload(w.k, { users: [kaisa], rules: [rule] }));
    expect(await w.a.db.all("SELECT id, category, category_source FROM transactions WHERE account_id = 'kloc' ORDER BY id")).toEqual([
      { id: "by-default", category: "transport", category_source: "rule" },
      { id: "by-hand", category: "groceries", category_source: "user" },
    ]);
  });
});

describe("the staging of chunks", () => {
  const mark = (subject: string, m = "in_use") => ({ user_id: "K1", subject, mark: m, marked_at: AT });

  it("the row number of a refusal counts the rows of the chunks before it once", async () => {
    const w = await world(null);
    const r = await send(w.k, {}, [{ marks: [mark("a"), mark("b"), mark("c")] }, { marks: [mark("d"), mark("e", "wrong")] }]);
    expect(r.refused?.status).toBe(400);
    expect(r.refused?.body.error).toMatch(/marks rivi 5 on virheellinen/);
  });

  it("a long name of an unknown store is counted under one entry, whole chunks apart", async () => {
    const w = await world(null);
    const name = "x".repeat(70);
    const r = await send(w.k, {}, [{ [name]: [1, 2] }, { [name]: [3] }]);
    expect(r.refused).toBeNull();
    const dry = await check(w.k, r.id);
    expect(dry.ignored.stores).toEqual([{ key: name.slice(0, 60), rows: 3 }]);
  });

  it("a session left open is gone once it is old, whoever calls next", async () => {
    const clock = { at: new Date("2026-10-09T10:00:00Z") };
    const a = await setupApp({}, undefined, { now: () => clock.at });
    const k = await a.member("kaisa");
    const first = await send(k, {});
    clock.at = new Date(clock.at.getTime() + 16 * 60_000);
    expect((await a.admin.call("POST", `/api/data/import/${first.id}/check`, {})).body.error).toMatch(/päättynyt tai vanhentunut/);
    expect((await k.call("POST", `/api/data/import/${first.id}/check`, {})).body.error).toMatch(/päättynyt tai vanhentunut/);
  });
});
