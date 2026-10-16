import { describe, expect, it } from "vitest";
import { seedCsv } from "./csv-seed.ts";
import { setupApp } from "./helpers.ts";

const KEY = "name:ESIMERKKI VILLE";
/** Ville Esimerkki pays 300,00 on the third of each month, three months running; the member's own made-up pay is a second payer. */
const CSV = ["Kirjauspäivä;Määrä;Nimi;Otsikko", ...["2026/07/03", "2026/08/03", "2026/09/03"].map((d) => `${d};300,00;Esimerkki Ville;Siirto`)].join("\n");

async function twoMembers() {
  const app = await setupApp();
  const maija = await app.member("maija", "Maija");
  await seedCsv(app.s, app.admin, { content: CSV, accountName: "Käyttötili", accountType: "checking" });
  await seedCsv(app.s, maija, { content: CSV, accountName: "Käyttötili", accountType: "checking" });
  const categories = async (id: string) => (await app.s.finance(id).allTransactions()).filter((t) => t.amountCents > 0).map((t) => t.category);
  const asked = async (c: { call: (m: string, p: string) => Promise<{ body: any }> }) =>
    ((await c.call("GET", "/api/dashboard")).body.questions.items as { kind: string; key: string }[]).filter((q) => q.kind === "payer").map((q) => q.key);
  const say = (c: { call: (m: string, p: string, b?: unknown) => Promise<{ status: number; body: any }> }, role: string | null, everyone = false, key = KEY) => c.call("PUT", "/api/payer-roles", { key, role, ...(everyone ? { everyone } : {}) });
  return { ...app, maija, categories, asked, say };
}

describe("payer roles stored and asked", () => {
  it("asks about the payer, and an answer moves only the member's own rows", async () => {
    const t = await twoMembers();
    const before = await t.categories(t.adminId);
    expect(await t.asked(t.admin)).toEqual([KEY]);
    expect(await t.asked(t.maija)).toEqual([KEY]);

    const res = await t.say(t.admin, "sales");
    expect(res).toMatchObject({ status: 200, body: { ok: true } });
    expect(await t.categories(t.adminId)).toEqual(["sales", "sales", "sales"]);
    // the other member's rows and question are as they were: an own answer is read in that member's view only
    expect(await t.categories(t.maija.id)).toEqual(before);
    expect(await t.asked(t.maija)).toEqual([KEY]);
    expect(await t.asked(t.admin)).toEqual([]);
    expect(await t.s.finance(t.maija.id).payerRoles()).toEqual([]);
    expect(await t.s.finance(t.adminId).payerRoles()).toEqual([{ scope: "member", userId: t.adminId, counterpartyKey: KEY, role: "sales" }]);
  });

  it("changes an answer in place and restores the proposal by removing only the answer row", async () => {
    const t = await twoMembers();
    const before = await t.categories(t.adminId);
    await t.say(t.admin, "sales");
    await t.say(t.admin, "pay");
    expect(await t.categories(t.adminId)).toEqual(["salary", "salary", "salary"]);
    expect(await t.s.finance(t.adminId).payerRoles()).toHaveLength(1);

    await t.say(t.admin, null);
    expect(await t.s.finance(t.adminId).payerRoles()).toEqual([]);
    expect(await t.categories(t.adminId)).toEqual(before);
    expect(await t.asked(t.admin)).toEqual([KEY]);
    // the rows themselves are all still there
    expect(await t.s.finance(t.adminId).allTransactions()).toHaveLength(3);
    // taking back what was never answered is no error
    expect((await t.say(t.admin, null)).status).toBe(200);
  });

  it("a member's answer never moves another member's private rows, and no household row is written", async () => {
    // Maija has her own account with the same payer; the admin's rows of that payer are on an account Maija never sees
    const app = await setupApp();
    const maija = await app.member("maija", "Maija");
    await seedCsv(app.s, app.admin, { content: CSV, accountName: "Käyttötili", accountType: "checking" });
    await seedCsv(app.s, maija, { content: CSV, accountName: "Oma tili", accountType: "checking" });
    const categories = async (id: string) => (await app.s.finance(id).allTransactions()).filter((t) => t.amountCents > 0).map((t) => t.category);
    const adminBefore = await categories(app.adminId);
    const say = (c: Pick<typeof maija, "call">, role: string | null, extra: object = {}) => c.call("PUT", "/api/payer-roles", { key: KEY, role, ...extra });

    expect((await say(maija, "pay")).status).toBe(200);
    expect(await categories(maija.id)).toEqual(["salary", "salary", "salary"]);
    expect(await categories(app.adminId)).toEqual(adminBefore);
    expect(await app.db.all("SELECT scope, user_id FROM payer_role")).toEqual([{ scope: "member", user_id: maija.id }]);

    // the household scope is refused for everyone, the admin included, and nothing is stored
    for (const c of [maija, app.admin]) {
      expect((await say(c, "pay", { scope: "household" })).status).toBe(400);
      expect((await say(c, "pay", { everyone: true })).status).toBe(400);
    }
    expect(await app.db.all("SELECT scope FROM payer_role")).toEqual([{ scope: "member" }]);

    // a household row that exists is still read by every run, and no member can change or remove it
    await app.db.run("INSERT INTO payer_role (scope, user_id, counterparty_key, role, answered_by, answered_at) VALUES ('household', NULL, ?, 'sales', ?, ?)", [KEY, app.adminId, "2026-10-01T00:00:00.000Z"]);
    await say(app.admin, "gift");
    expect(await categories(app.adminId)).toEqual(["p2p_in", "p2p_in", "p2p_in"]);
    await say(app.admin, null);
    expect(await categories(app.adminId)).toEqual(["sales", "sales", "sales"]);
    expect(await categories(maija.id)).toEqual(["salary", "salary", "salary"]);
    await say(maija, null);
    expect(await categories(maija.id)).toEqual(["sales", "sales", "sales"]);
    expect(await app.db.all("SELECT scope FROM payer_role")).toEqual([{ scope: "household" }]);
  });

  it("takes an answer back with no error, also when no row of the payer is left and when nothing was answered", async () => {
    const t = await twoMembers();
    const other = "name:ESIMERKKI MATTI";
    // an answer whose payer has no rows in the member's view any more (the account was unlinked)
    await t.db.run("INSERT INTO payer_role (scope, user_id, counterparty_key, role, answered_by, answered_at) VALUES ('member', ?, ?, 'sales', ?, ?)", [t.maija.id, other, t.maija.id, "2026-10-01T00:00:00.000Z"]);
    expect((await t.say(t.maija, "pay", false, other)).status).toBe(400);
    expect((await t.say(t.maija, null, false, other)).status).toBe(200);
    expect(await t.s.finance(t.maija.id).payerRoles()).toEqual([]);
    expect((await t.say(t.maija, null, false, other)).status).toBe(200);
    // the admin's answer of another payer is not the member's to take back
    await t.say(t.admin, "sales");
    expect((await t.say(t.maija, null)).status).toBe(200);
    expect(await t.s.finance(t.adminId).payerRoles()).toHaveLength(1);
    // a key that is not a payer's is still refused, taking back included
    expect((await t.say(t.maija, null, false, "Esimerkki Ville")).status).toBe(400);
  });

  it("refuses an unknown role, a bad key and a payer the member has no rows of", async () => {
    const t = await twoMembers();
    const stored = async () => (await t.db.all("SELECT * FROM payer_role")).length;
    expect((await t.say(t.admin, "boss")).status).toBe(400);
    expect((await t.say(t.admin, "sales", false, "Esimerkki Ville")).status).toBe(400);
    expect((await t.say(t.admin, "sales", false, "name:ESIMERKKI MATTI")).status).toBe(400);
    expect((await t.admin.call("PUT", "/api/payer-roles", { key: KEY, role: "sales", extra: 1 })).status).toBe(400);
    expect(await stored()).toBe(0);
    // own money for oneself passes the same checks
    expect((await t.say(t.admin, "own_money")).status).toBe(200);
    expect(await stored()).toBe(1);
  });

  it("asks at most three at a visit", async () => {
    const app = await setupApp();
    const rows = ["Esimerkki Ville", "Esimerkki Liisa", "Esimerkki Pekka", "Esimerkki Anna", "Esimerkki Olli"].flatMap((n) => ["2026/07/03", "2026/08/03", "2026/09/03"].map((d) => `${d};300,00;${n};Siirto`));
    await seedCsv(app.s, app.admin, { content: ["Kirjauspäivä;Määrä;Nimi;Otsikko", ...rows].join("\n"), accountName: "Käyttötili", accountType: "checking" });
    const items = (await app.admin.call("GET", "/api/dashboard")).body.questions.items as { kind: string }[];
    expect(items.filter((q) => q.kind === "payer")).toHaveLength(3);
  });
});
