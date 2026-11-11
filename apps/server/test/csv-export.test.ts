import { describe, expect, it } from "vitest";
import { csv } from "../src/routes/shared.ts";
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
