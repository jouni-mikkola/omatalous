import { seriesMarkSubject } from "@banking/core";
import { describe, expect, it } from "vitest";
import { runUpgradeTasks } from "../src/services/upgrade.ts";
import { seedCsv } from "./csv-seed.ts";
import { setupApp } from "./helpers.ts";

/** What the card account writes, and the two names it gets: the one the version before 0.10.0 made of it and today's. */
const TEXT = "Osto FIN Kuopio Kuntosali Ilo Oy Kuopio";
const OLD = "Fin Kuopio Kuntosali Ilo";
const NEW = "Kuntosali Ilo Oy";

/** A year of a monthly charge of 29,90 on the 5th. NOW is 9.10.2026. */
const CSV = [
  "Kirjauspäivä;Määrä;Nimi;Otsikko",
  ...Array.from({ length: 12 }, (_, i) => `${i < 2 ? 2025 : 2026}/${String(((i + 10) % 12) + 1).padStart(2, "0")}/05;-29,90;;${TEXT}`),
].join("\n");

/** Four purchases on a marketplace: the text the bank writes, and the name the version before 0.10.0 made of it. */
const TORI = [
  ["TORI.FI KAYTETTY POLKUPYORA 26", "Tori.Fi Kaytetty Polkupyora 26"],
  ["TORI.FI SOHVA KOLMEN ISTUTTAVA", "Tori.Fi Sohva Kolmen Istuttava"],
  ["TORI.FI LASTEN KIRJAT", "Tori.Fi Lasten Kirjat"],
  ["TORI.FI TALVIRENKAAT", "Tori.Fi Talvirenkaat"],
] as const;
const TORI_CSV = ["Kirjauspäivä;Määrä;Nimi;Otsikko", ...TORI.map(([text], i) => `2026/09/0${i + 1};-${40 + i * 15},00;;${text}`)].join("\n");

describe("a merchant renamed by the card account's wording", () => {
  it("keeps the household's rule by merchant name and its mark on a series working after the first start", async () => {
    const { s, adminId, admin } = await setupApp();
    const repo = s.finance(adminId);
    expect((await seedCsv(s, admin, { content: CSV, accountName: "Käyttötili", accountType: "checking" })).status).toBe(200);
    const fixed = async (): Promise<number> => (await admin.call("GET", "/api/dashboard")).body.fixedMonthlyCents;
    const series = async (): Promise<Parameters<typeof seriesMarkSubject>[0][]> => (await admin.call("GET", "/api/recurring")).body.series;

    const [today] = await series();
    const subject = seriesMarkSubject(today!);
    expect(subject).toMatch(/^series:out:[^:]+:Kuntosali Ilo Oy#2990$/);
    expect(await fixed()).toBe(2990);

    // the rows as the version before stored them, with the household's choices on that name
    await s.db.run("UPDATE transactions SET merchant = ?, category = 'other', category_source = 'default' WHERE user_id = ?", [OLD, adminId]);
    await repo.setMerchantRule(OLD, "gifts");
    expect((await admin.call("PUT", "/api/marks", { subject: subject.replace(NEW, OLD), mark: "cancelled" })).status).toBe(200);

    expect(await runUpgradeTasks(s, "0.10.0+names")).toMatchObject({ users: 1, merchantsRenamed: 12 });

    expect((await repo.allTransactions()).map((t) => `${t.merchant} ${t.category}/${t.categorySource}`)).toEqual(Array(12).fill(`${NEW} gifts/rule`));
    expect((await repo.listRules()).map((r) => r.pattern)).toEqual([NEW]);
    // the mark names the series under its new name, and that series is the one the page lists: it is still cancelled
    expect((await repo.listMarks()).map((m) => [m.subject, m.mark])).toEqual([[subject, "cancelled"]]);
    expect((await series()).map(seriesMarkSubject)).toEqual([subject]);
    expect(await fixed()).toBe(0);
  });

  it("does not spread a rule made on one purchase over the others that get the same name", async () => {
    const { s, adminId, admin } = await setupApp();
    const repo = s.finance(adminId);
    expect((await seedCsv(s, admin, { content: TORI_CSV, accountName: "Käyttötili", accountType: "checking" })).status).toBe(200);
    // the rows as the version before stored them: each purchase a merchant of its own, two of them with the household's rule
    for (const [text, old] of TORI) {
      await s.db.run("UPDATE transactions SET merchant = ?, category = 'other', category_source = 'default' WHERE user_id = ? AND description LIKE ?", [old, adminId, `%${text}%`]);
    }
    for (const [old, category] of [[TORI[0]![1], "gifts"], [TORI[1]![1], "home"]] as const) {
      await repo.setMerchantRule(old, category);
      await s.db.run("UPDATE transactions SET category = ?, category_source = 'rule' WHERE user_id = ? AND merchant = ?", [category, adminId, old]);
    }
    await repo.setMark(`merchant:${TORI[0]![1]}`, "cancelled", "2026-09-05T00:00:00.000Z");
    const state = async () => (await repo.allTransactions()).sort((a, b) => a.bookingDate.localeCompare(b.bookingDate)).map((t) => `${t.merchant} ${t.category}/${t.categorySource}`);

    expect(await runUpgradeTasks(s, "0.10.0+tori")).toMatchObject({ users: 1, merchantsRenamed: 4 });

    // the two the household never sorted stay automatic; its two choices are kept on their own purchase, as its own
    const after = ["Tori gifts/user", "Tori home/user", "Tori other/default", "Tori other/default"];
    expect(await state()).toEqual(after);
    expect(await repo.listRules()).toEqual([]);
    // a mark stays on the name it was made on
    expect((await repo.listMarks()).map((m) => [m.subject, m.mark])).toEqual([[`merchant:${TORI[0]![1]}`, "cancelled"]]);

    // a second run finds nothing to change
    expect(await runUpgradeTasks(s, "0.10.0+tori again")).toMatchObject({ merchantsRenamed: 0, recategorised: 0 });
    expect(await state()).toEqual(after);
    expect(await repo.listRules()).toEqual([]);
  });

  it("settles a rule only onto the rows it can describe: not a row set by hand, not a transfer, no income on money out, no debt category on money in", async () => {
    const { s, adminId, admin } = await setupApp();
    const repo = s.finance(adminId);
    const csv = ["Kirjauspäivä;Määrä;Nimi;Otsikko", ...[-40, -55, 25, -30, -70, 90, 15].map((euros, i) => `2026/09/0${i + 1};${euros},00;;TORI.FI ESIMERKKI ${i + 1}`)].join("\n");
    expect((await seedCsv(s, admin, { content: csv, accountName: "Käyttötili", accountType: "checking" })).status).toBe(200);
    const bike = "Tori.Fi Polkupyora";
    const sofa = "Tori.Fi Sohva";
    const loan = "Tori.Fi Laina";
    // the stored rows: -40 a plain purchase, -55 stored as a transfer, +25 a sale, -30 sorted by hand; -70 and +90 under the second name, +15 under the third
    const stored: [merchant: string, category: string, source: string][] = [
      [bike, "other", "default"],
      [bike, "transfer", "transfer"],
      [bike, "income", "default"],
      [bike, "groceries", "user"],
      [sofa, "other", "default"],
      [sofa, "income", "default"],
      [loan, "income", "default"],
    ];
    const ids = (await repo.allTransactions()).sort((a, b) => a.bookingDate.localeCompare(b.bookingDate)).map((t) => t.id);
    for (const [i, [merchant, category, source]] of stored.entries()) {
      await s.db.run("UPDATE transactions SET merchant = ?, category = ?, category_source = ?, is_transfer = ? WHERE user_id = ? AND id = ?", [merchant, category, source, source === "transfer" ? 1 : 0, adminId, ids[i]!]);
    }
    // a spending category on one name, an income category on the second, a debt category on the third
    await repo.setMerchantRule(bike, "gifts");
    await repo.setMerchantRule(sofa, "salary");
    await repo.setMerchantRule(loan, "loans");
    const state = async () => (await repo.allTransactions()).sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
    const before = await state();

    const settled = await repo.settleMerchantRules(new Set([bike, sofa, loan]));

    const after = await state();
    expect(after.map((t) => `${t.amountCents / 100} ${t.category}/${t.categorySource}${t.isTransfer ? " moved" : ""}`)).toEqual([
      "-40 gifts/user",
      "-55 transfer/transfer moved",
      "25 gifts/user",
      "-30 groceries/user",
      "-70 other/default",
      "90 salary/user",
      "15 income/default",
    ]);
    expect(await repo.listRules()).toEqual([]);
    // the rows the upgrade holds in memory get the same answer as the stored ones
    expect(before.map((t) => settled(t))).toEqual(["gifts", undefined, "gifts", undefined, undefined, "salary", undefined]);
  });
});
