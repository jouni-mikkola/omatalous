import { describe, expect, it } from "vitest";
import { runUpgradeTasks } from "../src/services/upgrade.ts";
import { setupApp } from "./helpers.ts";

const HEADER = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta";
const OWN = "FI12 1234 5600 0785 41";
const file = (...rows: string[]) => [HEADER, ...rows].join("\n");

type Tx = { id: string; merchant: string; category: string; categorySource: string };

describe("merchants nothing categorised", () => {
  const content = file(
    `2026/09/20;-12,00;${OWN};;;XYZZY TUNTEMATON;;EUR`,
    `2026/09/02;-30,00;${OWN};;;XYZZY TUNTEMATON;;EUR`,
    `2026/09/10;-55,50;${OWN};;;QWERTY PUOTI;;EUR`,
    `2026/09/05;-44,15;${OWN};;;LIDL TIKKURILA;;EUR`,
    // money in is not spending
    `2026/09/06;35,00;;${OWN};;XYZZY TUNTEMATON;;EUR`,
  );

  it("lists the user's own uncategorised spending per merchant, biggest first", async () => {
    const { admin, member } = await setupApp();
    await admin.call("POST", "/api/import/csv", { content, accountName: "Käyttötili" });
    const { body } = await admin.call("GET", "/api/merchants/uncategorised");
    expect(body).toEqual({
      items: [
        { merchant: "Qwerty Puoti", totalCents: 5550, count: 1, lastDate: "2026-09-10" },
        { merchant: "Xyzzy Tuntematon", totalCents: 4200, count: 2, lastDate: "2026-09-20" },
      ],
    });

    // another member sees none of it, not even with the account shared
    const eero = await member("eero");
    const accountId = (await admin.call("GET", "/api/meta")).body.accounts[0].id;
    await admin.call("PUT", `/api/accounts/${accountId}/shares/${eero.id}`);
    expect((await eero.call("GET", "/api/merchants/uncategorised")).body).toEqual({ items: [] });
    expect((await eero.call("GET", "/api/merchants/uncategorised?scope=household")).body).toEqual({ items: [] });

    // a rule for the merchant takes it off the list
    await admin.call("POST", "/api/rules", { field: "merchant", pattern: "Qwerty Puoti", category: "shopping" });
    expect((await admin.call("GET", "/api/merchants/uncategorised")).body.items.map((i: { merchant: string }) => i.merchant)).toEqual(["Xyzzy Tuntematon"]);
  });
});

describe("transaction search", () => {
  const content = file(
    `2026/09/20;-12,00;${OWN};;KÄRKKÄINEN TMI;LASKU;;EUR`,
    `2026/09/19;-30,00;${OWN};;;SÖDERSTRÖMIN KUKKA;;EUR`,
    `2026/09/18;-5,00;${OWN};;;ÅLANDSBANKEN MAKSU;;EUR`,
    `2026/09/17;-7,00;${OWN};;;K-MARKET TIKKURILA;;EUR`,
  );
  const search = async (c: { call: (m: string, p: string) => Promise<{ body: { items: Tx[] } }> }, q: string, scope = "") =>
    (await c.call("GET", `/api/transactions?q=${encodeURIComponent(q)}${scope}`)).body.items.map((t) => t.merchant).sort();

  it("ignores case and the dots of ä, ö and å", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/import/csv", { content, accountName: "Käyttötili" });
    for (const q of ["kärkkäinen", "KÄRKKÄINEN", "Karkkainen", "kÄrKkAiNeN tmi"]) expect(await search(admin, q), q).toEqual(["Kärkkäinen Tmi"]);
    for (const q of ["söderström", "SODERSTROM", "Söder"]) expect(await search(admin, q), q).toEqual(["Söderströmin Kukka"]);
    for (const q of ["ålandsbanken", "ALANDS", "Åland"]) expect((await search(admin, q)).length, q).toBe(1);
    expect(await search(admin, "lasku")).toEqual(["Kärkkäinen Tmi"]); // the description counts too
    expect(await search(admin, "k-market")).toHaveLength(1);
    // LIKE wildcards are plain characters
    expect(await search(admin, "%")).toEqual([]);
    expect(await search(admin, "_")).toEqual([]);
    expect(await search(admin, "K_MARKET")).toEqual([]);
  });

  it("finds only the user's own rows, plus shared accounts in the household view", async () => {
    const { admin, member } = await setupApp();
    await admin.call("POST", "/api/import/csv", { content, accountName: "Käyttötili" });
    const eero = await member("eero");
    expect(await search(eero, "kärkkäinen")).toEqual([]);
    expect(await search(eero, "kärkkäinen", "&scope=household")).toEqual([]);
    const accountId = (await admin.call("GET", "/api/meta")).body.accounts[0].id;
    await admin.call("PUT", `/api/accounts/${accountId}/shares/${eero.id}`);
    expect(await search(eero, "kärkkäinen")).toEqual([]);
    expect(await search(eero, "KARKKAINEN", "&scope=household")).toEqual(["Kärkkäinen Tmi"]);
  });

  it("rows stored before the search text existed are filled in by the upgrade", async () => {
    const { admin, s } = await setupApp();
    await admin.call("POST", "/api/import/csv", { content, accountName: "Käyttötili" });
    await s.db.run("UPDATE transactions SET search_text = ''");
    expect(await search(admin, "kärkkäinen")).toEqual([]);
    await runUpgradeTasks(s, "test-build");
    expect(await search(admin, "kärkkäinen")).toEqual(["Kärkkäinen Tmi"]);
  });
});

describe("all of this merchant", () => {
  const content = file(
    `2026/09/20;-25,00;${OWN};;MATTI MEIKÄLÄINEN;;;EUR`,
    `2026/09/12;-25,00;${OWN};;MATTI MEIKÄLÄINEN;;;EUR`,
    `2026/09/02;-10,00;${OWN};;MATTI MEIKÄLÄINEN;;;EUR`,
    `2026/09/15;-15,00;${OWN};;;MOBILEPAY MATTI MEIKÄLÄINEN;;EUR`,
  );

  it("makes an exact-name rule and tells how many rows changed", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/import/csv", { content, accountName: "Käyttötili" });
    const rows = async (): Promise<Tx[]> => (await admin.call("GET", "/api/transactions?limit=50")).body.items;
    const before = await rows();
    const matti = before.filter((t) => t.merchant === "Matti Meikäläinen");
    const mobilepay = before.find((t) => t.merchant === "Mobilepay Matti Meikäläinen")!;
    expect(matti).toHaveLength(3);

    const r = await admin.call("PATCH", `/api/transactions/${matti[0]!.id}`, { category: "gifts_donations", createRule: true });
    expect(r.status).toBe(200);
    expect(r.body.transaction).toMatchObject({ id: matti[0]!.id, category: "gifts_donations", categorySource: "user" });
    expect(r.body.changed).toBe(3);
    expect((await admin.call("GET", "/api/rules")).body.rules).toMatchObject([{ field: "merchant_exact", pattern: "Matti Meikäläinen", category: "gifts_donations" }]);

    const after = await rows();
    expect(after.filter((t) => t.merchant === "Matti Meikäläinen").every((t) => t.category === "gifts_donations")).toBe(true);
    // a longer name that contains it is another merchant
    expect(after.find((t) => t.id === mobilepay.id)).toMatchObject({ category: mobilepay.category, categorySource: mobilepay.categorySource });

    // choosing again replaces the rule; the row picked by hand before keeps its own choice
    const again = await admin.call("PATCH", `/api/transactions/${matti[1]!.id}`, { category: "shopping", createRule: true });
    expect(again.body.changed).toBe(2);
    expect((await rows()).find((t) => t.id === matti[0]!.id)).toMatchObject({ category: "gifts_donations", categorySource: "user" });
    expect((await admin.call("GET", "/api/rules")).body.rules).toMatchObject([{ field: "merchant_exact", category: "shopping" }]);
    expect((await admin.call("PATCH", `/api/transactions/${matti[1]!.id}`, { category: "shopping", createRule: true })).body.changed).toBe(0);
  });

  it("wins over a broader rule made earlier, and replaces an old whole-word rule for the same name", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/import/csv", { content, accountName: "Käyttötili" });
    await admin.call("POST", "/api/rules", { field: "any", pattern: "Meikäläinen", category: "education" });
    await admin.call("POST", "/api/rules", { field: "merchant", pattern: "Matti Meikäläinen", category: "kids" });
    const matti = (await admin.call("GET", "/api/transactions?merchant=Matti%20Meik%C3%A4l%C3%A4inen")).body.items as Tx[];
    expect(matti.every((t) => t.category === "education")).toBe(true);

    const r = await admin.call("PATCH", `/api/transactions/${matti[0]!.id}`, { category: "gifts_donations", createRule: true });
    expect(r.body.changed).toBe(3);
    const rules = (await admin.call("GET", "/api/rules")).body.rules;
    expect(rules.map((x: { field: string; pattern: string }) => `${x.field}:${x.pattern}`).sort()).toEqual(["any:Meikäläinen", "merchant_exact:Matti Meikäläinen"]);
  });

  it("accepts merchant_exact from the rules page", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/import/csv", { content, accountName: "Käyttötili" });
    const r = await admin.call("POST", "/api/rules", { field: "merchant_exact", pattern: "matti meikäläinen", category: "gifts_donations" });
    expect(r).toMatchObject({ status: 200, body: { changed: 3 } });
    expect((await admin.call("POST", "/api/rules", { field: "regex", pattern: "x", category: "gifts_donations" })).status).toBe(400);
  });
});
