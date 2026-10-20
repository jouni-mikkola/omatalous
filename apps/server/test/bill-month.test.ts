/**
 * Laskut: GET /api/bill-month gives the month board (paid, missing, coming) and the fixed costs of a month; its figures
 * open their rows through GET /api/explain (`bills.*`), adding up to the board's own numbers. A subscription the viewer
 * marked as cancelled is out of both.
 */
import { seriesMarkSubject } from "@banking/core";
import { describe, expect, it } from "vitest";
import { seedCsv } from "./csv-seed.ts";
import { setupApp } from "./helpers.ts";

const HEADER = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta";
const CHECKING = "FI12 1234 5600 0785 41";
const months = ["2026/05", "2026/06", "2026/07", "2026/08", "2026/09", "2026/10"];
// rent on the 2nd, a streaming service on the 5th, a phone on the 20th (not yet charged in October: today is 9.10.)
const CSV = [
  HEADER,
  ...months.map((m) => `${m}/02;-950,00;${CHECKING};;;VUOKRA OY SATO;;EUR`),
  ...months.map((m) => `${m}/05;-12,99;${CHECKING};;;SPOTIFY;;EUR`),
  ...months.slice(0, -1).map((m) => `${m}/20;-24,90;${CHECKING};;;ELISA OYJ;;EUR`),
].join("\n");

async function imported() {
  const app = await setupApp();
  const seeded = await seedCsv(app.s, app.admin, { content: CSV, accountName: "Käyttötili", accountType: "checking" });
  expect(seeded.status).toBe(200);
  return app;
}

type Row = { merchant: string; state: string; cents: number };

describe("GET /api/bill-month", () => {
  it("gives this month's bills by state, and every figure of the board opens rows that add up to it", async () => {
    const { admin } = await imported();
    const r = await admin.call("GET", "/api/bill-month");
    expect(r.status).toBe(200);
    const { board } = r.body;
    expect(board.month).toBe("2026-10");
    const states = Object.fromEntries((board.rows as Row[]).map((x) => [x.merchant, x.state]));
    expect(Object.values(states)).toContain("coming");
    expect(Object.values(states)).toContain("paid");
    expect(board.fixedMonthlyCents).toBeGreaterThan(0);
    for (const [figure, cents] of [["bills.paid", board.totals.paidCents], ["bills.coming", board.totals.comingCents], ["bills.due", board.totals.dueCents], ["bills.fixed", board.fixedMonthlyCents]] as const) {
      const e = await admin.call("GET", `/api/explain?figure=${figure}&from=${board.from}&to=${board.to}`);
      expect(e.status).toBe(200);
      expect(e.body.cents).toBe(cents);
      expect(e.body.check).toEqual({ kind: "sum", diffCents: 0 });
      // a payee's name stands only in the rows the answer names (VT5), never in its lines or reasons
      expect(JSON.stringify({ ...e.body, rows: undefined })).not.toMatch(/SPOTIFY|Spotify|ELISA|Elisa/);
    }
  });

  it("moves to an earlier month within the twelve, and clamps a month too far back", async () => {
    const { admin } = await imported();
    const september = (await admin.call("GET", "/api/bill-month?month=2026-09")).body.board;
    expect(september.month).toBe("2026-09");
    expect((september.rows as Row[]).every((x) => x.state === "paid")).toBe(true);
    expect((await admin.call("GET", "/api/bill-month?month=2020-01")).body.board.month).toBe("2025-10");
  });

  it("leaves a subscription marked as cancelled out of the board and out of the rows its figures open", async () => {
    const { admin } = await imported();
    const before = (await admin.call("GET", "/api/bill-month")).body.board;
    const spotify = (before.rows as (Row & { seriesId: string })[]).find((x) => /spotify/i.test(x.merchant))!;
    expect(spotify).toBeDefined();
    expect((await admin.call("PUT", "/api/marks", { subject: seriesMarkSubject({ id: spotify.seriesId, kind: "subscription", typicalAmountCents: 1299 }), mark: "cancelled" })).status).toBe(200);
    const after = (await admin.call("GET", "/api/bill-month")).body.board;
    expect((after.rows as Row[]).some((x) => /spotify/i.test(x.merchant))).toBe(false);
    expect(after.fixedMonthlyCents).toBe(before.fixedMonthlyCents - 1299);
    const fixed = await admin.call("GET", `/api/explain?figure=bills.fixed&from=${after.from}&to=${after.to}`);
    expect(fixed.body.cents).toBe(after.fixedMonthlyCents);
  });

  it("refuses a figure of Laskut restricted to accounts: it is of the whole view", async () => {
    const { admin } = await imported();
    const accountId = (await admin.call("GET", "/api/accounts")).body.accounts?.[0]?.id ?? "x";
    expect((await admin.call("GET", `/api/explain?figure=bills.due&from=2026-10-01&to=2026-10-31&accounts=${accountId}`)).status).toBe(400);
  });
});
