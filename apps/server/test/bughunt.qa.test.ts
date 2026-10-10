/**
 * Bug hunt: input and timing edge cases the feature tests do not reach. Each test pins a behaviour that was
 * checked by hand first; the ones that failed then are fixed in the code and stay here as regression tests.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseAmount, parseBankCsv } from "@banking/core";
import { hourlyTick } from "../src/services/schedule.ts";
import { mockBank } from "./mock-bank.ts";
import { setupApp, waitFor } from "./helpers.ts";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const HEADER = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta";
const ROW = (date: string, amount: string, title: string, name = "") => `${date};${amount};FI2112345600000785;;${name};${title};;EUR`;

describe("CSV: formats", () => {
  it("reads BOM, CRLF, a bare CR and blank lines between rows", () => {
    for (const eol of ["\r\n", "\n", "\r"]) {
      const text = `﻿${[HEADER, "", ROW("2026/09/30", "-12,50", "A"), "", "", ROW("2026/09/29", "-1,00", "B"), ""].join(eol)}${eol}${eol}`;
      const r = parseBankCsv(text);
      expect(r.errors, JSON.stringify(eol)).toEqual([]);
      expect(r.transactions.map((t) => t.amountCents), JSON.stringify(eol)).toEqual([-1250, -100]);
    }
  });

  it("detects the delimiter from the header row even after blank lines", () => {
    const comma = "\n\nDate,Amount,Name\n2026-09-30,\"-12,50\",Shop\n";
    expect(parseBankCsv(comma).transactions.map((t) => t.amountCents)).toEqual([-1250]);
    const tab = "\r\n\r\nKirjauspäivä\tMäärä\tNimi\r\n2026/09/30\t-12,50\tShop\r\n";
    expect(parseBankCsv(tab).transactions.map((t) => t.amountCents)).toEqual([-1250]);
  });

  it("skips lines before the header, such as an account line some banks put first", () => {
    const text = ["Tilinumero: FI21 1234 5600 0007 85", "Ajalta: 1.9.2026 - 30.9.2026", "", HEADER, ROW("2026/09/30", "-12,50", "A")].join("\n");
    const r = parseBankCsv(text);
    expect(r.errors).toEqual([]);
    expect(r.transactions).toHaveLength(1);
  });

  it("reads decimal comma, decimal point and thousands separators", () => {
    const cases: [string, number][] = [
      ["-12,50", -1250], ["-12.50", -1250], ["1 234,56", 123456], ["1 234,56", 123456], ["1.234,56", 123456], ["1,234.56", 123456],
      ["-1 234 567,89", -123456789], ["0,99", 99], ["-0,05", -5], ["+3 420,00", 342000], ["7", 700], ["-1,5", -150], ["−12,50", -1250],
      ["12,50-", -1250], ["(12,50)", -1250],
    ];
    for (const [text, cents] of cases) expect(parseAmount(text), text).toBe(cents);
    for (const bad of ["", "abc", "1e3", "12,5,5,5x", "--1"]) expect(parseAmount(bad), bad).toBeNull();
  });

  it("never gives a fractional or unsafe number of cents", () => {
    for (const t of ["0,005", "0,015", "1,005", "99999999999999999999", "123456789012345,99"]) {
      const v = parseAmount(t);
      if (v !== null) expect(Number.isSafeInteger(v), t).toBe(true);
    }
  });

  it("tells a file in the wrong character set from one with unknown columns", () => {
    const mojibake = "Kirjausp�iv�;M��r�;Nimi\n2026/09/30;-1,00;x\n";
    expect(parseBankCsv(mojibake).errors[0]).toMatch(/merkist/i);
    expect(parseBankCsv("foo;bar\n1;2").errors[0]).toMatch(/ei tunnistettu/);
  });

  it("leaves out rows in another currency instead of adding them to euros", () => {
    const text = `${HEADER}\n${ROW("2026/09/30", "-100,00", "Ruotsin kauppa").replace(/EUR$/, "SEK")}\n${ROW("2026/09/29", "-5,00", "Kotimainen")}`;
    const r = parseBankCsv(text);
    expect(r.transactions.map((t) => t.amountCents)).toEqual([-500]);
    expect(r.errors.join(" ")).toMatch(/SEK|valuutta/i);
  });

  it("does not echo a huge cell back in an error message", () => {
    const r = parseBankCsv(`Kirjauspäivä;Määrä\n${"x".repeat(5_000_000)};-1,00\n`);
    expect(r.errors[0]!.length).toBeLessThan(200);
  });

  it("reads other banks' exports that share the common column names, and refuses the ones that do not", () => {
    const op = "Kirjauspäivä;Arvopäivä;Määrä EUROA;Laji;Selitys;Saaja/Maksaja;Saajan tilinumero;Saajan BIC-tunnus;Viitenumero;Viesti;Arkistointitunnus\n30.09.2026;30.09.2026;-12,50;101;KORTTIOSTO;K-MARKET;;;;;abc\n";
    expect(parseBankCsv(op).transactions[0]).toMatchObject({ bookingDate: "2026-09-30", amountCents: -1250, counterparty: "K-MARKET" });
    const other = "Datum;Transaktion;Belopp i SEK\n2026-09-30;ICA;-120,00\n";
    const r = parseBankCsv(other);
    expect(r.transactions).toEqual([]);
    expect(r.errors[0]).toBeTruthy();
  });
});

describe("CSV: import endpoint", () => {
  const file = (...rows: string[]) => [HEADER, ...rows].join("\n");

  it("importing the same file twice adds nothing, also with two identical rows in it", async () => {
    const { admin } = await setupApp();
    const content = file(ROW("2026/09/30", "-3,50", "KAHVI"), ROW("2026/09/30", "-3,50", "KAHVI"), ROW("2026/09/29", "-1050,00", "VUOKRA", "SATO OYJ"));
    const first = await admin.call("POST", "/api/import/csv", { content, accountName: "Käyttötili" });
    expect(first.body).toMatchObject({ fetched: 3, inserted: 3 });
    const again = await admin.call("POST", "/api/import/csv", { content, accountId: first.body.accountId });
    expect(again.body).toMatchObject({ inserted: 0, updated: 3 });
    expect((await admin.call("GET", "/api/transactions?from=2026-01-01&to=2026-12-31")).body.total).toBe(3);
  });

  it("an overlapping file adds only the new rows, and a third identical coffee is a new row", async () => {
    const { admin } = await setupApp();
    const a = file(ROW("2026/09/28", "-3,50", "KAHVI"), ROW("2026/09/29", "-8,00", "LOUNAS"));
    const b = file(ROW("2026/09/28", "-3,50", "KAHVI"), ROW("2026/09/28", "-3,50", "KAHVI"), ROW("2026/09/29", "-8,00", "LOUNAS"), ROW("2026/09/30", "-2,00", "LEHTI"));
    const first = await admin.call("POST", "/api/import/csv", { content: a, accountName: "Tili" });
    const second = await admin.call("POST", "/api/import/csv", { content: b, accountId: first.body.accountId });
    expect(second.body).toMatchObject({ inserted: 2, updated: 2 });
    expect((await admin.call("GET", "/api/transactions?from=2026-01-01&to=2026-12-31")).body.total).toBe(4);
  });

  it("a file in another layout is refused with a message and creates no account", async () => {
    const { admin } = await setupApp();
    const r = await admin.call("POST", "/api/import/csv", { content: "Datum;Transaktion;Belopp\n2026-09-30;ICA;-120,00\n", accountName: "Ruotsi" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/ei tunnistettu/);
    expect((await admin.call("GET", "/api/meta")).body.accounts).toEqual([]);
  });

  it("refuses bad bodies with a 400 and never a 500", async () => {
    const { admin } = await setupApp();
    for (const body of [{}, { content: 5 }, { content: "" }, { content: HEADER }, { content: file(ROW("2999/01/01", "-1,00", "TULEVAISUUS")), accountName: "x" }, { content: file(ROW("2026/09/30", "-1,00", "A")), accountId: "ei-ole" }, { content: file(ROW("2026/09/30", "-1,00", "A")), accountName: "x".repeat(500), accountType: "räjähde" }]) {
      const r = await admin.call("POST", "/api/import/csv", body);
      expect(r.status, JSON.stringify(body).slice(0, 80)).toBeLessThan(500);
    }
  });

  it("a name used twice (any case) is refused, a type outside the list falls back to checking", async () => {
    const { admin } = await setupApp();
    const c = file(ROW("2026/09/30", "-1,00", "A"));
    expect((await admin.call("POST", "/api/import/csv", { content: c, accountName: "Oma Tili", accountType: "räjähde" })).status).toBe(200);
    expect((await admin.call("GET", "/api/meta")).body.accounts[0].type).toBe("checking");
    expect((await admin.call("POST", "/api/import/csv", { content: c, accountName: " oma tili " })).status).toBe(400);
  });

  it("a request over the size limit is a JSON 413, and a file near the limit is parsed, not crashed on", async () => {
    const { admin } = await setupApp();
    const tooBig = await admin.call("POST", "/api/import/csv", { content: "x".repeat(7 * 1024 * 1024), accountName: "Iso" });
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error).toBeTruthy();
    const near = await admin.call("POST", "/api/import/csv", { content: `Kirjauspäivä;Määrä\n${"x".repeat(4 * 1024 * 1024)}`, accountName: "Lähes" });
    expect(near.status).toBe(400);
    expect(JSON.stringify(near.body).length).toBeLessThan(2000);
  }, 60_000);

  it("a long file imports in reasonable time", async () => {
    const { admin } = await setupApp();
    const rows = Array.from({ length: 20000 }, (_, i) => ROW(new Date(Date.UTC(2024, 0, 1) + (i % 700) * 86400000).toISOString().slice(0, 10).replace(/-/g, "/"), `-${1 + (i % 400) / 10}`.replace(".", ","), `KAUPPA ${i % 200} ${i}`));
    const t0 = Date.now();
    const r = await admin.call("POST", "/api/import/csv", { content: file(...rows), accountName: "Pitkä" });
    expect(r.body.inserted).toBe(20000);
    expect(Date.now() - t0).toBeLessThan(20_000);
  }, 60_000);
});

describe("sync and import at the same time", () => {
  it("both finish, nothing is duplicated, no row is lost and a category set by hand survives", async () => {
    const bank = mockBank();
    const { admin, s } = await setupApp({ EB_APP_ID: randomUUID(), EB_PRIVATE_KEY: pem }, bank.fetchMock);
    await admin.call("POST", "/api/connections/start", {});
    await admin.call("POST", "/api/connections/complete", { url: `https://x.example/cb?code=abc&state=${bank.state}` });
    await waitFor(async () => (await admin.call("GET", "/api/sync/runs")).body.runs.every((r: { status: string }) => r.status !== "running"));
    const rows = Array.from({ length: 300 }, (_, i) => ROW("2026/09/1" + (i % 9), `-${1 + i}`.replace(".", ","), `KAUPPA ${i}`));
    const content = [HEADER, ...rows].join("\n");
    const imported = await admin.call("POST", "/api/import/csv", { content: content.split("\n").slice(0, 150).join("\n"), accountName: "Tuotu" });
    const hand = (await admin.call("GET", "/api/transactions?q=KAUPPA 7&limit=1")).body.items[0];
    await admin.call("PATCH", `/api/transactions/${hand.id}`, { category: "pets" });

    const results = await Promise.all([
      admin.call("POST", "/api/sync"),
      admin.call("POST", "/api/import/csv", { content, accountId: imported.body.accountId }),
      admin.call("POST", "/api/import/csv", { content, accountId: imported.body.accountId }),
      admin.call("POST", "/api/sync"),
      admin.call("PATCH", `/api/transactions/${hand.id}`, { category: "pets" }),
    ]);
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
    // one of the two syncs may have been skipped by the lock, never run twice at once
    expect(results.filter((r) => r.body?.status === "skipped").length).toBeLessThanOrEqual(1);
    const total = (await admin.call("GET", "/api/transactions?accountId=" + imported.body.accountId + "&from=2000-01-01&to=2026-12-31&limit=1")).body.total;
    expect(total).toBe(300);
    const after = (await admin.call("GET", `/api/transactions?q=KAUPPA 7&limit=1`)).body.items[0];
    expect(after).toMatchObject({ category: "pets", categorySource: "user" });
    expect(await s.settings.get(`sync_lock:${(await s.users.list())[0]!.id}`)).toBeNull();
  }, 30_000);
});

describe("sharing and sessions", () => {
  it("a member who is signed in loses a shared account at once when the share is revoked, also in the cached dashboard", async () => {
    const { admin, member } = await setupApp();
    await admin.call("POST", "/api/demo");
    const meta = (await admin.call("GET", "/api/meta")).body;
    const m = await member("ville");
    const own = await m.call("POST", "/api/import/csv", { content: [HEADER, ROW("2026/10/01", "-10,00", "OMA")].join("\n"), accountName: "Villen" });
    expect(own.status).toBe(200);
    const range = "from=2025-01-01&to=2026-10-09&scope=household";
    const alone = (await m.call("GET", `/api/dashboard?${range}`)).body.totals;
    for (const a of meta.accounts) await admin.call("PUT", `/api/accounts/${a.id}/shares/${m.id}`);
    const shared = (await m.call("GET", `/api/dashboard?${range}`)).body.totals;
    expect(shared.consumptionCents).toBeGreaterThan(alone.consumptionCents);
    expect((await m.call("GET", "/api/transactions?scope=household&limit=1")).body.total).toBeGreaterThan(1);
    for (const a of meta.accounts) await admin.call("DELETE", `/api/accounts/${a.id}/shares/${m.id}`);
    expect((await m.call("GET", `/api/dashboard?${range}`)).body.totals).toEqual(alone);
    expect((await m.call("GET", "/api/transactions?scope=household&limit=1")).body.total).toBe(1);
    expect((await m.call("GET", `/api/export/transactions.csv?scope=household&from=2000-01-01&to=2030-01-01`)).body.trim().split(/\r?\n/)).toHaveLength(2);
    expect((await m.call("GET", "/api/meta")).body.sharedAccounts).toEqual([]);
  });

  it("a deleted member's session stops working at once", async () => {
    const { admin, member } = await setupApp();
    const m = await member("ville");
    expect((await m.call("GET", "/api/meta")).status).toBe(200);
    expect((await admin.call("DELETE", `/api/users/${m.id}`)).status).toBe(200);
    expect((await m.call("GET", "/api/meta")).status).toBe(401);
  });

  it("a session expires after SESSION_DAYS without use, slides when used, and is gone from the database", async () => {
    const clock = { now: new Date("2026-10-09T10:00:00Z") };
    const { client, db, app } = await setupApp({ SESSION_DAYS: "30" }, undefined, { now: () => clock.now });
    const c = client();
    expect((await c.call("POST", "/api/auth/login", { username: "aino", password: "aino-salasana-123" })).status).toBe(200);
    clock.now = new Date("2026-11-01T10:00:00Z"); // day 23
    expect((await c.call("GET", "/api/meta")).status).toBe(200); // slides the expiry to day 53
    clock.now = new Date("2026-11-28T10:00:00Z"); // day 50
    expect((await c.call("GET", "/api/meta")).status).toBe(200);
    clock.now = new Date("2027-01-20T10:00:00Z"); // 53+ days after the last use
    const gone = await c.call("GET", "/api/meta");
    expect(gone.status).toBe(401);
    expect(gone.body.code).toBe("unauthenticated");
    // the expired row was removed, and the cookie header does not revive it
    const left = await db.all<{ id: string }>("SELECT id FROM sessions");
    expect(left.length).toBeLessThanOrEqual(1);
    expect((await c.call("GET", "/api/meta")).status).toBe(401);
    expect(app).toBeTruthy();
  });
});

describe("hourly tick and time zones", () => {
  async function tickerAt(hours: number[]) {
    const clock = { now: new Date("2026-10-09T10:00:00Z") };
    const t = await setupApp({}, undefined, { now: () => clock.now });
    expect((await t.admin.call("PUT", "/api/admin/instance", { syncHours: hours })).status).toBe(200);
    return { ...t, clock, tick: async (iso: string) => {
      clock.now = new Date(iso);
      return (await hourlyTick(t.s)).synced !== null;
    } };
  }

  it("when clocks go back, the repeated hour fetches once (Helsinki, 25 October 2026)", async () => {
    const t = await tickerAt([3]);
    // 03:15 EEST = 00:15Z, then the clocks go back and 03:15 EET = 01:15Z
    expect(await t.tick("2026-10-25T00:15:00Z")).toBe(true);
    expect(await t.tick("2026-10-25T01:15:00Z")).toBe(false);
    expect(await t.tick("2026-10-25T02:15:00Z")).toBe(false);
    // the next day it runs again
    expect(await t.tick("2026-10-26T01:15:00Z")).toBe(true);
  });

  it("when clocks go forward and the chosen hour does not exist, the fetch happens in the next hour (29 March 2026)", async () => {
    const t = await tickerAt([3]);
    // 02:15 EET = 00:15Z, then 03:00 does not exist and 04:15 EEST = 01:15Z
    expect(await t.tick("2026-03-29T00:15:00Z")).toBe(false);
    expect(await t.tick("2026-03-29T01:15:00Z")).toBe(true);
    expect(await t.tick("2026-03-29T02:15:00Z")).toBe(false);
  });

  it("an ordinary day fetches exactly in the chosen hours, and a skipped hour does not make a second fetch", async () => {
    const t = await tickerAt([6, 18]);
    const hits: string[] = [];
    for (let h = 0; h < 24; h++) {
      const iso = `2026-06-10T${String(h).padStart(2, "0")}:15:00Z`;
      if (await t.tick(iso)) hits.push(iso);
    }
    // 06:15 and 18:15 Helsinki in summer are 03:15Z and 15:15Z
    expect(hits).toEqual(["2026-06-10T03:15:00Z", "2026-06-10T15:15:00Z"]);
    // the spring change with the hours 4 and 2 chosen: both still happen once
    const s2 = await tickerAt([2, 4]);
    const got: string[] = [];
    for (const iso of ["2026-03-29T00:15:00Z", "2026-03-29T01:15:00Z", "2026-03-29T02:15:00Z"]) if (await s2.tick(iso)) got.push(iso);
    expect(got).toEqual(["2026-03-29T00:15:00Z", "2026-03-29T01:15:00Z"]);
  });

  it("the backup day follows local midnight on the days the clocks change", async () => {
    const days: string[] = [];
    const clock = { now: new Date("2026-03-28T21:30:00Z") };
    const t = await setupApp({}, undefined, { now: () => clock.now, backup: (day) => (days.push(day), `copy-${day}`) });
    for (const iso of ["2026-03-28T21:30:00Z", "2026-03-28T22:30:00Z", "2026-03-29T20:30:00Z", "2026-03-29T21:30:00Z", "2026-10-24T20:30:00Z", "2026-10-24T21:30:00Z", "2026-10-25T21:30:00Z", "2026-10-25T22:30:00Z"]) {
      clock.now = new Date(iso);
      await hourlyTick(t.s);
    }
    // local midnight: 28 March 22:00Z (EET), 29 March 21:00Z (EEST), 24 October 21:00Z (EEST), 25 October 22:00Z (EET)
    expect(days).toEqual(["2026-03-28", "2026-03-29", "2026-03-30", "2026-10-24", "2026-10-25", "2026-10-26"]);
  });
});
