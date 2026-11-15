import { describe, expect, it } from "vitest";
import { QUESTIONS, type QuestionId, type ReportId } from "@banking/core";
import { periodRange, PERIOD_FREE_QUESTIONS } from "../src/period.ts";
import { REPORT_PAGES, reportsOfPage } from "../src/pages/reports/registry.ts";

/**
 * Decision: whether a report page draws the period switch. Each page asks for its reports for 3 and 12 months. A page
 * whose figures are the same for both is listed in `PERIOD_FREE_QUESTIONS` (no switch), and a listed page must not
 * change, so the switch shows exactly where it does something. A report a section reads for today only (`ofToday`) is left out.
 */
const TODAY = "2026-10-09";

describe("the period switch of a report page", () => {
  it("is drawn only where a figure of the page changes with the period", async () => {
    const { setupApp } = await import("../../server/test/helpers.ts");
    const app = await setupApp({}, undefined, { now: () => new Date(`${TODAY}T10:00:00Z`) });
    expect((await app.admin.call("POST", "/api/demo")).status).toBe(200);
    expect(REPORT_PAGES.map((p) => p.id)).toEqual([...QUESTIONS]);
    const ask = async (id: QuestionId, period: string) => {
      const page = REPORT_PAGES.find((p) => p.id === id)!;
      const today = new Set(page.sections.flatMap((s) => s.ofToday ?? []));
      const { from, to } = periodRange(period, TODAY, "last-month");
      const res = await app.admin.call("GET", `/api/reports?from=${from}&to=${to}&scope=own&reports=${reportsOfPage(page).join(",")}`);
      expect(res.status).toBe(200);
      return Object.entries(res.body as Record<string, unknown>).filter(([k]) => !today.has(k as ReportId));
    };
    // a page that follows the year of the period alone would keep its switch unjudged; none does now that Tulot lists the income of the period
    const yearOnly: QuestionId[] = [];
    const changing: string[] = [];
    for (const id of QUESTIONS) if (JSON.stringify(await ask(id, "3m")) !== JSON.stringify(await ask(id, "12m"))) changing.push(id);
    expect(QUESTIONS.filter((id) => !PERIOD_FREE_QUESTIONS.includes(id) && !yearOnly.includes(id))).toEqual(changing);
    for (const id of yearOnly) expect(PERIOD_FREE_QUESTIONS, id).not.toContain(id);
  }, 60_000);
});
