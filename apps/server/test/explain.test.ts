/**
 * "Miksi?": GET /api/explain gives the rows of a figure and the check that they add up to it. The rows sum to what the
 * dashboard shows, a member explains only accounts they may read, and the answer holds no name, IBAN or bank text.
 */
import { describe, expect, it, vi } from "vitest";
import { seedCsv } from "./csv-seed.ts";
import { setupApp } from "./helpers.ts";

const SEPTEMBER = "from=2026-09-01&to=2026-09-30";
const HEADER = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta";
const CHECKING = "FI12 1234 5600 0785 41";
const EMPLOYER = "FI96 1234 5600 0007 93";
const CSV = [
  HEADER,
  `2026/09/30;1799,69;${EMPLOYER};${CHECKING};RAKENNUS-SAARINEN OY;PALKKA;;EUR`,
  `2026/09/05;-44,15;${CHECKING};;;LIDL TIKKURILA;;EUR`,
  `2026/09/03;-106,66;${CHECKING};;;PRISMA TIKKURILA;;EUR`,
].join("\n");

/** A household whose administrator has imported one checking account with a month's rows. */
async function imported() {
  const app = await setupApp();
  const seeded = await seedCsv(app.s, app.admin, { content: CSV, accountName: "Käyttötili", accountType: "checking" });
  expect(seeded.status).toBe(200);
  return { ...app, accountId: seeded.body.accountId as string };
}

describe("GET /api/explain", () => {
  it("lists the rows of the month's spending and income, adding up to the dashboard's figures", async () => {
    const { admin } = await imported();
    const dash = (await admin.call("GET", `/api/dashboard?${SEPTEMBER}`)).body;
    for (const [figure, cents] of [["spend.month", dash.totals.expenseCents], ["income.month", dash.totals.incomeCents]] as const) {
      const r = await admin.call("GET", `/api/explain?figure=${figure}&${SEPTEMBER}`);
      expect(r.status).toBe(200);
      expect(r.body.cents).toBe(cents);
      expect(r.body.lines.length).toBeGreaterThan(0);
      expect(r.body.lines.reduce((sum: number, l: { cents: number }) => sum + l.cents, 0)).toBe(cents);
      expect(r.body.check).toEqual({ kind: "sum", diffCents: 0 });
    }
  });

  it("holds no merchant name, IBAN or bank text", async () => {
    const { admin } = await imported();
    const rows = (await admin.call("GET", `/api/transactions?${SEPTEMBER}&limit=500`)).body.items as { merchant: string; description: string; counterparty: string | null; counterpartyIban?: string | null }[];
    const text = JSON.stringify((await admin.call("GET", `/api/explain?figure=spend.month&${SEPTEMBER}`)).body);
    expect(rows.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/);
    for (const t of rows) for (const word of [t.merchant, t.description, t.counterparty]) if (word && word.length > 4) expect(text).not.toContain(word);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["cents", "check", "figure", "kind", "lines"]);
  });

  it("a figure of one account is that account's; a member cannot explain another member's account", async () => {
    const { admin, member, accountId } = await imported();
    const mine = { id: accountId };
    const own = await admin.call("GET", `/api/explain?figure=spend.month&${SEPTEMBER}&accounts=${mine.id}`);
    expect(own.status).toBe(200);
    expect(own.body.check.diffCents).toBe(0);
    const eero = await member("eero", "Eero");
    // near miss: the same request with no account is the member's own, and answers
    expect((await eero.call("GET", `/api/explain?figure=spend.month&${SEPTEMBER}`)).status).toBe(200);
    expect((await eero.call("GET", `/api/explain?figure=spend.month&${SEPTEMBER}&accounts=${mine.id}`)).status).toBe(404);
    expect((await eero.call("GET", `/api/explain?figure=spend.month&${SEPTEMBER}&scope=household&accounts=${mine.id}`)).status).toBe(404);
  });

  it("refuses a figure that is not one of the four, a category that is not known and a bad range", async () => {
    const { admin } = await imported();
    expect((await admin.call("GET", `/api/explain?figure=forecast.month&${SEPTEMBER}`)).status).toBe(400);
    expect((await admin.call("GET", `/api/explain?${SEPTEMBER}`)).status).toBe(400);
    expect((await admin.call("GET", `/api/explain?figure=spend.category&${SEPTEMBER}`)).status).toBe(400);
    expect((await admin.call("GET", `/api/explain?figure=spend.category&category=nope&${SEPTEMBER}`)).status).toBe(400);
    expect((await admin.call("GET", "/api/explain?figure=spend.month&from=2026-09-30&to=2026-09-01")).status).toBe(400);
    expect((await admin.call("GET", `/api/explain?figure=spend.category&category=groceries&${SEPTEMBER}`)).status).toBe(200);
  });

  it("is for signed-in users only, and says nothing in the log when the rows add up", async () => {
    const { admin, client } = await imported();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect((await client().call("GET", `/api/explain?figure=spend.month&${SEPTEMBER}`)).status).toBe(401);
      await admin.call("GET", `/api/explain?figure=income.earned&${SEPTEMBER}`);
      expect(warn.mock.calls.filter((c) => String(c[0]).startsWith("explain:"))).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});
