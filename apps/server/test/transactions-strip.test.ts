import { describe, expect, it } from "vitest";
import { seedCsv } from "./csv-seed.ts";
import { setupApp } from "./helpers.ts";

// What Tapahtumat draws above and beside its rows (VT2): the sums of whole days, the strip's histogram, its span and
// difference, the drill's twelve months and an account's digits. Every one is the server's; the web adds up nothing.
const HEADER = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta";
const CHECKING = "FI12 1234 5600 0785 41";
const SAVINGS = "FI45 1234 5600 0921 77";
const EMPLOYER = "FI96 1234 5600 0007 93";
const csv = [
  HEADER,
  `2026/09/30;1799,69;${EMPLOYER};${CHECKING};RAKENNUS-SAARINEN OY;PALKKA;;EUR`,
  `2026/09/16;-300,00;${CHECKING};${SAVINGS};LAAKSONEN MIKKO JA ANNA;OMA SIIRTO;;EUR`,
  `2026/09/05;-44,15;${CHECKING};;;LIDL TIKKURILA;;EUR`,
  `2026/09/05;-10,00;${CHECKING};;;LIDL TIKKURILA;;EUR`,
  `2026/08/20;-21,30;${CHECKING};;;LIDL TIKKURILA;;EUR`,
  `2026/09/03;-106,66;${CHECKING};;;PRISMA TIKKURILA;;EUR`,
].join("\n");

type DaySum = { date: string; count: number; inCents: number; outCents: number };

describe("GET /api/transactions: the strip and the day rows", () => {
  it("sums whole days also when the page cuts one, bins the span to the cent and gives its difference", async () => {
    const { s, admin } = await setupApp();
    expect((await seedCsv(s, admin, { content: csv, accountName: "Käyttötili", accountType: "checking" })).status).toBe(200);
    const all = (await admin.call("GET", "/api/transactions?limit=500")).body;
    expect(all.span).toEqual({ from: "2026-08-20", to: "2026-09-30" });
    expect(all.netCents).toBe(all.inCents - all.outCents);
    expect(all.histogram.unit).toBe("day");
    expect(all.histogram.bins).toHaveLength(42);
    const binOut = all.histogram.bins.reduce((n: number, b: DaySum) => n + b.outCents, 0);
    expect(binOut).toBe(all.outCents);
    // the calendar is every day of the span with its shade; a day with no row is 0
    expect(all.calendar.days).toHaveLength(42);
    expect(all.calendar.days.find((d: { date: string }) => d.date === "2026-09-05")).toMatchObject({ cents: 5415, count: 2 });
    expect(all.calendar.days.find((d: { date: string }) => d.date === "2026-09-06")).toMatchObject({ cents: 0, count: 0, heat: 0 });

    // the newest three rows: 30.9., 16.9. and one of the two rows of 5.9.; the day still says both
    const page = (await admin.call("GET", "/api/transactions?limit=3")).body;
    const fifth: DaySum = page.daySums.find((d: DaySum) => d.date === "2026-09-05");
    expect(page.items.filter((t: { bookingDate: string }) => t.bookingDate === "2026-09-05")).toHaveLength(1);
    expect(fifth).toEqual({ date: "2026-09-05", count: 2, inCents: 0, outCents: 5415 });
    // only the days of the rows on the page
    expect(page.daySums.map((d: DaySum) => d.date).sort()).toEqual(["2026-09-05", "2026-09-16", "2026-09-30"]);

    const filtered = (await admin.call("GET", "/api/transactions?from=2026-09-01&to=2026-09-30")).body;
    expect(filtered.span).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(filtered.histogram.bins).toHaveLength(30);
  });

  it("gives the payee's twelve months to the row drill and each account its last digits", async () => {
    const { s, admin } = await setupApp();
    const seeded = await seedCsv(s, admin, { content: csv, accountName: "Käyttötili", accountType: "checking" });
    const id = seeded.body.accountId as string;
    const meta = (await admin.call("GET", "/api/meta")).body;
    expect(meta.accounts.find((a: { id: string }) => a.id === id).digits).toBe("8541");

    const merchant = (await admin.call("GET", "/api/transactions?q=LIDL")).body.items[0].merchant as string;
    const { summary } = (await admin.call("GET", `/api/merchants/summary?merchant=${encodeURIComponent(merchant)}`)).body;
    expect(summary.months).toHaveLength(12);
    expect(summary.months.at(-1)).toEqual({ month: "2026-09", count: 2, outCents: 5415, meanCents: 2708 });
    expect(summary.months.at(-2)).toEqual({ month: "2026-08", count: 1, outCents: 2130, meanCents: 2130 });
    expect(summary.year).toEqual({ count: 3, outCents: 7545, meanCents: 2515 });
  });
});
