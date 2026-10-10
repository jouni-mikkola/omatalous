import { describe, expect, it } from "vitest";
import { setupApp } from "./helpers.ts";

const HEADER = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta";
const CHECKING = "FI12 1234 5600 0785 41";
const SAVINGS = "FI45 1234 5600 0921 77";
const file = (...rows: string[]) => [HEADER, ...rows].join("\n");

const content = file(
  `2026/09/20;-12,00;${CHECKING};;;XYZZY TUNTEMATON;;EUR`,
  `2026/09/02;-30,00;${CHECKING};;;XYZZY TUNTEMATON;;EUR`,
  `2026/09/06;35,00;;${CHECKING};;XYZZY TUNTEMATON;;EUR`,
  `2026/09/10;-55,50;${CHECKING};;;QWERTY PUOTI;;EUR`,
  `2026/09/05;-44,15;${CHECKING};;;LIDL TIKKURILA;;EUR`,
  `2026/09/12;-20,00;${CHECKING};;;LIDL TIKKURILA;;EUR`,
  `2026/09/14;-8,00;${CHECKING};;;LIDL TIKKURILA;;EUR`,
  `2026/09/15;-7,00;${CHECKING};;KÄRKKÄINEN TMI;LASKU;;EUR`,
);

type Item = { merchant: string; category: string; count: number; totalCents: number; inCents: number; lastDate: string; rule: { id: number; category: string } | null };
type Client = Awaited<ReturnType<typeof setupApp>>["admin"];

const names = (items: Item[]) => items.map((i) => i.merchant);
const list = async (c: Client, query = ""): Promise<Item[]> => (await c.call("GET", `/api/merchants${query}`)).body.items;
const one = async (c: Client, merchant: string) => (await list(c)).find((i) => i.merchant === merchant);

async function withData() {
  const app = await setupApp();
  const r = await app.admin.call("POST", "/api/import/csv", { content, accountName: "Käyttötili" });
  expect(r.status).toBe(200);
  return app;
}

describe("GET /api/merchants", () => {
  it("lists the user's merchants, biggest spending first", async () => {
    const { admin } = await withData();
    const items = await list(admin);
    expect(items).toEqual([
      { merchant: "Lidl", category: "groceries", count: 3, totalCents: 7215, inCents: 0, lastDate: "2026-09-14", rule: null, otherCategories: [] },
      { merchant: "Qwerty Puoti", category: "other", count: 1, totalCents: 5550, inCents: 0, lastDate: "2026-09-10", rule: null, otherCategories: [] },
      { merchant: "Xyzzy Tuntematon", category: "other", count: 3, totalCents: 4200, inCents: 3500, lastDate: "2026-09-20", rule: null, otherCategories: [{ category: "income", count: 1, totalCents: 0, inCents: 3500 }] },
      { merchant: "Kärkkäinen Tmi", category: "other", count: 1, totalCents: 700, inCents: 0, lastDate: "2026-09-15", rule: null, otherCategories: [] },
    ]);
  });

  it("filters by category and by the folded name, and limits the list", async () => {
    const { admin } = await withData();
    expect(names(await list(admin, "?category=groceries"))).toEqual(["Lidl"]);
    expect(names(await list(admin, "?category=other"))).toEqual(["Qwerty Puoti", "Xyzzy Tuntematon", "Kärkkäinen Tmi"]);
    expect(await list(admin, "?category=no_such_category")).toEqual([]);
    for (const q of ["karkkainen", "KÄRKKÄINEN", "kärk"]) expect(names(await list(admin, `?q=${encodeURIComponent(q)}`)), q).toEqual(["Kärkkäinen Tmi"]);
    expect(names(await list(admin, "?q=tikkurila&category=other"))).toEqual([]);
    // q matches the merchant name only
    expect(await list(admin, "?q=lasku")).toEqual([]);

    expect(names(await list(admin, "?limit=2"))).toEqual(["Lidl", "Qwerty Puoti"]);
    expect(await list(admin, "?limit=0")).toHaveLength(1);
    expect(await list(admin, "?limit=100000")).toHaveLength(4);
    expect((await admin.call("GET", "/api/merchants?limit=abc")).status).toBe(400);
  });

  it("names the category most of a merchant's rows are in", async () => {
    const { admin } = await withData();
    const rows = (await admin.call("GET", "/api/transactions?merchant=Lidl")).body.items;
    await admin.call("PATCH", `/api/transactions/${rows[0].id}`, { category: "shopping" });
    // the total covers all three rows, so the one in another category is named with its share
    expect(await one(admin, "Lidl")).toMatchObject({ category: "groceries", count: 3, totalCents: 7215, otherCategories: [{ category: "shopping", count: 1, totalCents: 800, inCents: 0 }] });
  });

  it("leaves transfers out", async () => {
    const { admin } = await setupApp();
    const rows = [
      file(`2026/09/16;-300,00;${CHECKING};${SAVINGS};LAAKSONEN MIKKO JA ANNA;OMA SIIRTO;;EUR`, `2026/09/05;-44,15;${CHECKING};;;LIDL TIKKURILA;;EUR`),
      file(`2026/09/16;300,00;${CHECKING};${SAVINGS};LAAKSONEN MIKKO JA ANNA;OMA SIIRTO;;EUR`, `2025/12/31;12,40;;${SAVINGS};;KORKO;;EUR`),
    ];
    await admin.call("POST", "/api/import/csv", { content: rows[0], accountName: "Käyttötili" });
    await admin.call("POST", "/api/import/csv", { content: rows[1], accountName: "Säästötili" });
    const transfers: { merchant: string }[] = (await admin.call("GET", "/api/transactions?limit=50")).body.items.filter((t: { isTransfer: boolean }) => t.isTransfer);
    expect(transfers.length).toBeGreaterThan(0);
    const listed = names(await list(admin));
    expect(listed).toContain("Lidl");
    for (const t of transfers) expect(listed).not.toContain(t.merchant);
  });

  it("shows only the user's own merchants, shared accounts included", async () => {
    const { admin, member } = await withData();
    const eero = await member("eero");
    expect(await list(eero)).toEqual([]);
    const accountId = (await admin.call("GET", "/api/meta")).body.accounts[0].id;
    await admin.call("PUT", `/api/accounts/${accountId}/shares/${eero.id}`);
    expect(await list(eero)).toEqual([]);
    expect(await list(eero, "?scope=household")).toEqual([]);
    expect(await list(admin)).toHaveLength(4);
  });
});

describe("PUT /api/merchants/category", () => {
  it("does not know a merchant that only has transfer rows", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/import/csv", { content: file(`2026/09/16;-300,00;${CHECKING};${SAVINGS};LAAKSONEN MIKKO JA ANNA;OMA SIIRTO;;EUR`), accountName: "Käyttötili" });
    await admin.call("POST", "/api/import/csv", { content: file(`2026/09/16;300,00;${CHECKING};${SAVINGS};LAAKSONEN MIKKO JA ANNA;OMA SIIRTO;;EUR`), accountName: "Säästötili" });
    const transfer = (await admin.call("GET", "/api/transactions?limit=50")).body.items.find((t: { isTransfer: boolean }) => t.isTransfer);
    expect(transfer).toBeDefined();
    const r = await admin.call("PUT", "/api/merchants/category", { merchant: transfer.merchant, category: "shopping" });
    expect(r.status).toBe(400);
  });

  it("moves every row of the merchant and keeps the choice as a rule", async () => {
    const { admin } = await withData();
    const r = await admin.call("PUT", "/api/merchants/category", { merchant: "Lidl", category: "shopping" });
    expect(r).toMatchObject({ status: 200, body: { changed: 3 } });

    const rules = (await admin.call("GET", "/api/rules")).body.rules;
    expect(rules).toMatchObject([{ field: "merchant_exact", pattern: "Lidl", category: "shopping", priority: 5 }]);
    expect(await one(admin, "Lidl")).toMatchObject({ category: "shopping", rule: { id: rules[0].id, category: "shopping" } });

    // a row that comes in later follows the rule
    const more = file(`2026/09/18;-9,00;${CHECKING};;;LIDL TIKKURILA;;EUR`);
    await admin.call("POST", "/api/import/csv", { content: more, accountName: "Toinen tili" });
    expect(await one(admin, "Lidl")).toMatchObject({ category: "shopping", count: 4 });
  });

  it("a second choice replaces the first, the same choice changes nothing", async () => {
    const { admin, s, adminId } = await withData();
    await admin.call("PUT", "/api/merchants/category", { merchant: "Lidl", category: "shopping" });
    expect((await admin.call("PUT", "/api/merchants/category", { merchant: "Lidl", category: "shopping" })).body.changed).toBe(0);
    expect((await admin.call("PUT", "/api/merchants/category", { merchant: "Lidl", category: "restaurants" })).body.changed).toBe(3);
    expect(await s.finance(adminId).ruleCount()).toBe(1);
    expect(await one(admin, "Lidl")).toMatchObject({ category: "restaurants", rule: { category: "restaurants" } });
  });

  it("keeps rows the user set by hand one by one", async () => {
    const { admin } = await withData();
    const rows = (await admin.call("GET", "/api/transactions?merchant=Lidl")).body.items;
    await admin.call("PATCH", `/api/transactions/${rows[0].id}`, { category: "restaurants" });
    expect((await admin.call("PUT", "/api/merchants/category", { merchant: "Lidl", category: "shopping" })).body.changed).toBe(2);
    const after = (await admin.call("GET", "/api/transactions?merchant=Lidl")).body.items;
    expect(after.filter((t: { categorySource: string }) => t.categorySource === "user").map((t: { category: string }) => t.category)).toEqual(["restaurants"]);
    expect(after.filter((t: { category: string }) => t.category === "shopping")).toHaveLength(2);
  });

  it("refuses bad input", async () => {
    const { admin } = await withData();
    const put = (payload: unknown) => admin.call("PUT", "/api/merchants/category", payload);
    for (const payload of [
      { merchant: "Lidl", category: "no_such_category" },
      { merchant: "Lidl", category: 5 },
      { merchant: "Lidl" },
      { category: "shopping" },
      { merchant: "", category: "shopping" },
      { merchant: 5, category: "shopping" },
      { merchant: "x".repeat(201), category: "shopping" },
      { merchant: "Lidl", category: "shopping", priority: 1 },
      { merchant: "Lidl", category: "shopping", userId: "someone" },
      [],
    ]) {
      expect((await put(payload)).status, JSON.stringify(payload)).toBe(400);
    }
    expect((await admin.call("PUT", "/api/merchants/category", undefined)).status).toBe(400);
    // a name that is none of the user's merchants would only use up a rule
    expect(await put({ merchant: "Ei Tällaista Kauppiasta", category: "shopping" })).toMatchObject({ status: 400, body: { error: "Kauppiasta ei löydy." } });
    expect((await admin.call("GET", "/api/rules")).body.rules).toEqual([]);
  });

  it("needs the CSRF header and a signed-in user", async () => {
    const { admin, client } = await withData();
    const payload = { merchant: "Lidl", category: "shopping" };
    expect((await admin.call("PUT", "/api/merchants/category", payload, { "X-Requested-With": "" })).status).toBe(403);
    expect((await client().call("PUT", "/api/merchants/category", payload)).status).toBe(401);
    expect((await client().call("GET", "/api/merchants")).status).toBe(401);
  });

  it("counts toward the rule cap, but replacing a merchant's own rule does not", async () => {
    const { admin, s, adminId } = await withData();
    const repo = s.finance(adminId);
    for (let i = 0; i < 299; i++) await repo.addRule({ field: "description", pattern: `SAANTO ${i}`, category: "other", priority: 10 });
    expect((await admin.call("PUT", "/api/merchants/category", { merchant: "Lidl", category: "shopping" })).status).toBe(200);
    expect(await repo.ruleCount()).toBe(300);

    expect((await admin.call("PUT", "/api/merchants/category", { merchant: "Lidl", category: "restaurants" })).status).toBe(200);
    const refused = await admin.call("PUT", "/api/merchants/category", { merchant: "Qwerty Puoti", category: "shopping" });
    expect(refused).toMatchObject({ status: 400, body: { error: "Sääntöjä voi olla enintään 300." } });
    expect(await repo.ruleCount()).toBe(300);
    expect((await one(admin, "Qwerty Puoti"))?.rule).toBeNull();
  });

  it("touches only the signed-in user's rows and rules", async () => {
    const { admin, member, s, adminId } = await withData();
    const eero = await member("eero");
    await eero.call("POST", "/api/import/csv", { content: file(`2026/09/05;-10,00;${CHECKING};;;LIDL TIKKURILA;;EUR`), accountName: "Eeron tili" });

    // Eero cannot set a rule for a name only Aino has
    const notHis = await eero.call("PUT", "/api/merchants/category", { merchant: "Qwerty Puoti", category: "shopping" });
    expect(notHis.status).toBe(400);
    expect(await s.finance(eero.id).listRules()).toEqual([]);

    // a name both have, each rule and each row stays with its owner
    await admin.call("PUT", "/api/merchants/category", { merchant: "Lidl", category: "shopping" });
    expect(await one(eero, "Lidl")).toMatchObject({ category: "groceries", rule: null });
    await eero.call("PUT", "/api/merchants/category", { merchant: "Lidl", category: "restaurants" });
    expect(await one(admin, "Lidl")).toMatchObject({ category: "shopping", rule: { category: "shopping" } });
    expect(await s.finance(adminId).ruleCount()).toBe(1);

    // removing Eero's rule leaves Aino's
    await eero.call("DELETE", "/api/merchants/rule", { merchant: "Lidl" });
    expect(await one(admin, "Lidl")).toMatchObject({ category: "shopping", rule: { category: "shopping" } });
    expect(await one(eero, "Lidl")).toMatchObject({ category: "groceries", rule: null });
  });
});

describe("DELETE /api/merchants/rule", () => {
  it("takes the merchant back to automatic", async () => {
    const { admin } = await withData();
    await admin.call("PUT", "/api/merchants/category", { merchant: "Lidl", category: "shopping" });
    const r = await admin.call("DELETE", "/api/merchants/rule", { merchant: "Lidl" });
    expect(r).toMatchObject({ status: 200, body: { changed: 3 } });
    expect(await one(admin, "Lidl")).toMatchObject({ category: "groceries", rule: null });
    expect((await admin.call("GET", "/api/rules")).body.rules).toEqual([]);
    // nothing left to remove
    expect((await admin.call("DELETE", "/api/merchants/rule", { merchant: "Lidl" })).body).toEqual({ changed: 0 });
  });

  it("removes the older whole-word rule for exactly this name too, and no other rule", async () => {
    const { admin, s, adminId } = await withData();
    const repo = s.finance(adminId);
    await repo.addRule({ field: "merchant", pattern: "Lidl", category: "shopping", priority: 10 });
    await repo.addRule({ field: "merchant_exact", pattern: "Lidl Tikkurila", category: "restaurants", priority: 5 });
    await repo.addRule({ field: "merchant", pattern: "Qwerty", category: "restaurants", priority: 10 });
    await repo.addRule({ field: "description", pattern: "Lidl", category: "restaurants", priority: 10 });
    expect(await one(admin, "Lidl")).toMatchObject({ rule: { category: "shopping" } });

    await admin.call("DELETE", "/api/merchants/rule", { merchant: "Lidl" });
    expect((await repo.listRules()).map((r) => `${r.field}:${r.pattern}`)).toEqual(["merchant_exact:Lidl Tikkurila", "merchant:Qwerty", "description:Lidl"]);
  });

  it("refuses bad input", async () => {
    const { admin } = await withData();
    for (const payload of [{}, { merchant: "" }, { merchant: 5 }, { merchant: "x".repeat(201) }, { merchant: "Lidl", category: "shopping" }]) {
      expect((await admin.call("DELETE", "/api/merchants/rule", payload)).status, JSON.stringify(payload)).toBe(400);
    }
    expect((await admin.call("DELETE", "/api/merchants/rule")).status).toBe(400);
  });
});
