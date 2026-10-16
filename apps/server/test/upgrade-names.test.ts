import { categorize, compileRules, type FindingState, normalizeMerchant, seriesMarkSubject } from "@banking/core";
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
    // the two rules chose differently: the new name has none, and the old names keep theirs for a rollback
    expect((await repo.listRules()).map((r) => r.pattern).sort()).toEqual([TORI[0]![1], TORI[1]![1]].sort());
    // a mark made on one of four names is a choice the others did not make: it stays on its own name
    expect((await repo.listMarks()).map((m) => [m.subject, m.mark])).toEqual([[`merchant:${TORI[0]![1]}`, "cancelled"]]);

    // a second run finds nothing to change
    expect(await runUpgradeTasks(s, "0.10.0+tori again")).toMatchObject({ merchantsRenamed: 0, recategorised: 0 });
    expect(await state()).toEqual(after);
    expect((await repo.listRules()).map((r) => r.pattern).sort()).toEqual([TORI[0]![1], TORI[1]![1]].sort());
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

  it("makes one payee of three spellings of a company and keeps the household's category on the rows it chose it for", async () => {
    const { s, adminId, admin } = await setupApp();
    const repo = s.finance(adminId);
    const spellings = [
      ["VEIKKAUS OY", "Veikkaus Oy"],
      ["VEIKKAUS OY PELITILI", "Veikkaus Oy Pelitili"],
      ["VEIKKAUS.FI", "Veikkaus.Fi"],
    ] as const;
    const csv = ["Kirjauspäivä;Määrä;Nimi;Otsikko", ...spellings.flatMap(([text], i) => [1, 2].map((n) => `2026/09/0${i * 2 + n};-${10 + i * 2 + n},00;;${text}`))].join("\n");
    expect((await seedCsv(s, admin, { content: csv, accountName: "Käyttötili", accountType: "checking" })).status).toBe(200);
    // the rows as the version before stored them, one spelling each; the household sorted the first spelling
    for (const [text, old] of spellings) {
      await s.db.run("UPDATE transactions SET merchant = ?, category = 'other', category_source = 'default' WHERE user_id = ? AND description LIKE ?", [old, adminId, `%${text}%`]);
    }
    await repo.setMerchantRule(spellings[0][1], "gifts");
    await s.db.run("UPDATE transactions SET category = 'gifts', category_source = 'rule' WHERE user_id = ? AND merchant = ?", [adminId, spellings[0][1]]);
    const state = async () => (await repo.allTransactions()).sort((a, b) => a.bookingDate.localeCompare(b.bookingDate)).map((t) => `${t.merchant} ${t.category}/${t.categorySource}`);

    expect(await runUpgradeTasks(s, "0.14.0+veikkaus")).toMatchObject({ users: 1, merchantsRenamed: 6 });

    const after = await state();
    // one payee; the choice on one spelling of three covers the rows of that spelling only, and the rule stays on its name
    expect(new Set(after.map((line) => line.split(" ")[0]))).toEqual(new Set(["Veikkaus"]));
    expect(after).toEqual([...Array(2).fill("Veikkaus gifts/user"), ...Array(4).fill("Veikkaus gambling/rule")]);
    expect((await repo.listRules()).map((r) => [r.pattern, r.category])).toEqual([["Veikkaus Oy", "gifts"]]);

    // a second run finds nothing to change
    expect(await runUpgradeTasks(s, "0.14.0+veikkaus again")).toMatchObject({ merchantsRenamed: 0, recategorised: 0 });
    expect(await state()).toEqual(after);
  });
});

describe("one card issuer under three names: what the household chose on the old names follows", () => {
  const TEXTS = [
    ["MORROW BANK ASA", "Morrow Bank Asa"],
    ["MORROW BANK AB", "Morrow Bank Ab"],
    ["MORROW BANK ASA FILIAL I FINLAND", "Morrow Bank Asa Filial I"],
  ] as const;
  const NEW_NAME = "Morrow Bank";
  const CARD_CSV = ["Kirjauspäivä;Määrä;Nimi;Otsikko", ...TEXTS.flatMap(([text], i) => [1, 2].map((n) => `2026/09/0${i * 2 + n};-${100 + i * 20 + n},00;;${text}`))].join("\n");
  /** The rows as the version before stored them, one spelling each, with the household's rules and marks on the old names. */
  async function oldHousehold(rules: readonly (readonly [string, string])[], marks: readonly (readonly [string, "cancelled" | "dismissed"])[]) {
    const { s, adminId, admin } = await setupApp();
    const repo = s.finance(adminId);
    expect((await seedCsv(s, admin, { content: CARD_CSV, accountName: "Käyttötili", accountType: "checking" })).status).toBe(200);
    for (const [text, old] of TEXTS) {
      await s.db.run("UPDATE transactions SET merchant = ?, category = 'other', category_source = 'default' WHERE user_id = ? AND description LIKE ?", [old, adminId, `%${text}`]);
    }
    for (const [old, category] of rules) {
      await repo.setMerchantRule(old, category);
      await s.db.run("UPDATE transactions SET category = ?, category_source = 'rule' WHERE user_id = ? AND merchant = ?", [category, adminId, old]);
    }
    for (const [old, mark] of marks) await repo.setMark(`merchant:${old}`, mark, "2026-09-05T00:00:00.000Z");
    const rows = async () => (await repo.allTransactions()).sort((a, b) => a.bookingDate.localeCompare(b.bookingDate)).map((t) => `${t.merchant} ${t.category}/${t.categorySource}`);
    return { s, repo, rows };
  }
  const decision = (name: string, until: string): FindingState => ({ findingId: `subscriptions:cheaper:${name}`, status: "snoozed", reason: null, until, effectiveDate: null, midCents: 5000, baseline: null, decidedAt: "2026-09-05T00:00:00.000Z" });
  const ruleList = async (repo: Awaited<ReturnType<typeof oldHousehold>>["repo"]) => (await repo.listRules()).map((r) => [r.pattern, r.category]).sort();

  /** Rows of made-up bills under the names the version before stored, the household's rules on names, and the run. */
  async function seeded(rows: readonly (readonly [text: string, old: string, euros: number])[], rules: readonly (readonly [string, string])[]) {
    const { s, adminId, admin } = await setupApp();
    const repo = s.finance(adminId);
    const csv = ["Kirjauspäivä;Määrä;Nimi;Otsikko", ...rows.map(([text, , euros], i) => `2026/0${(i % 8) + 1}/05;-${euros},00;;${text}`)].join("\n");
    expect((await seedCsv(s, admin, { content: csv, accountName: "Käyttötili", accountType: "checking" })).status).toBe(200);
    const ids = (await repo.allTransactions()).sort((a, b) => a.bookingDate.localeCompare(b.bookingDate)).map((t) => t.id);
    for (const [i, [, old]] of rows.entries()) {
      await s.db.run("UPDATE transactions SET merchant = ?, category = 'other', category_source = 'default' WHERE user_id = ? AND id = ?", [old, adminId, ids[i]!]);
    }
    for (const [old, category] of rules) {
      await repo.setMerchantRule(old, category);
      await s.db.run("UPDATE transactions SET category = ?, category_source = 'rule' WHERE user_id = ? AND merchant = ?", [category, adminId, old]);
    }
    const state = async () => (await repo.allTransactions()).sort((a, b) => a.bookingDate.localeCompare(b.bookingDate)).map((t) => `${t.merchant} ${t.category}/${t.categorySource}`);
    return { s, repo, state };
  }
  /** Runs the upgrade and again: the second run changes no row, rule, mark or decision. */
  async function upgradeTwice({ s, repo, state }: Awaited<ReturnType<typeof seeded>>, build: string) {
    expect(await runUpgradeTasks(s, `${build}+first`)).toMatchObject({ users: 1 });
    const [rules, marks, states, rows] = [await ruleList(repo), await repo.listMarks(), await repo.listStates(), await state()];
    expect(await runUpgradeTasks(s, `${build}+again`)).toMatchObject({ merchantsRenamed: 0, recategorised: 0 });
    expect(await ruleList(repo)).toEqual(rules);
    expect(await repo.listMarks()).toEqual(marks);
    expect(await repo.listStates()).toEqual(states);
    expect(await state()).toEqual(rows);
    return rows;
  }

  it("when every old name chose the same, it is the new name's rule, mark and decision, a bill that comes later is sorted by it, and the old keys stay", async () => {
    const h = await oldHousehold(TEXTS.map(([, old]) => [old, "gifts"] as const), TEXTS.map(([, old]) => [old, "cancelled"] as const));
    for (const [, old] of TEXTS) await h.repo.setState(decision(old, "2027-01-01"));
    expect(await runUpgradeTasks(h.s, "0.60.0+issuers")).toMatchObject({ users: 1, merchantsRenamed: 6 });
    expect(await h.rows()).toEqual(Array(6).fill(`${NEW_NAME} gifts/rule`));
    expect(await ruleList(h.repo)).toEqual([[NEW_NAME, "gifts"], ...TEXTS.map(([, old]) => [old, "gifts"])].sort());
    expect((await h.repo.listMarks()).map((m) => m.subject).sort()).toEqual([`merchant:${NEW_NAME}`, ...TEXTS.map(([, old]) => `merchant:${old}`)].sort());
    expect((await h.repo.listStates()).map((x) => x.findingId).sort()).toEqual([`subscriptions:cheaper:${NEW_NAME}`, ...TEXTS.map(([, old]) => `subscriptions:cheaper:${old}`)].sort());
    // the next bill is read as the new name and meets the rule
    const rule = (await h.repo.listRules()).find((r) => r.pattern === NEW_NAME)!;
    expect(categorize({ merchant: normalizeMerchant(null, "MORROW BANK ASA"), counterparty: null, description: null, mcc: null, amountCents: -12_000 }, compileRules([rule])).category).toBe("gifts");

    // a second run changes nothing
    const [rulesBefore, marksBefore, statesBefore] = [await ruleList(h.repo), await h.repo.listMarks(), await h.repo.listStates()];
    expect(await runUpgradeTasks(h.s, "0.60.0+issuers again")).toMatchObject({ merchantsRenamed: 0, recategorised: 0 });
    expect(await ruleList(h.repo)).toEqual(rulesBefore);
    expect(await h.repo.listMarks()).toEqual(marksBefore);
    expect(await h.repo.listStates()).toEqual(statesBefore);
    expect(await h.rows()).toEqual(Array(6).fill(`${NEW_NAME} gifts/rule`));
  });

  it("a choice on one old name only is the new name's none: it covers its own rows, and the names without it keep their category", async () => {
    const { s, repo, rows } = await oldHousehold([[TEXTS[0][1], "gifts"]], [[TEXTS[1][1], "cancelled"]]);
    await repo.setState(decision(TEXTS[2][1], "2027-01-01"));
    expect(await runUpgradeTasks(s, "0.60.0+one")).toMatchObject({ users: 1, merchantsRenamed: 6 });
    expect(await rows()).toEqual([...Array(2).fill(`${NEW_NAME} gifts/user`), ...Array(4).fill(`${NEW_NAME} card_bill/rule`)]);
    expect(await ruleList(repo)).toEqual([[TEXTS[0][1], "gifts"]]);
    expect((await repo.listMarks()).map((m) => m.subject)).toEqual([`merchant:${TEXTS[1][1]}`]);
    expect((await repo.listStates()).map((x) => x.findingId)).toEqual([`subscriptions:cheaper:${TEXTS[2][1]}`]);
    const [rulesBefore, rowsBefore] = [await ruleList(repo), await rows()];
    expect(await runUpgradeTasks(s, "0.60.0+one again")).toMatchObject({ merchantsRenamed: 0, recategorised: 0 });
    expect(await ruleList(repo)).toEqual(rulesBefore);
    expect(await rows()).toEqual(rowsBefore);
  });

  it("a rule on the plain name does not reach the bank's bills, which had none", async () => {
    const h = await seeded([["MORROW", "Morrow", 45], ["MORROW", "Morrow", 46], ["MORROW BANK ASA", "Morrow Bank Asa", 400], ["MORROW BANK ASA", "Morrow Bank Asa", 410]], [["Morrow", "gifts"]]);
    const rows = await upgradeTwice(h, "0.60.0+plain");
    // the two rows the household sorted keep their category; the bills are still card bills
    expect(rows.sort()).toEqual(["Morrow Bank card_bill/rule", "Morrow Bank card_bill/rule", "Morrow Bank gifts/user", "Morrow Bank gifts/user"]);
    expect(await ruleList(h.repo)).toEqual([["Morrow", "gifts"]]);
  });

  it("the new name's own rule stays when an old name chose differently, and so do its rows", async () => {
    const h = await seeded([["MORROW BANK", "Morrow Bank", 300], ["MORROW BANK", "Morrow Bank", 310], ["MORROW BANK ASA", "Morrow Bank Asa", 400], ["MORROW BANK ASA", "Morrow Bank Asa", 410]], [["Morrow Bank", "loans"], ["Morrow Bank Asa", "gifts"]]);
    const rows = await upgradeTwice(h, "0.60.0+own");
    expect(await ruleList(h.repo)).toEqual([["Morrow Bank", "loans"], ["Morrow Bank Asa", "gifts"]].sort());
    expect(rows.sort()).toEqual(["Morrow Bank gifts/user", "Morrow Bank gifts/user", "Morrow Bank loans/rule", "Morrow Bank loans/rule"]);
  });

  it("old names that chose differently give the new name no rule and no mark, and each keeps its rows as the household set them", async () => {
    const { s, repo, rows } = await oldHousehold([[TEXTS[0][1], "gifts"], [TEXTS[1][1], "home"]], [[TEXTS[0][1], "cancelled"], [TEXTS[1][1], "dismissed"]]);
    await repo.setState(decision(TEXTS[0][1], "2027-01-01"));
    await repo.setState(decision(TEXTS[1][1], "2027-02-01"));
    expect(await runUpgradeTasks(s, "0.60.0+conflict")).toMatchObject({ users: 1, merchantsRenamed: 6 });
    expect(await rows()).toEqual([...Array(2).fill(`${NEW_NAME} gifts/user`), ...Array(2).fill(`${NEW_NAME} home/user`), ...Array(2).fill(`${NEW_NAME} card_bill/rule`)]);
    // the old rules stay for a rollback; the new name has none
    expect(await ruleList(repo)).toEqual([[TEXTS[0][1], "gifts"], [TEXTS[1][1], "home"]].sort());
    expect((await repo.listMarks()).map((m) => m.subject).sort()).toEqual([`merchant:${TEXTS[0][1]}`, `merchant:${TEXTS[1][1]}`].sort());
    expect((await repo.listStates()).map((x) => x.findingId).sort()).toEqual([`subscriptions:cheaper:${TEXTS[0][1]}`, `subscriptions:cheaper:${TEXTS[1][1]}`].sort());

    const [rulesBefore, marksBefore, rowsBefore] = [await ruleList(repo), await repo.listMarks(), await rows()];
    expect(await runUpgradeTasks(s, "0.60.0+conflict again")).toMatchObject({ merchantsRenamed: 0, recategorised: 0 });
    expect(await ruleList(repo)).toEqual(rulesBefore);
    expect(await repo.listMarks()).toEqual(marksBefore);
    expect(await rows()).toEqual(rowsBefore);
  });

  it("makes one payee of a foreign merchant's card texts, the fee line included, and the rule every old name had is the new name's", async () => {
    const { s, adminId, admin } = await setupApp();
    const repo = s.finance(adminId);
    const forms = [
      ["USD IRL DUBLIN ANTHROPIC", "Usd Irl Dublin Anthropic", "2026/09/01", "10,00"],
      ["SAN FRANCISCO ANTHROPIC PRO", "San Francisco Anthropic Pro", "2026/09/02", "11,00"],
      ["ANTHROPIC", "Anthropic", "2026/09/03", "12,00"],
      ["USD USA SAN FRANCISCO", "Usd Usa San Francisco", "2026/09/01", "10,00"],
    ] as const;
    const csv = ["Kirjauspäivä;Määrä;Nimi;Otsikko", ...forms.map(([text, , day, sum]) => `${day};-${sum};;${text}`)].join("\n");
    expect((await seedCsv(s, admin, { content: csv, accountName: "Käyttötili", accountType: "checking" })).status).toBe(200);
    // the rows as the version before stored them, a name each, and the household's rule on every one of them
    for (const [text, old] of forms) {
      await s.db.run("UPDATE transactions SET merchant = ?, category = 'gifts', category_source = 'rule' WHERE user_id = ? AND description LIKE ?", [old, adminId, `%${text}%`]);
      await repo.setMerchantRule(old, "gifts");
    }

    expect(await runUpgradeTasks(s, "0.14.0+anthropic")).toMatchObject({ users: 1 });

    expect((await repo.allTransactions()).map((t) => `${t.merchant} ${t.category}`)).toEqual(Array(4).fill("Anthropic gifts"));
    expect((await repo.listRules()).map((r) => [r.pattern, r.category])).toContainEqual(["Anthropic", "gifts"]);
  });
});
