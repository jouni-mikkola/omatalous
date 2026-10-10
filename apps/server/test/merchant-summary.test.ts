import { describe, expect, it } from "vitest";
import { optimizeDatabase } from "../src/db/optimize.ts";
import { setupApp } from "./helpers.ts";

const HEADER = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta";
const CHECKING = "FI12 1234 5600 0785 41";
const monthly = Array.from({ length: 6 }, (_, i) => `2026/0${4 + i}/05;-9,99;${CHECKING};;;SPOTIFY;;EUR`);
const content = [
  HEADER,
  `2026/09/20;-12,00;${CHECKING};;;XYZZY TUNTEMATON;;EUR`,
  `2026/09/02;-30,00;${CHECKING};;;XYZZY TUNTEMATON;;EUR`,
  `2026/09/06;35,00;;${CHECKING};;XYZZY TUNTEMATON;;EUR`,
  `2025/12/24;-10,00;${CHECKING};;;XYZZY TUNTEMATON;;EUR`,
  ...monthly,
].join("\n");

const summary = async (c: { call: (m: string, p: string) => Promise<{ status: number; body: any }> }, merchant: string, extra = "") =>
  c.call("GET", `/api/merchants/summary?merchant=${encodeURIComponent(merchant)}${extra}`);

describe("GET /api/merchants/summary", () => {
  it("adds up the whole history of one merchant", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/import/csv", { content, accountName: "Käyttötili" });
    const r = await summary(admin, "Xyzzy Tuntematon");
    expect(r.status).toBe(200);
    expect(r.body.summary).toMatchObject({
      merchant: "Xyzzy Tuntematon",
      count: 4,
      outCents: 5200,
      inCents: 3500,
      firstDate: "2025-12-24",
      lastDate: "2026-09-20",
      months: 2,
      category: "other",
      recurring: null,
    });
  });

  it("names the cadence and the next date of a recurring payment", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/import/csv", { content, accountName: "Käyttötili" });
    const s = (await summary(admin, "Spotify")).body.summary;
    expect(s.count).toBe(6);
    expect(s.outCents).toBe(5994);
    expect(s.recurring).toMatchObject({ cadence: "monthly", active: true, nextDate: "2026-10-05" });
  });

  it("is empty for an unknown merchant and never reads another user's rows", async () => {
    const { admin, member } = await setupApp();
    await admin.call("POST", "/api/import/csv", { content, accountName: "Käyttötili" });
    expect((await summary(admin, "Ei Tällaista")).body).toEqual({ summary: null });
    const eero = await member("eero");
    expect((await summary(eero, "Spotify")).body).toEqual({ summary: null });
    const accountId = (await admin.call("GET", "/api/meta")).body.accounts[0].id;
    await admin.call("PUT", `/api/accounts/${accountId}/shares/${eero.id}`);
    expect((await summary(eero, "Spotify")).body).toEqual({ summary: null });
    expect((await summary(eero, "Spotify", "&scope=household")).body.summary.count).toBe(6);
  });

  it("takes the name as data and rejects what is not a name", async () => {
    const { admin, s } = await setupApp();
    await admin.call("POST", "/api/import/csv", { content, accountName: "Käyttötili" });
    for (const name of ["'; DROP TABLE transactions; --", "../../etc/passwd", "%", "Spotify' OR '1'='1"]) {
      const r = await summary(admin, name);
      expect(r.status, name).toBe(200);
      expect(r.body, name).toEqual({ summary: null });
    }
    expect((await admin.call("GET", "/api/merchants/summary")).status).toBe(400);
    expect((await admin.call("GET", "/api/merchants/summary?merchant=")).status).toBe(400);
    expect((await summary(admin, "x".repeat(201))).status).toBe(400);
    expect((await s.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM transactions"))?.n).toBeGreaterThan(0);
  });

  it("reads one merchant's rows through the merchant index", async () => {
    const { s, admin } = await setupApp();
    await admin.call("POST", "/api/import/csv", { content, accountName: "Käyttötili" });
    await optimizeDatabase(s.db);
    const plan = (
      await s.db.all<{ detail: string }>(
        "EXPLAIN QUERY PLAN SELECT category, substr(booking_date, 1, 7) AS m, COUNT(*) FROM transactions INDEXED BY idx_tx_user_merchant_date WHERE user_id = ? AND merchant = ? GROUP BY category, m",
        ["u", "Spotify"],
      )
    )
      .map((r) => r.detail)
      .join("\n");
    expect(plan).toContain("idx_tx_user_merchant_date");
    expect(plan).not.toMatch(/SCAN transactions(?! USING)/);
  });

  it("needs a signed-in user", async () => {
    const { client } = await setupApp();
    expect((await client().call("GET", "/api/merchants/summary?merchant=Spotify")).status).toBe(401);
  });
});
