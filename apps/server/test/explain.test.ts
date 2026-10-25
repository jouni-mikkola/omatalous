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

  it("names each of its rows as the list of rows does, and holds no IBAN or bank text", async () => {
    const { admin } = await imported();
    const rows = (await admin.call("GET", `/api/transactions?${SEPTEMBER}&limit=500`)).body.items as { id: string; merchant: string; category: string; description: string; counterparty: string | null; counterpartyIban?: string | null }[];
    const body = (await admin.call("GET", `/api/explain?figure=spend.month&${SEPTEMBER}`)).body as { lines: { id: string }[]; rows: { id: string; merchant: string; category: string }[] };
    const text = JSON.stringify(body);
    expect(rows.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/);
    // the names the panel shows, and nothing else of the row: the bank's text and the other party stay out
    const named = new Set(body.rows.map((r) => r.merchant));
    for (const t of rows) for (const word of [t.description, t.counterparty]) if (word && word.length > 4 && !named.has(word)) expect(text).not.toContain(word);
    expect(Object.keys(body).sort()).toEqual(["cents", "check", "figure", "kind", "lines", "rows"]);
    expect(body.rows.map((r) => r.id).sort()).toEqual(body.lines.map((l) => l.id).sort());
    const list = new Map(rows.map((t) => [t.id, t]));
    for (const r of body.rows) expect(r).toEqual({ id: r.id, merchant: list.get(r.id)!.merchant, category: list.get(r.id)!.category });
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

  it("refuses a figure that is not explained, a category that is not known and a bad range", async () => {
    const { admin } = await imported();
    expect((await admin.call("GET", `/api/explain?figure=settlement.over&${SEPTEMBER}`)).status).toBe(400);
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

const LONG_CSV = [
  HEADER,
  ...[
    ["06", "-100,00", "800,00"],
    ["07", "-300,00", "900,00"],
    ["08", "-200,00", "1000,00"],
    ["09", "-400,00", "1100,00"],
  ].flatMap(([m, spend, pay]) => [
    `2026/${m}/01;${spend};${CHECKING};;;LIDL TIKKURILA;;EUR`,
    `2026/${m}/28;${pay};${EMPLOYER};${CHECKING};RAKENNUS-SAARINEN OY;PALKKA;;EUR`,
    `2026/${m}/29;-0,50;${CHECKING};;;PRISMA TIKKURILA;;EUR`,
  ]),
].join("\n");
const OCTOBER = "from=2026-10-01&to=2026-10-31";

describe("GET /api/explain: the figures that are not a sum of one range", () => {
  it("Tulos is a sum of the month's rows that adds up to the dashboard's figure", async () => {
    const { admin } = await imported();
    const dash = (await admin.call("GET", `/api/dashboard?${SEPTEMBER}`)).body;
    const r = await admin.call("GET", `/api/explain?figure=yli_jai.month&${SEPTEMBER}`);
    expect(r.status).toBe(200);
    expect(r.body.cents).toBe(dash.totals.leftCents);
    expect(r.body.lines.reduce((sum: number, l: { cents: number }) => sum + l.cents, 0)).toBe(dash.totals.leftCents);
    expect(r.body.check).toEqual({ kind: "sum", diffCents: 0 });
  });

  it("a usual level is the median of its months, each month a sum of its own; under three months it says nothing", async () => {
    const { admin, s } = await setupApp();
    expect((await seedCsv(s, admin, { content: LONG_CSV, accountName: "Käyttötili", accountType: "checking" })).status).toBe(200);
    const spend = await admin.call("GET", `/api/explain?figure=usual.spend&${OCTOBER}`);
    expect(spend.status).toBe(200);
    expect(spend.body).toMatchObject({ kind: "median", check: { kind: "recompute", diffCents: 0 } });
    const values = spend.body.method.values as { label: string; cents: number; explain: { lines: unknown[]; check: { diffCents: number } } }[];
    expect(values.map((v) => v.label)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(values.map((v) => v.cents)).toEqual([10050, 30050, 20050, 40050]);
    expect(spend.body.cents).toBe(25050);
    for (const v of values) expect(v.explain.check.diffCents).toBe(0);
    const income = await admin.call("GET", `/api/explain?figure=usual.income&${OCTOBER}`);
    // the page's usual income is a median of twelve complete months: four are too few, and the figure says so
    expect(income.body).toMatchObject({ kind: "median", cents: null, check: { kind: "recompute", diffCents: 0 }, method: { rule: "Vertailuun tarvitaan 12 kuukautta, tietoja on 4" } });
    // near miss: a month with one month before it is too few, and the figure says nothing
    const few = await admin.call("GET", "/api/explain?figure=usual.spend&from=2026-07-01&to=2026-07-31");
    expect(few.body).toMatchObject({ cents: null, method: { rule: "Vertailuun tarvitaan 3 kuukautta, tietoja on 1" } });
    expect((await admin.call("GET", `/api/explain?figure=usual.spend&${OCTOBER}&accounts=nope`)).status).toBe(400);
  });

  it("the part of a joint account's row is cut by the weights and adds up to the bank's amount; another member's row is 404", async () => {
    const { admin, adminId, member, accountId } = await imported();
    const eero = await member("eero", "Eero");
    const row = ((await admin.call("GET", `/api/transactions?${SEPTEMBER}&limit=500`)).body.items as { id: string; merchant: string }[]).find((t) => /lidl/i.test(t.merchant))!;
    const ask = (c: typeof admin, id = row.id) => c.call("GET", `/api/explain?figure=share.part&row=${id}&${SEPTEMBER}`);
    // near miss: an account with one user has no part to tell
    expect((await ask(admin)).status).toBe(400);
    const use = await admin.call("PUT", `/api/accounts/${accountId}/use`, { users: [{ userId: adminId, weight: 1 }, { userId: eero.id, weight: 1 }] });
    expect(use.status).toBe(200);
    const r = await ask(admin);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: "share", check: { kind: "recompute", diffCents: 0 } });
    expect(r.body.lines.map((l: { cents: number }) => l.cents).sort((a: number, b: number) => a - b)).toEqual([-2208, -2207]);
    expect(r.body.lines.some((l: { why: { rule: string }[] }) => l.why.some((w) => w.rule === "rounding.cent"))).toBe(true);
    expect((await ask(eero)).status).toBe(404);
    expect((await admin.call("GET", `/api/explain?figure=share.part&${SEPTEMBER}`)).status).toBe(400);
    expect((await ask(admin, "nope")).status).toBe(404);
  });

});

/** The numbers the pages of the demo household show, asked from the API that gives them. */
describe("GET /api/explain: each opener explains the number its page shows", () => {
  const YEAR = "from=2025-10-01&to=2026-10-09";

  it("usual.income and Tulos are the figures of the dashboard and the reports", async () => {
    const { admin } = await setupApp();
    expect((await admin.call("POST", "/api/demo")).status).toBe(200);
    const reports = (await admin.call("GET", `/api/reports?${YEAR}&reports=income,cashflow`)).body;
    expect(reports.income.stability.medianCents).toBeGreaterThan(0);
    const income = await admin.call("GET", `/api/explain?figure=usual.income&${YEAR}`);
    expect(income.body.cents).toBe(reports.income.stability.medianCents);
    expect(income.body.method.values).toHaveLength(12);
    expect(income.body.check).toEqual({ kind: "recompute", diffCents: 0 });
    const month = (await admin.call("GET", "/api/reports?from=2026-09-01&to=2026-09-30&reports=cashflow")).body.cashflow;
    const left = await admin.call("GET", `/api/explain?figure=yli_jai.month&from=2026-09-01&to=2026-09-30`);
    expect(left.body.cents).toBe(month.totals.leftCents);
    expect(left.body.check).toEqual({ kind: "sum", diffCents: 0 });
  });

  it("the part of a joint account's row is the part its row in Tapahtumat shows", async () => {
    const { admin, adminId, member, accountId } = await imported();
    const eero = await member("eero", "Eero");
    await admin.call("PUT", `/api/accounts/${accountId}/use`, { users: [{ userId: adminId, weight: 1 }, { userId: eero.id, weight: 1 }] });
    const rows = (await admin.call("GET", `/api/transactions?${SEPTEMBER}&limit=500`)).body.items as { id: string; partCents?: number }[];
    const parted = rows.filter((t) => t.partCents !== undefined);
    expect(parted.length).toBeGreaterThan(1);
    for (const t of parted) {
      const r = await admin.call("GET", `/api/explain?figure=share.part&row=${t.id}&${SEPTEMBER}`);
      expect(r.status).toBe(200);
      expect(r.body.cents, t.id).toBe(t.partCents);
    }
  });
});

describe("GET /api/explain: Koko talous and a joint account", () => {
  const SEPT = "from=2026-09-01&to=2026-09-30";

  it("the figures answer in the household view with the household's numbers", async () => {
    const { admin, adminId, member, accountId } = await imported();
    const eero = await member("eero", "Eero");
    await admin.call("PUT", `/api/accounts/${accountId}/use`, { users: [{ userId: adminId, weight: 1 }, { userId: eero.id, weight: 1 }] });
    const ask = (figure: string) => admin.call("GET", `/api/explain?figure=${figure}&${OCTOBER}&scope=household`);
    expect((await ask("usual.income")).status).toBe(200);
    const left = await admin.call("GET", `/api/explain?figure=yli_jai.month&${SEPT}&scope=household`);
    expect(left.body.cents).toBe((await admin.call("GET", `/api/reports?${SEPT}&reports=cashflow&scope=household`)).body.cashflow.totals.leftCents);
    expect(left.body.check).toEqual({ kind: "sum", diffCents: 0 });
    // the household's accounts are whole: the row of the joint account has no part to tell in this view
    const row = ((await admin.call("GET", `/api/transactions?${SEPT}&limit=500&scope=household`)).body.items as { id: string }[])[0]!;
    const part = await admin.call("GET", `/api/explain?figure=share.part&row=${row.id}&${SEPT}&scope=household`);
    expect(part.status).toBe(200);
    expect(part.body).toMatchObject({ kind: "share", check: { kind: "recompute", diffCents: 0 } });
  });

  it("a member who uses a joint account explains it; an account of another member that is not shared with them is 404", async () => {
    const { s, admin, adminId, member, accountId } = await imported();
    const eero = await member("eero", "Eero");
    const second = await seedCsv(s, admin, { content: CSV, accountName: "Säästötili", accountType: "savings" });
    const privateId = second.body.accountId as string;
    expect(privateId).not.toBe(accountId);
    const asEero = (id: string) => eero.call("GET", `/api/explain?figure=spend.month&${OCTOBER}&accounts=${id}`);
    // before the account is shared with him it is not his
    expect((await asEero(accountId)).status).toBe(404);
    // shared with him and said to be used by both: his, at his part
    expect((await admin.call("PUT", `/api/accounts/${accountId}/shares/${eero.id}`)).status).toBe(200);
    await admin.call("PUT", `/api/accounts/${accountId}/use`, { users: [{ userId: adminId, weight: 1 }, { userId: eero.id, weight: 1 }] });
    const used = await asEero(accountId);
    expect(used.status).toBe(200);
    // the near miss: the other account of the same owner, not shared
    expect((await asEero(privateId)).status).toBe(404);
    const row = ((await admin.call("GET", `/api/transactions?${SEPTEMBER}&limit=500`)).body.items as { id: string; accountId: string }[]).find((t) => t.accountId === accountId)!;
    expect((await eero.call("GET", `/api/explain?figure=share.part&row=${row.id}&${SEPTEMBER}`)).status).toBe(200);
  });
});
