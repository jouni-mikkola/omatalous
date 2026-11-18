/**
 * The one store of what a cached context keeps (`memoOn`): the named answers, the dashboard answers and the context
 * without the bills marked wrong share one key rule and one eviction rule, and a write or another user's context
 * never reaches an old answer.
 */
import { type AnalysisContext, type BalanceInput, type DateRange, seriesMarkSubject, type UserMark } from "@banking/core";
import { describe, expect, it } from "vitest";
import { contextOf, demoHousehold } from "../../../tools/findings/households.ts";
import { memoOn } from "../src/services/context-memo.ts";
import { dashboardOf } from "../src/services/dashboard-memo.ts";
import { stampOf } from "../src/services/request-inputs.ts";
import { withoutWrongBills } from "../src/services/wrong-bills.ts";
import { seedCsv } from "./csv-seed.ts";
import { setupApp } from "./helpers.ts";

const HEADER = "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta";
const OWN = "FI12 1234 5600 0785 41";
const csvOf = (shop: string) => [HEADER, ...[1, 2, 3].map((i) => `2026/09/0${i};-${5 + i},00;${OWN};;;${shop} ${i};;EUR`)].join("\n");

const h = demoHousehold();
const month: DateRange = { from: "2025-03-01", to: "2025-03-28" };
const readOf = (balances: BalanceInput[]) => ({ balances, inputs: h.inputs, stamp: stampOf(balances, h.inputs) });

describe("the one memo store", () => {
  it("keeps an answer per name and arguments, and builds again for other arguments", () => {
    const ctx = contextOf(h);
    let built = 0;
    const ask = (name: string, args: unknown) => memoOn(ctx, name, args, () => ({ built: ++built }));
    const first = ask("a", [1]);
    expect(ask("a", [1])).toBe(first);
    expect(ask("a", [2])).not.toBe(first);
    expect(ask("b", [1])).not.toBe(first);
    expect(built).toBe(3);
  });

  it("lets the oldest argument set of a name go at the cap, which a call may set", () => {
    const ctx = contextOf(h);
    const ask = (name: string, n: number, cap?: number) => memoOn(ctx, name, n, () => ({ n }), cap);
    const first = ask("default", 0);
    for (let n = 1; n <= 3; n++) ask("default", n);
    expect(ask("default", 0)).toBe(first);
    ask("default", 4);
    expect(ask("default", 0)).not.toBe(first);

    const wide = ask("wide", 0, 6);
    for (let n = 1; n <= 5; n++) ask("wide", n, 6);
    expect(ask("wide", 0, 6)).toBe(wide);
    ask("wide", 6, 6);
    expect(ask("wide", 0, 6)).not.toBe(wide);
  });

  it("keeps the dashboard and the wrong-bill context in the same store", () => {
    const ctx = contextOf(h);
    const series = ctx.recurring.find((r) => r.kind === "bill");
    expect(series, "a bill of the demo household").toBeTruthy();
    const marks: UserMark[] = [{ subject: `not-recurring:${seriesMarkSubject(series!).slice("series:".length)}`, mark: "dismissed", markedAt: "2025-03-01T00:00:00Z" }];
    const without = withoutWrongBills(ctx, marks);
    expect(without).not.toBe(ctx);
    expect(without.recurring.length).toBeLessThan(ctx.recurring.length);
    expect(withoutWrongBills(ctx, marks)).toBe(without);
    const read = readOf([...h.balances]);
    const dashboard = dashboardOf(ctx, month, read, []);
    expect(dashboardOf(ctx, month, read, [])).toBe(dashboard);
    // the same name and arguments the callers use come from the store the helpers fill
    expect(memoOn(ctx, "dashboard", [month, read.stamp, read.balances.map(() => null), [], "fi", []], () => null)).toBe(dashboard);
    expect(memoOn(ctx, "without-wrong-bills", [marks[0]!.subject.replace("not-recurring:", "series:")], () => null)).toBe(without);
  });

  it("drops every kept answer when a write makes a new context, and shares none between two users", async () => {
    const { admin, member, s, adminId } = await setupApp();
    const eero = await member("eero");
    await seedCsv(s, admin, { content: csvOf("KAUPPA"), accountName: "Tili" });
    await seedCsv(s, eero, { content: csvOf("TOINEN"), accountName: "Tili" });
    const keep = (ctx: AnalysisContext) => ({
      named: memoOn(ctx, "named", [1], () => ({})),
      dashboard: dashboardOf(ctx, month, readOf([]), []),
      cut: memoOn(ctx, "without-wrong-bills", ["series:x"], () => ({})),
    });
    const mine = (await s.analysis.get(s, adminId, "own")).ctx;
    const theirs = (await s.analysis.get(s, eero.id, "own")).ctx;
    const mineKept = keep(mine);
    const theirsKept = keep(theirs);
    // the same names and arguments in two users' contexts are two entries
    expect(mine).not.toBe(theirs);
    for (const k of Object.keys(mineKept) as (keyof typeof mineKept)[]) expect(theirsKept[k]).not.toBe(mineKept[k]);
    for (const k of Object.keys(mineKept) as (keyof typeof mineKept)[]) expect(keep(mine)[k]).toBe(mineKept[k]);

    // a write of the first user builds a new context: nothing kept beside the old one is found there, and the other user's stay
    const row = (await admin.call("GET", "/api/transactions?limit=1")).body.items[0];
    await admin.call("PATCH", `/api/transactions/${row.id}`, { category: "restaurants" });
    const written = (await s.analysis.get(s, adminId, "own")).ctx;
    expect(written).not.toBe(mine);
    const writtenKept = keep(written);
    for (const k of Object.keys(mineKept) as (keyof typeof mineKept)[]) expect(writtenKept[k]).not.toBe(mineKept[k]);
    expect((await s.analysis.get(s, eero.id, "own")).ctx).toBe(theirs);
    for (const k of Object.keys(theirsKept) as (keyof typeof theirsKept)[]) expect(keep(theirs)[k]).toBe(theirsKept[k]);
  });
});
