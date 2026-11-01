import { describe, expect, it } from "vitest";
import { QUESTIONS, type QuestionId, type ReportId } from "@banking/core";
import { periodRange, PERIOD_FREE_QUESTIONS } from "../src/period.ts";
import { REPORT_PAGES, reportsOfPage } from "../src/pages/reports/registry.ts";

/**
 * Decision: whether a report page draws the period switch. Each page asks for its reports for 3 and 12 months. A page
 * whose figures are the same for both is listed in `PERIOD_FREE_QUESTIONS` (no switch), and a listed page must not
 * change, so the switch shows exactly where it does something. The data notes (`dataQuality`) are about the rows, not
 * a figure of the page, and a report a section reads for today only (`ofToday`) is left out.
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
      // the conclusion holds every question's figure, so a page is judged by its own entry in it
      const own = (k: string, v: unknown) => (k === "conclusions" ? (v as Record<string, unknown>)[id] : v);
      return Object.entries(res.body as Record<string, unknown>).filter(([k]) => k !== "dataQuality" && !today.has(k as ReportId)).map(([k, v]) => [k, own(k, v)]);
    };
    // a page with no conclusion on the demo (Yhteiset menot has no joint account) shows nothing that could change, so it cannot be judged: it keeps its switch
    const conclusions = (await app.admin.call("GET", "/api/reports?reports=conclusions")).body.conclusions as Record<string, unknown>;
    const blind = QUESTIONS.filter((id) => conclusions[id] === null);
    expect(blind).toEqual(["yhteiset"]);
    const changing: string[] = [];
    for (const id of QUESTIONS) if (JSON.stringify(await ask(id, "3m")) !== JSON.stringify(await ask(id, "12m"))) changing.push(id);
    expect(QUESTIONS.filter((id) => !PERIOD_FREE_QUESTIONS.includes(id) && !blind.includes(id))).toEqual(changing);
    for (const id of blind) expect(PERIOD_FREE_QUESTIONS, id).not.toContain(id);
  }, 60_000);
});
