/** Laskut: the picture of the months stands whenever the page lists anything, also when no month has a bill it counts. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Meta } from "../src/types.ts";
import { bill, calendar, month } from "./bill-calendar-fixture.ts";

let reports: unknown = null;
vi.mock("../src/hooks.ts", async (orig) => ({
  ...(await orig<typeof import("../src/hooks.ts")>()),
  useApi: (path: string) => ({ data: path.startsWith("/api/recurring") ? { series: [], marks: [] } : path.startsWith("/api/reports") ? reports : null, error: null, loading: false, reload: () => {} }),
}));

const { Bills } = await import("../src/pages/Bills.tsx");
const meta = { accounts: [], sharedAccounts: [], categories: [], today: "2026-10-11" } as unknown as Meta;
const html = () => renderToStaticMarkup(createElement(Bills, { meta, scope: "own" })).replace(/[  ]/g, " ");
const answer = (cal: ReturnType<typeof calendar>) => ({ billCalendar: cal, upcoming: { manual: [] }, fixedCosts: { monthlyCents: 0 } });

describe("Laskut: the picture of the months", () => {
  it("is there, with a noun heading and no line about the dearest month, when only a pay is listed", () => {
    const pay = bill({ date: "2026-10-25", payee: "Työnantaja", kind: "income", cents: 300_000 });
    reports = answer(calendar([month("2026-10", [pay], { incomeCents: 300_000 }), month("2026-11", [])]));
    const out = html();
    expect(out).toContain("Laskut kuukausittain</h2>");
    expect(out).toContain('aria-label="Laskut kuukausittain, 12 kuukautta"');
    expect(out).not.toContain("Kallein kuukausi");
  });

  it("tells the dearest month under the heading when there is one", () => {
    reports = answer(calendar([month("2026-10", [bill()], { billsCents: 6420, wholeBillsCents: 6420 }), month("2026-11", [])], { dearest: { month: "2026-10", billsCents: 6420 } }));
    expect(html()).toMatch(/Kallein kuukausi on lokakuu, 64\s€/);
  });
});
