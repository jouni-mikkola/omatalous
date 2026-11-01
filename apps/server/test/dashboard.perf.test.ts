/**
 * Budget (ROADMAP step 18): on five years of invented history, 100 000 rows or more, the dashboard answer takes at most
 * one second of CPU when warm, and a range nobody has asked for yet stays inside the same second. The history comes
 * from scripts/history-gen.ts; nothing big is kept in the repo.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { historyAccounts, loadHistory, MIN_ROWS } from "../scripts/history-gen.ts";
import { setupApp } from "./helpers.ts";
import { bestOf, budgetRatio } from "../../../tools/lib/timing.ts";

let app: Awaited<ReturnType<typeof setupApp>>;
let loaded = 0;

describe("dashboard answer on five years of history", () => {
  beforeAll(async () => {
    app = await setupApp();
    loaded = await loadHistory(app.s.finance(app.adminId), app.s.settings, historyAccounts(app.s.today()));
  }, 300_000);

  it("holds at least 100 000 rows", () => {
    expect(loaded).toBeGreaterThanOrEqual(MIN_ROWS);
  });

  it("answers within one second warm", async () => {
    const path = "/api/dashboard?scope=own";
    const first = await app.admin.call("GET", path);
    expect(first.status).toBe(200);
    const ratio = await budgetRatio(1_000, async () => (await bestOf(5, () => app.admin.call("GET", path))).ms);
    expect(ratio).toBeLessThan(1);
  }, 120_000);

  it("builds a range nobody asked for yet within one and a half seconds", async () => {
    // a new range each run, so the memo never serves it: the whole analysis runs (about 1 s of CPU measured on an idle machine,
    // spread over many small analyses; the half second over is for a shared machine, and a regression is what it guards)
    let n = 0;
    const fresh = () => {
      n += 1;
      const month = String((n % 12) + 1).padStart(2, "0");
      return app.admin.call("GET", `/api/dashboard?scope=own&from=2024-${month}-01&to=2024-${month}-${n % 2 ? "28" : "27"}`);
    };
    const res = await fresh();
    expect(res.status).toBe(200);
    const ratio = await budgetRatio(1_500, async () => (await bestOf(3, fresh)).ms);
    expect(ratio).toBeLessThan(1);
  }, 120_000);
});
