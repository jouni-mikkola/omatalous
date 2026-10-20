/**
 * Today's figures of the first page open their basis (explain/now.ts): Tileillä the accounts' balances, Käytettävissä the
 * checking accounts' balances and the window's payments, the pay the window waits for the pays its estimate rests on. Each
 * is the dashboard's own figure, and every line of it is named. Read on the demo household.
 */
import { describe, expect, it } from "vitest";
import { setupApp } from "./helpers.ts";

type Answer = { figure: string; cents: number | null; lines: { id: string; cents: number; day: string }[]; check: { kind: string; diffCents?: number }; method?: { kind: string; rule: string }; rows: { id: string; merchant: string }[] };

async function demo() {
  const app = await setupApp();
  expect((await app.admin.call("POST", "/api/demo")).status).toBe(200);
  const dashboard = (await app.admin.call("GET", "/api/dashboard")).body as { holdings: { accountsCents: number | null }; ahead: { balance: { freeCents: number } | null; payday: { name: string; pay: { floorCents: number; usualCents: number; kind: string; count: number } | null } | null } };
  const explain = async (figure: string) => (await app.admin.call("GET", `/api/explain?figure=${figure}`)).body as Answer;
  return { app, dashboard, explain };
}

/** Every line has a name in the answer's rows. */
const named = (a: Answer) => {
  const ids = new Set(a.rows.map((r) => r.id));
  expect(a.lines.filter((l) => !ids.has(l.id))).toEqual([]);
};

describe("the basis of today's figures", () => {
  it("Tileillä, Käytettävissä and the pay estimate add up to the dashboard's figures, every line named", async () => {
    const { dashboard, explain } = await demo();
    const accounts = await explain("holdings.accounts");
    expect(accounts.cents).toBe(dashboard.holdings.accountsCents);
    expect(accounts.check).toEqual({ kind: "sum", diffCents: 0 });
    expect(accounts.lines.length).toBeGreaterThan(0);
    named(accounts);

    const free = await explain("ahead.free");
    expect(dashboard.ahead.balance).not.toBeNull();
    expect(free.cents).toBe(dashboard.ahead.balance!.freeCents);
    expect(free.check).toEqual({ kind: "sum", diffCents: 0 });
    // the balances first, above zero, then the payments, each money out
    expect(free.lines[0]!.id).toMatch(/^a:/);
    expect(free.lines.filter((l) => l.id.startsWith("due:")).every((l) => l.cents < 0)).toBe(true);
    named(free);

    const pay = await explain("ahead.pay");
    const estimate = dashboard.ahead.payday!.pay!;
    expect(pay.cents).toBe(estimate.kind === "steady" ? estimate.usualCents : estimate.floorCents);
    expect(pay.method?.kind).toBe("estimate");
    expect(pay.lines).toHaveLength(estimate.count);
    // the pays are the payer's rows, named as the list of rows names them
    expect(new Set(pay.rows.map((r) => r.merchant))).toEqual(new Set([dashboard.ahead.payday!.name]));
    named(pay);
  });

  it("takes no range part, account or category: a today figure is the whole view's", async () => {
    const { app } = await demo();
    expect((await app.admin.call("GET", "/api/explain?figure=ahead.free&category=groceries")).status).toBe(400);
  });
});
