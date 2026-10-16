/**
 * Who uses an account: what /api/meta tells of it when nobody has said anything, saying it and taking it back, who may
 * say it, and what stays on the server (a member's own name as their accounts give it).
 */
import { describe, expect, it } from "vitest";
import { type Client, setupApp } from "./helpers.ts";

const AINO = "MEIKALAINEN AINO";
const EERO = "KORHONEN EERO";
const OTHER = "Muu tilinomistaja";

type App = Awaited<ReturnType<typeof setupApp>>;
type Member = Client & { id: string };

/** An account as a link stores one. `identity` is the real account: both partners' copies of a joint account carry the same. Null: an imported account. */
async function link(s: App["s"], userId: string, id: string, holder: string | null, identity: string | null = `idn-${id}`) {
  await s.finance(userId).upsertAccount({ id, connectionId: null, provider: identity ? "enablebanking" : "csv", externalId: null, identity, name: id, holder, iban: null, currency: "EUR", type: "checking" });
}

/** Aino and Eero, each with an account in their own name, and a joint account both linked. */
async function household() {
  const app = await setupApp();
  const eero: Member = await app.member("eero", "Eero");
  const aino: Member = Object.assign(app.admin, { id: app.adminId });
  await link(app.s, aino.id, "aino-own", AINO);
  await link(app.s, eero.id, "eero-own", EERO);
  await link(app.s, aino.id, "aino-joint", `${AINO}, ${EERO}`, "idn-joint");
  await link(app.s, eero.id, "eero-joint", `${EERO}, ${AINO}`, "idn-joint");
  return { ...app, aino, eero };
}

const metaOf = async (c: Client) => (await c.call("GET", "/api/meta")).body;
/** An account of a /api/meta answer, the viewer's own or one shared with them. */
const accountIn = (meta: any, id: string) => [...meta.accounts, ...meta.sharedAccounts].find((a: { id: string }) => a.id === id);
const accountOf = async (c: Client, id: string) => accountIn(await metaOf(c), id);
const say = (c: Client, accountId: string, users: unknown) => c.call("PUT", `/api/accounts/${accountId}/use`, { users });
const stored = (db: App["db"]) => db.all("SELECT account_key, user_id, weight, said_by FROM account_use ORDER BY account_key, user_id IS NULL, user_id");
const user = (userId: string | null, label: string, weight = 1) => ({ userId, label, weight });
/** The users in the order of the parts: by id, the user with no id last. */
const inOrder = <T extends { userId: string | null }>(users: T[]) => [...users].sort((a, b) => (a.userId === null ? 1 : b.userId === null ? -1 : a.userId < b.userId ? -1 : 1));

describe("the use of an account in /api/meta", () => {
  it("nobody has said anything: an own account is its owner's whole, a joint account is both holders' at 1 and 1", async () => {
    const { aino, eero } = await household();
    expect(await accountOf(aino, "aino-own")).toMatchObject({ use: { users: [user(aino.id, "Aino")], source: "owner" }, part: { from: 0, to: 1, of: 1 } });
    const both = inOrder([user(aino.id, "Aino"), user(eero.id, "Eero")]);
    const [first, second] = [{ from: 0, to: 1, of: 2 }, { from: 1, to: 2, of: 2 }];
    const ainoFirst = both[0]!.userId === aino.id;
    // one real account: the two copies tell the same use, and the two parts are the whole
    expect(await accountOf(aino, "aino-joint")).toMatchObject({ use: { users: both, source: "bank" }, part: ainoFirst ? first : second });
    expect(await accountOf(eero, "eero-joint")).toMatchObject({ use: { users: both, source: "bank" }, part: ainoFirst ? second : first });
  });

  it("an account shared with a member who does not use it: they see who does, and no part of it is theirs", async () => {
    const { aino, eero } = await household();
    expect((await aino.call("PUT", `/api/accounts/aino-own/shares/${eero.id}`)).status).toBe(200);
    const meta = await metaOf(eero);
    expect(meta.sharedAccounts.map((a: { id: string }) => a.id)).toEqual(["aino-own"]);
    expect(accountIn(meta, "aino-own")).toMatchObject({ use: { users: [user(aino.id, "Aino")], source: "owner" }, part: { from: 0, to: 0, of: 1 } });
    // near miss: his own account is his, whole
    expect(accountIn(meta, "eero-own")).toMatchObject({ use: { users: [user(eero.id, "Eero")], source: "owner" }, part: { from: 0, to: 1, of: 1 } });
  });

  it("a copy linked before the holders were read follows the partner's copy, and shows no name its own line lacks", async () => {
    const { s, aino, eero } = await household();
    await link(s, aino.id, "aino-three", `${AINO}, ${EERO}, VIERAS VEIKKO`, "idn-three");
    await link(s, eero.id, "eero-three", null, "idn-three");
    const [hers, his] = [await accountOf(aino, "aino-three"), await accountOf(eero, "eero-three")];
    expect(hers.use).toEqual({ users: [...inOrder([user(aino.id, "Aino"), user(eero.id, "Eero")]), user(null, "Vieras Veikko")], source: "bank" });
    expect(his.use).toEqual({ users: [...inOrder([user(aino.id, "Aino"), user(eero.id, "Eero")]), user(null, OTHER)], source: "bank" });
    // a third each, so the two own views and the third holder add up to the account
    expect(hers.part.of).toBe(3);
    expect(his.part.of).toBe(3);
    expect(hers.part).not.toEqual(his.part);
    expect(JSON.stringify(await metaOf(eero))).not.toMatch(/vieras/i);
  });
});

describe("saying who uses an account", () => {
  it("a said use on one copy of a joint account reads the same on the partner's copy, and either partner takes it back", async () => {
    const { db, aino, eero } = await household();
    expect((await say(aino, "aino-joint", [{ userId: eero.id, weight: 40_000 }, { userId: aino.id, weight: 60_000 }])).body).toEqual({ ok: true });
    const rows = [{ account_key: "idn-joint", user_id: aino.id, weight: 60_000, said_by: aino.id }, { account_key: "idn-joint", user_id: eero.id, weight: 40_000, said_by: aino.id }];
    expect(await stored(db)).toEqual(rows.sort((a, b) => (a.user_id < b.user_id ? -1 : 1)));
    const use = { users: inOrder([user(aino.id, "Aino", 60_000), user(eero.id, "Eero", 40_000)]), source: "said" };
    const ainoFirst = use.users[0]!.userId === aino.id;
    const [hers, his] = [await accountOf(aino, "aino-joint"), await accountOf(eero, "eero-joint")];
    expect(hers.use).toEqual(use);
    expect(his.use).toEqual(use);
    // 600 and 400 euros a month are 3 and 2 of 5
    expect(hers.part).toEqual(ainoFirst ? { from: 0, to: 3, of: 5 } : { from: 2, to: 5, of: 5 });
    expect(his.part).toEqual(ainoFirst ? { from: 3, to: 5, of: 5 } : { from: 0, to: 2, of: 5 });
    // saying it again replaces the statement: no row of the old one is left
    expect((await say(eero, "eero-joint", [{ userId: eero.id, weight: 1 }])).status).toBe(200);
    expect(await stored(db)).toEqual([{ account_key: "idn-joint", user_id: eero.id, weight: 1, said_by: eero.id }]);
    expect((await accountOf(aino, "aino-joint")).part).toEqual({ from: 0, to: 0, of: 1 });
    expect((await aino.call("DELETE", "/api/accounts/aino-joint/use")).body).toEqual({ ok: true });
    expect(await stored(db)).toEqual([]);
    expect((await accountOf(eero, "eero-joint")).use.source).toBe("bank");
  });

  it("a member with read access cannot say a use or take one back, and the member who linked the account can", async () => {
    const { db, aino, eero } = await household();
    await aino.call("PUT", `/api/accounts/aino-own/shares/${eero.id}`);
    expect((await metaOf(eero)).sharedAccounts).toHaveLength(1);
    const refused = await say(eero, "aino-own", [{ userId: eero.id, weight: 1 }]);
    expect(refused.status).toBe(404);
    expect(refused.body).toEqual({ error: "Tiliä ei löydy." });
    expect(await stored(db)).toEqual([]);
    expect((await say(aino, "aino-own", [{ userId: aino.id, weight: 1 }, { userId: eero.id, weight: 1 }])).status).toBe(200);
    expect((await eero.call("DELETE", "/api/accounts/aino-own/use")).status).toBe(404);
    expect(await stored(db)).toHaveLength(2);
    // a use lets nobody see an account: naming Eero on her other account shares nothing with him
    expect((await say(aino, "aino-joint", [{ userId: eero.id, weight: 1 }])).status).toBe(200);
    expect((await metaOf(eero)).sharedAccounts.map((a: { id: string }) => a.id)).toEqual(["aino-own"]);
    expect((await say(aino, "no-such-account", [{ userId: aino.id, weight: 1 }])).status).toBe(404);
  });

  it("refuses what is no use, each with its sentence, and takes what is just inside", async () => {
    const { db, aino, eero } = await household();
    const me = { userId: aino.id, weight: 1 };
    const seven = Array.from({ length: 7 }, () => me);
    const refusals: [unknown, string][] = [
      [undefined, "Valitse tilille ainakin yksi käyttäjä."],
      [[], "Valitse tilille ainakin yksi käyttäjä."],
      [{ userId: aino.id, weight: 1 }, "Valitse tilille ainakin yksi käyttäjä."],
      [[...seven, { userId: eero.id, weight: 1 }, { userId: null, weight: 1 }], "Tilillä voi olla enintään kahdeksan käyttäjää."],
      [[{ userId: "u-nobody", weight: 1 }], "Käyttäjää ei löydy."],
      [[{ userId: 7, weight: 1 }], "Käyttäjää ei löydy."],
      [[{ weight: 1 }], "Käyttäjää ei löydy."],
      [[{ userId: aino.id, weight: -1 }], "Virheellinen osuus."],
      [[{ userId: aino.id, weight: 1.5 }], "Virheellinen osuus."],
      [[{ userId: aino.id, weight: "1" }], "Virheellinen osuus."],
      [[{ userId: aino.id, weight: 100_000_001 }], "Virheellinen osuus."],
      [[me, { userId: aino.id, weight: 2 }], "Sama käyttäjä on valittu kahdesti."],
      [[{ userId: null, weight: 1 }, { userId: null, weight: 2 }], "Sama käyttäjä on valittu kahdesti."],
      [[{ userId: aino.id, weight: 0 }, { userId: eero.id, weight: 0 }], "Ainakin yhdellä käyttäjällä pitää olla osuus."],
      [[{ userId: aino.id, weight: 1, part: 2 }], "Tuntematon kenttä: part"],
    ];
    for (const [users, error] of refusals) {
      const res = await say(aino, "aino-own", users);
      expect(res.status, JSON.stringify(users)).toBe(400);
      expect(res.body, JSON.stringify(users)).toEqual({ error });
    }
    expect((await aino.call("PUT", "/api/accounts/aino-own/use", { users: [me], saidBy: eero.id })).body).toEqual({ error: "Tuntematon kenttä: saidBy" });
    expect(await stored(db)).toEqual([]);
    // near misses: the largest weight, a weight of nothing beside one cent, the user with no id once
    expect((await say(aino, "aino-own", [{ userId: aino.id, weight: 100_000_000 }, { userId: eero.id, weight: 0 }, { userId: null, weight: 1 }])).status).toBe(200);
    expect(await stored(db)).toHaveLength(3);
    // eight users are a statement: a household of eight has to be made first
    const big = await setupApp();
    const ids = [big.adminId];
    for (let i = 0; i < 6; i++) ids.push((await big.member(`jasen${i}`)).id);
    await link(big.s, big.adminId, "own", AINO);
    expect((await say(big.admin, "own", [...ids.map((userId) => ({ userId, weight: 1 })), { userId: null, weight: 1 }])).status).toBe(200);
    expect(await stored(big.db)).toHaveLength(8);
  });

  it("an imported account is said by its own id, and the user with no id is somebody the bank does not name", async () => {
    const { s, db, aino } = await household();
    await link(s, aino.id, "aino-file", null, null);
    expect((await say(aino, "aino-file", [{ userId: null, weight: 1 }, { userId: aino.id, weight: 1 }])).status).toBe(200);
    expect(await stored(db)).toEqual([{ account_key: "aino-file", user_id: aino.id, weight: 1, said_by: aino.id }, { account_key: "aino-file", user_id: null, weight: 1, said_by: aino.id }]);
    expect(await accountOf(aino, "aino-file")).toMatchObject({ use: { users: [user(aino.id, "Aino"), user(null, OTHER)], source: "said" }, part: { from: 0, to: 1, of: 2 } });
  });

  it("moves the data version of everyone who sees the account, and of nobody else", async () => {
    const { s, member, aino, eero } = await household();
    const liisa = await member("liisa", "Liisa");
    const versions = async () => Object.fromEntries(await Promise.all([aino, eero, liisa].map(async (m) => [m.id, await s.settings.dataVersionOf([m.id])] as const)));
    const moved = async (act: () => Promise<{ status: number }>) => {
      const before = await versions();
      expect((await act()).status).toBe(200);
      const after = await versions();
      return [aino, eero, liisa].filter((m) => after[m.id] !== before[m.id]).map((m) => m.id).sort();
    };
    // both linked the joint account
    expect(await moved(() => say(aino, "aino-joint", [{ userId: aino.id, weight: 2 }, { userId: liisa.id, weight: 1 }]))).toEqual([aino.id, eero.id].sort());
    expect(await moved(() => eero.call("DELETE", "/api/accounts/eero-joint/use"))).toEqual([aino.id, eero.id].sort());
    // her own account is seen by her, and by Liisa once it is shared with her
    expect(await moved(() => say(aino, "aino-own", [{ userId: aino.id, weight: 1 }]))).toEqual([aino.id]);
    await aino.call("PUT", `/api/accounts/aino-own/shares/${liisa.id}`);
    expect(await moved(() => say(aino, "aino-own", [{ userId: aino.id, weight: 1 }, { userId: eero.id, weight: 1 }]))).toEqual([aino.id, liisa.id].sort());
    expect(await moved(() => aino.call("DELETE", "/api/accounts/aino-own/use"))).toEqual([aino.id, liisa.id].sort());
  });
});

describe("what stays on the server", () => {
  it("/api/meta of another member holds no holder's name it did not hold before", async () => {
    const { s, aino, eero } = await household();
    await link(s, aino.id, "aino-guest", `${AINO}, VIERAS VEIKKO`);
    await aino.call("PUT", `/api/accounts/aino-own/shares/${eero.id}`);
    await say(aino, "aino-own", [{ userId: aino.id, weight: 1 }, { userId: eero.id, weight: 1 }, { userId: null, weight: 1 }]);
    await say(eero, "eero-own", [{ userId: eero.id, weight: 1 }, { userId: aino.id, weight: 1 }]);
    for (const viewer of [aino, eero]) {
      const meta = await metaOf(viewer);
      const accounts = [...meta.accounts, ...meta.sharedAccounts];
      expect(accounts.every((a: { use?: unknown; part?: unknown }) => a.use && a.part)).toBe(true);
      const names = new Set(meta.members.map((m: { displayName: string }) => m.displayName));
      for (const a of accounts) {
        for (const u of a.use.users as { userId: string | null; label: string }[]) {
          // a member by their display name; the user with no id by a name the account's own line already shows, or by no name
          if (u.userId !== null) expect(names.has(u.label), `${a.id}: ${u.label}`).toBe(true);
          // the label is the holder in normal case, as a payee is shown
          else expect(u.label === OTHER || u.label.split(", ").every((name) => (a.holder ?? "").toLowerCase().split(", ").includes(name.toLowerCase())), `${a.id}: ${u.label}`).toBe(true);
        }
      }
      // every name the answer holds was there before a use was told
      const before = JSON.stringify({ ...meta, accounts: meta.accounts.map(({ use: _u, part: _p, ...a }: any) => a), sharedAccounts: meta.sharedAccounts.map(({ use: _u, part: _p, ...a }: any) => a) });
      for (const word of JSON.stringify(meta).match(/\p{Lu}{3,}/gu) ?? []) expect(before, word).toContain(word);
    }
    // his own line of holders is on his accounts only: her answer has it on the joint account, and nowhere a name of his she could not see
    const hers = await metaOf(aino);
    expect(accountIn(hers, "aino-guest").use.users.at(-1)).toEqual(user(null, "Vieras Veikko"));
    const his = JSON.stringify(await metaOf(eero));
    expect(his).not.toMatch(/vieras/i);
    // near miss: a household where nothing of hers is in his view: saying he uses her account tells him nothing
    const apart = await setupApp();
    const other: Member = await apart.member("eero", "Eero");
    await link(apart.s, apart.adminId, "aino-own", AINO);
    await link(apart.s, other.id, "eero-own", EERO);
    expect((await say(apart.admin, "aino-own", [{ userId: apart.adminId, weight: 1 }, { userId: other.id, weight: 1 }])).status).toBe(200);
    expect(JSON.stringify(await metaOf(other))).not.toContain("MEIKALAINEN");
    expect(JSON.stringify(await metaOf(apart.admin))).not.toContain("KORHONEN");
    expect((await accountOf(apart.admin, "aino-own")).use.users.map((u: { label: string }) => u.label).sort()).toEqual(["Aino", "Eero"]);
  });

  it("removing a member keeps the ratio that was said: their weight goes to the holders who are no user", async () => {
    const { db, aino, eero } = await household();
    expect((await say(aino, "aino-joint", [{ userId: aino.id, weight: 60000 }, { userId: eero.id, weight: 40000 }])).status).toBe(200);
    // near miss: while he is a user her part is three of five, wherever the two ids put it
    const before = (await accountOf(aino, "aino-joint")).part;
    expect([before.to - before.from, before.of]).toEqual([3, 5]);
    expect((await aino.call("DELETE", `/api/users/${eero.id}`)).status).toBe(200);
    expect(await stored(db)).toEqual([
      { account_key: "idn-joint", user_id: aino.id, weight: 60000, said_by: aino.id },
      { account_key: "idn-joint", user_id: null, weight: 40000, said_by: aino.id },
    ]);
    // the ratio that was said stays, and what was his is the holder who is no user now: a name on her own line
    expect(await accountOf(aino, "aino-joint")).toMatchObject({
      use: { users: [user(aino.id, "Aino", 60000), user(null, "Korhonen Eero", 40000)], source: "said" },
      part: { from: 0, to: 3, of: 5 },
    });
  });

  it("a removed member's weight goes to the holders who are no user on every key they had a row of", async () => {
    const { db, aino, eero } = await household();
    expect((await say(eero, "eero-joint", [{ userId: aino.id, weight: 2 }, { userId: eero.id, weight: 1 }])).status).toBe(200);
    expect((await say(aino, "aino-own", [{ userId: aino.id, weight: 0 }, { userId: eero.id, weight: 5 }])).status).toBe(200);
    // near miss: while he is a user the statement holds, and none of her own account is hers
    expect(await accountOf(aino, "aino-own")).toMatchObject({ use: { source: "said" }, part: { from: 0, to: 0, of: 1 } });
    expect((await aino.call("DELETE", `/api/users/${eero.id}`)).status).toBe(200);
    expect(await stored(db)).toEqual([
      { account_key: "idn-aino-own", user_id: aino.id, weight: 0, said_by: aino.id },
      { account_key: "idn-aino-own", user_id: null, weight: 5, said_by: aino.id },
      { account_key: "idn-joint", user_id: aino.id, weight: 2, said_by: null },
      { account_key: "idn-joint", user_id: null, weight: 1, said_by: null },
    ]);
    expect(await accountOf(aino, "aino-joint")).toMatchObject({ use: { users: [user(aino.id, "Aino", 2), user(null, "Korhonen Eero", 1)], source: "said" }, part: { from: 0, to: 2, of: 3 } });
    // her own account stays hers at nothing: what she said of it is not taken back by his leaving
    expect(await accountOf(aino, "aino-own")).toMatchObject({ use: { users: [user(aino.id, "Aino", 0), user(null, OTHER, 5)], source: "said" }, part: { from: 0, to: 0, of: 1 } });
  });

  it("the row of the holders who are no user is added to, not replaced", async () => {
    const { db, aino, eero } = await household();
    expect((await say(eero, "eero-joint", [{ userId: aino.id, weight: 2 }, { userId: eero.id, weight: 1 }, { userId: null, weight: 1 }])).status).toBe(200);
    expect((await aino.call("DELETE", `/api/users/${eero.id}`)).status).toBe(200);
    expect(await stored(db)).toEqual([
      { account_key: "idn-joint", user_id: aino.id, weight: 2, said_by: null },
      { account_key: "idn-joint", user_id: null, weight: 2, said_by: null },
    ]);
    expect(await accountOf(aino, "aino-joint")).toMatchObject({ use: { users: [user(aino.id, "Aino", 2), user(null, "Korhonen Eero", 2)], source: "said" }, part: { from: 0, to: 1, of: 2 } });
  });

  it("a removed member who had no weight leaves no row of the holders who are no user, and the others' rows stay", async () => {
    const { db, aino, eero } = await household();
    expect((await say(aino, "aino-own", [{ userId: aino.id, weight: 5 }, { userId: eero.id, weight: 0 }])).status).toBe(200);
    expect((await aino.call("DELETE", `/api/users/${eero.id}`)).status).toBe(200);
    expect(await stored(db)).toEqual([{ account_key: "idn-aino-own", user_id: aino.id, weight: 5, said_by: aino.id }]);
    expect(await accountOf(aino, "aino-own")).toMatchObject({ use: { users: [user(aino.id, "Aino", 5)], source: "said" }, part: { from: 0, to: 1, of: 1 } });
  });

  it("a removed member who was the only one with a row of an account takes the statement with them, and the bank's holders tell again", async () => {
    const { db, aino, eero } = await household();
    expect((await say(aino, "aino-own", [{ userId: eero.id, weight: 5 }])).status).toBe(200);
    // near miss: while he is a user the account is his alone
    expect(await accountOf(aino, "aino-own")).toMatchObject({ use: { users: [user(eero.id, "Eero", 5)], source: "said" }, part: { from: 0, to: 0, of: 1 } });
    expect((await aino.call("DELETE", `/api/users/${eero.id}`)).status).toBe(200);
    expect(await stored(db)).toEqual([]);
    expect(await accountOf(aino, "aino-own")).toMatchObject({ use: { users: [user(aino.id, "Aino")], source: "owner" }, part: { from: 0, to: 1, of: 1 } });
  });

  it("a member who linked an account alone takes what was said of it: the next to link it starts without a statement", async () => {
    const app = await setupApp();
    const eero: Member = await app.member("eero", "Eero");
    const aino: Member = Object.assign(app.admin, { id: app.adminId });
    await link(app.s, aino.id, "aino-own", AINO);
    await link(app.s, eero.id, "eero-joint", `${EERO}, ${AINO}`, "idn-joint");
    expect((await say(eero, "eero-joint", [{ userId: eero.id, weight: 1 }, { userId: aino.id, weight: 3 }])).status).toBe(200);
    expect((await say(aino, "aino-own", [{ userId: aino.id, weight: 2 }])).status).toBe(200);
    expect((await aino.call("DELETE", `/api/users/${eero.id}`)).status).toBe(200);
    // the joint account has no copy left, and her own account is no other account's matter
    expect(await stored(app.db)).toEqual([{ account_key: "idn-aino-own", user_id: aino.id, weight: 2, said_by: aino.id }]);
    await link(app.s, aino.id, "aino-joint", `${AINO}, ${EERO}`, "idn-joint");
    expect(await accountOf(aino, "aino-joint")).toMatchObject({ use: { users: [user(aino.id, "Aino"), user(null, "Korhonen Eero")], source: "bank" }, part: { from: 0, to: 1, of: 2 } });
  });
});
