import { describe, expect, it } from "vitest";
import { csv } from "../src/routes/shared.ts";
import { seedCsv } from "./csv-seed.ts";
import { setupApp } from "./helpers.ts";

describe("csv()", () => {
  it("writes Excel-friendly Finnish CSV", () => {
    const out = csv([["Nimi", "Summa"], ["Kahvila; Oy", 12.5], ['Sanoi "moi"', null]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toContain('"Kahvila; Oy";12,5');
    expect(out).toContain('"Sanoi ""moi""";');
  });

  it("neutralises spreadsheet formulas in text cells", () => {
    expect(csv([["=HYPERLINK(\"x\")", "+1", "-2", "@cmd"]])).toContain("'=HYPERLINK");
    expect(csv([["+1"]])).toContain("'+1");
    expect(csv([[-2]])).toContain("-2"); // numbers stay numbers
  });
});

describe("report CSV by name", () => {
  const url = (report: string) => `/api/export/report.csv?${report}from=2026-01-01&to=2026-10-09`;

  it("answers the three known reports, and the month table when none is named", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    const file = (r: { res: Response }) => r.res.headers.get("content-disposition");
    const absent = await admin.call("GET", url(""));
    const pivot = await admin.call("GET", url("report=pivot&"));
    expect(absent.status).toBe(200);
    expect(file(absent)).toBe('attachment; filename="kuukausitaulukko_2026-01-01_2026-10-09.csv"');
    expect(file(pivot)).toBe(file(absent));
    expect(pivot.body).toBe(absent.body);
    expect(pivot.body.startsWith("Kategoria;Ryhmä;")).toBe(true);
    const categories = await admin.call("GET", url("report=categories&"));
    expect(file(categories)).toBe('attachment; filename="kategoriat_2026-01-01_2026-10-09.csv"');
    expect(categories.body.startsWith("Ryhmä;Kategoria;")).toBe(true);
    const cashflow = await admin.call("GET", url("report=cashflow&"));
    expect(file(cashflow)).toBe('attachment; filename="kassavirta_2026-01-01_2026-10-09.csv"');
    expect(cashflow.body.startsWith("Kuukausi;Tulot €;")).toBe(true);
  });

  it("refuses an unknown report with 400 and no file", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    for (const report of ["report=months&", "report=&", "report=Pivot&", "report=categories%20&"]) {
      const r = await admin.call("GET", url(report));
      expect(r.status).toBe(400);
      expect(r.body.messageCode).toBe("check.report");
      expect(r.res.headers.get("content-disposition")).toBeNull();
      expect(r.res.headers.get("content-type")).toContain("json");
    }
  });
});

describe("report CSV without a complete month", () => {
  const rows = (body: string) =>
    body
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split(";"));

  it("writes empty cells for the averages of the running month, and numbers once a month is complete", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    // 1.-9.10.2026: only the running month, so no category has a monthly average, lowest or highest month
    const running = rows((await admin.call("GET", "/api/export/report.csv?report=categories&from=2026-10-01&to=2026-10-09")).body);
    expect(running[0]!.slice(6, 9)).toEqual(["Keskimäärin kuussa €", "Pienin kuukausi €", "Suurin kuukausi €"]);
    expect(running[0]).not.toContain("Tavallisesti kuussa €");
    expect(running.length).toBeGreaterThan(1);
    for (const row of running.slice(1)) expect(row.slice(6, 9)).toEqual(["", "", ""]);
    const pivot = rows((await admin.call("GET", "/api/export/report.csv?report=pivot&from=2026-10-01&to=2026-10-09")).body);
    for (const row of pivot.slice(1, -1)) expect(row.at(-1)).toBe("");

    const month = rows((await admin.call("GET", "/api/export/report.csv?report=categories&from=2026-09-01&to=2026-09-30")).body);
    for (const row of month.slice(1)) expect(row.slice(6, 9).every((c) => c !== "")).toBe(true);
  });
});

describe("the report files in the member's language", () => {
  const url = (report: string) => `/api/export/report.csv?report=${report}&from=2026-01-01&to=2026-10-09`;
  const MONTHS = "2026-01;2026-02;2026-03;2026-04;2026-05;2026-06;2026-07;2026-08;2026-09;2026-10";
  const FI = {
    pivot: { file: "kuukausitaulukko_", heading: `Kategoria;Ryhmä;${MONTHS};Yhteensä €;Keskiarvo €` },
    categories: { file: "kategoriat_", heading: "Ryhmä;Kategoria;Yhteensä €;Osuus %;Ostoja;Keskiostos €;Keskimäärin kuussa €;Pienin kuukausi €;Suurin kuukausi €;Edellinen jakso €;Muutos 3 kuukaudessa %" },
    cashflow: { file: "kassavirta_", heading: "Kuukausi;Tulot €;Kulutus €;Velanhoito €;Säästöön €;Luotonnostot €;Erotus €;Säästöaste %;Tulos €" },
  };
  const EN = {
    pivot: { file: "month-table_", heading: `Category;Group;${MONTHS};Total €;Average €` },
    categories: { file: "categories_", heading: "Group;Category;Total €;Share %;Purchases;Average purchase €;Average per month €;Lowest month €;Highest month €;Previous period €;Change in 3 months %" },
    cashflow: { file: "cashflow_", heading: "Month;Income €;Consumption €;Debt service €;To savings €;Credit drawn €;Difference €;Savings rate %;Result €" },
  };
  const KINDS = ["pivot", "categories", "cashflow"] as const;
  const lines = (body: string) => body.replace(/^﻿/, "").split("\r\n").filter(Boolean);
  const cells = (body: string) => lines(body).map((line) => line.split(";"));
  const fileOf = (r: { res: Response }) => r.res.headers.get("content-disposition");

  it("is Finnish for a member who reads Finnish: the headings, the names, the sum row and the file names as before", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    for (const kind of KINDS) {
      const r = await admin.call("GET", url(kind));
      expect(fileOf(r)).toBe(`attachment; filename="${FI[kind].file}2026-01-01_2026-10-09.csv"`);
      expect(lines(r.body)[0]).toBe(FI[kind].heading);
    }
    const pivot = cells((await admin.call("GET", url("pivot"))).body);
    expect(pivot.some((row) => row[0] === "Ruokakauppa" && row[1] === "Ruoka")).toBe(true);
    expect(pivot.at(-1)!.slice(0, 2)).toEqual(["Yhteensä", ""]);
    const categories = cells((await admin.call("GET", url("categories"))).body);
    expect(categories.some((row) => row[0] === "Ruoka" && row[1] === "Ruokakauppa")).toBe(true);
  });

  it("is English for a member who reads English: the headings, the names, the sum row and the file names", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    const fi = Object.fromEntries(await Promise.all(KINDS.map(async (kind) => [kind, cells((await admin.call("GET", url(kind))).body)] as const)));
    await admin.call("PUT", "/api/language", { language: "en" });
    const en: Record<string, string[][]> = {};
    for (const kind of KINDS) {
      const r = await admin.call("GET", url(kind));
      expect(fileOf(r)).toBe(`attachment; filename="${EN[kind].file}2026-01-01_2026-10-09.csv"`);
      expect(lines(r.body)[0]).toBe(EN[kind].heading);
      en[kind] = cells(r.body);
      // the same rows in the same order as the Finnish file
      expect(en[kind]!.length).toBe(fi[kind]!.length);
    }
    // no heading cell is left in Finnish; a month is the same cell in both files
    for (const kind of KINDS) for (const cell of en[kind]![0]!) expect(FI[kind].heading.split(";").filter((c) => !/^\d{4}-\d{2}$/.test(c))).not.toContain(cell);

    // the month table: English names, the numbers of the Finnish file, the sum row "Total"
    const pivot = en.pivot!;
    expect(pivot.some((row) => row[0] === "Groceries" && row[1] === "Food")).toBe(true);
    expect(pivot.at(-1)!.slice(0, 2)).toEqual(["Total", ""]);
    for (const [i, row] of pivot.slice(1).entries()) expect(row.slice(2)).toEqual(fi.pivot![i + 1]!.slice(2));
    const same = (table: string[][], before: string[][], col: number) => [...new Set(table.slice(1).filter((row, i) => row[col] !== "" && row[col] === before[i + 1]![col]).map((row) => row[col]))];
    expect(same(pivot.slice(0, -1), fi.pivot!, 0)).toEqual([]);
    expect(same(pivot.slice(0, -1), fi.pivot!, 1)).toEqual([]);

    // the categories: every group and category of the example data has an English name, the numbers are the same
    const categories = en.categories!;
    expect(categories.some((row) => row[0] === "Food" && row[1] === "Groceries")).toBe(true);
    expect(same(categories, fi.categories!, 0)).toEqual([]);
    expect(same(categories, fi.categories!, 1)).toEqual([]);
    for (const [i, row] of categories.slice(1).entries()) expect(row.slice(2)).toEqual(fi.categories![i + 1]!.slice(2));

    // the cash flow has only numbers under its headings: they are the Finnish file's
    expect(en.cashflow!.slice(1)).toEqual(fi.cashflow!.slice(1));
  });
});

describe("the rows file in the member's language", () => {
  const url = "/api/export/transactions.csv?from=2026-01-01&to=2026-10-09";
  const FI_HEADING = ["Päivä", "Tili", "Kauppias", "Saaja/maksaja", "Viesti", "Kategoria", "Ryhmä", "Summa €", "Tila", "Lähde", "Siirto"];
  const EN_HEADING = ["Date", "Account", "Merchant", "Payee/payer", "Message", "Category", "Group", "Amount €", "State", "Source", "Transfer"];
  const rows = (body: string) =>
    body
      .replace(/^\uFEFF/, "")
      .split("\r\n")
      .filter(Boolean)
      .map((line) => line.split(";"));
  /** The cells of the row with this message: category, group, state, source, transfer. */
  const words = (table: string[][], message: string) => {
    const row = table.find((r) => r[4] === message)!;
    return [row[5], row[6], row[8], row[9], row[10]];
  };

  /** The example data, with four rows marked so every word of the file is on a known row. */
  async function marked() {
    const app = await setupApp();
    await app.admin.call("POST", "/api/demo");
    const pick = async (where: string) => (await app.db.first<{ id: string }>(`SELECT id FROM transactions WHERE user_id = ? AND booking_date BETWEEN '2026-01-01' AND '2026-10-09' AND ${where} LIMIT 1`, [app.adminId]))!.id;
    const booked = "status = 'booked' AND is_transfer = 0 AND description NOT LIKE 'S7 %'";
    await app.db.run("UPDATE transactions SET description = 'S7 pending', category = 'groceries' WHERE id = ?", [await pick("status = 'pending'")]);
    await app.db.run("UPDATE transactions SET description = 'S7 transfer' WHERE id = ?", [await pick("status = 'booked' AND is_transfer = 1")]);
    await app.db.run("UPDATE transactions SET description = 'S7 bank', category = 'groceries', source = 'enablebanking' WHERE id = ?", [await pick(booked)]);
    await app.db.run("UPDATE transactions SET description = 'S7 file', category = 'no_such_category', source = 'csv' WHERE id = ?", [await pick(booked)]);
    return app;
  }

  it("is Finnish for a member who reads Finnish, the same words and file name as before", async () => {
    const { admin } = await marked();
    const r = await admin.call("GET", url);
    expect(r.res.headers.get("content-disposition")).toBe('attachment; filename="tapahtumat_2026-01-01_2026-10-09.csv"');
    expect(r.body.startsWith("Päivä;Tili;Kauppias;Saaja/maksaja;Viesti;Kategoria;Ryhmä;Summa €;Tila;Lähde;Siirto\r\n")).toBe(true);
    const table = rows(r.body);
    expect(table[0]).toEqual(FI_HEADING);
    expect(words(table, "S7 pending")).toEqual(["Ruokakauppa", "Ruoka", "varaus", "esimerkki", ""]);
    expect(words(table, "S7 bank")).toEqual(["Ruokakauppa", "Ruoka", "kirjattu", "pankki", ""]);
    expect(words(table, "S7 file")).toEqual(["no_such_category", "Muut", "kirjattu", "tiedosto", ""]);
    expect(words(table, "S7 transfer").slice(2)).toEqual(["kirjattu", "esimerkki", "kyllä"]);
  });

  it("is English for a member who reads English: the heading row, the words, the names and the file name", async () => {
    const { admin } = await marked();
    const fi = rows((await admin.call("GET", url)).body);
    await admin.call("PUT", "/api/language", { language: "en" });
    const r = await admin.call("GET", url);
    expect(r.res.headers.get("content-disposition")).toBe('attachment; filename="transactions_2026-01-01_2026-10-09.csv"');
    const en = rows(r.body);
    expect(en[0]).toEqual(EN_HEADING);
    for (const cell of en[0]!) expect(FI_HEADING).not.toContain(cell);
    expect(words(en, "S7 pending")).toEqual(["Groceries", "Food", "pending", "example", ""]);
    expect(words(en, "S7 bank")).toEqual(["Groceries", "Food", "booked", "bank", ""]);
    expect(words(en, "S7 file")).toEqual(["no_such_category", "Other", "booked", "file", ""]);
    expect(words(en, "S7 transfer").slice(2)).toEqual(["booked", "example", "yes"]);

    // the same rows in the same order; only the words differ, and no Finnish word of the file is left in a word column
    expect(en.length).toBe(fi.length);
    const finnish = new Set(["varaus", "kirjattu", "pankki", "tiedosto", "esimerkki", "kyllä"]);
    for (const [i, row] of en.slice(1).entries()) {
      const before = fi[i + 1]!;
      expect([row[0], row[4], row[7]]).toEqual([before[0], before[4], before[7]]);
      for (const cell of [row[8], row[9], row[10]]) expect(finnish.has(cell!), cell).toBe(false);
    }
    // every category and group of the example data has an English name
    const changed = (col: number) => en.slice(1).filter((row, i) => row[4] !== "S7 file" && row[col] === fi[i + 1]![col]).map((row) => row[col]);
    expect([...new Set(changed(5))]).toEqual([]);
    expect([...new Set(changed(6))]).toEqual([]);
  });
});

describe("the report files hold every month of the range", () => {
  const seed = async () => {
    const app = await setupApp();
    await seedCsv(app.s, app.admin, {
      content: ["Kirjauspäivä;Määrä;Nimi;Otsikko", "2023/05/10;-77,00;Ruokakauppa;Ostos", "2026/09/10;-1,00;Ruokakauppa;Ostos"].join("\n"),
      accountName: "Käyttötili",
      accountType: "checking",
    });
    return app;
  };
  const table = (body: string) => body.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean).map((line) => line.split(";"));
  const num = (s: string) => Number(s.replace(",", "."));
  const MONTHS = 41;

  it("writes a column for each of the 41 months of the month table, and the cells add up to the totals", async () => {
    const { admin } = await seed();
    for (const lang of ["fi", "en"]) {
      await admin.call("PUT", "/api/language", { language: lang });
      const rows = table((await admin.call("GET", "/api/export/report.csv?report=pivot&from=2023-01-01&to=2026-09-30")).body);
      const head = rows[0]!;
      const months = head.filter((c) => /^\d{4}-\d{2}$/.test(c));
      expect(months).toHaveLength(MONTHS);
      expect(months[0]).toBe("2023-05");
      expect(months.at(-1)).toBe("2026-09");
      for (const row of rows.slice(1)) {
        const cells = row.slice(2, 2 + MONTHS).map(num);
        const total = num(row[2 + MONTHS]!);
        expect(cells.reduce((s, v) => s + v, 0)).toBeCloseTo(total, 2);
      }
      expect(num(rows.at(-1)![2 + MONTHS]!)).toBeCloseTo(78, 2);
      expect(num(rows.at(-1)![2]!)).toBeCloseTo(77, 2);
    }
  });

  it("writes a cash flow row for each of the 41 months with 77 in May 2023, in both languages", async () => {
    const { admin } = await seed();
    for (const lang of ["fi", "en"]) {
      await admin.call("PUT", "/api/language", { language: lang });
      const rows = table((await admin.call("GET", "/api/export/report.csv?report=cashflow&from=2023-01-01&to=2026-09-30")).body);
      expect(rows).toHaveLength(MONTHS + 1);
      expect(rows[1]![0]).toBe("2023-05");
      expect(num(rows[1]![2]!)).toBeCloseTo(77, 2);
      expect(rows.at(-1)![0]).toBe("2026-09");
    }
  });

  it("keeps 24 months or fewer as they were", async () => {
    const { admin } = await seed();
    const rows = table((await admin.call("GET", "/api/export/report.csv?report=cashflow&from=2024-10-01&to=2026-09-30")).body);
    expect(rows).toHaveLength(25);
    expect(rows[1]![0]).toBe("2024-10");
  });
});
