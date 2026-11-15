import { describe, expect, it } from "vitest";
import { seedCsv } from "./csv-seed.ts";
import { setupApp } from "./helpers.ts";

// A date the browser sends is a day a household's rows can have: 1900 to 2199, from before to. A year-9999 `to` once froze
// the server in the strip's histogram, and a year-100 `from` asked for 23 000 bins.
const csv = [
  "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta",
  "2026/09/05;-44,15;FI12 1234 5600 0785 41;;;LIDL TIKKURILA;;EUR",
  "2026/08/20;-21,30;FI12 1234 5600 0785 41;;;LIDL TIKKURILA;;EUR",
].join("\n");

async function seeded() {
  const { s, admin } = await setupApp();
  expect((await seedCsv(s, admin, { content: csv, accountName: "Käyttötili", accountType: "checking" })).status).toBe(200);
  return admin;
}

describe("dates of a range", () => {
  it("refuses a day before 1900, after 2199, or a from after the to, on Tapahtumat and on the reports", async () => {
    const admin = await seeded();
    for (const q of ["from=2020-01-01&to=9999-12-31", "from=2020-01-01&to=2200-01-01", "from=0100-01-01", "from=1899-12-31", "from=2026-09-30&to=2026-08-01"]) {
      const res = await admin.call("GET", `/api/transactions?${q}`);
      expect(res.status, q).toBe(400);
      expect(res.body.error).toBe("Virheellinen aikaväli.");
    }
    for (const path of ["/api/reports", "/api/dashboard"]) {
      for (const q of ["from=0100-01-01&to=2020-01-01", "from=2020-01-01&to=9999-12-31"]) expect((await admin.call("GET", `${path}?${q}`)).status, `${path}?${q}`).toBe(400);
    }
  });

  it("answers the ends of the range and a household's span as before", async () => {
    const admin = await seeded();
    const two = (await admin.call("GET", "/api/transactions?from=2025-01-01&to=2026-12-31")).body;
    expect(two.histogram.unit).toBe("week");
    expect(two.total).toBe(2);
    expect((await admin.call("GET", "/api/transactions?from=1900-01-01&to=2199-12-31")).status).toBe(200);
    expect((await admin.call("GET", "/api/reports?from=1900-01-01&to=2199-12-31")).status).toBe(200);
  });

  it("bins at most the last hundred years of a span", async () => {
    const admin = await seeded();
    const { histogram, span } = (await admin.call("GET", "/api/transactions?from=1900-01-01&to=2199-12-31")).body;
    expect(span).toEqual({ from: "1900-01-01", to: "2199-12-31" });
    expect(histogram.unit).toBe("month");
    expect(histogram.bins).toHaveLength(1201);
    expect(histogram.bins[0].start).toBe("2099-12-01");
    const short = (await admin.call("GET", "/api/transactions?from=1990-01-01")).body.histogram;
    expect([short.bins.length, short.bins[0].start]).toEqual([441, "1990-01-01"]);
  });
});
