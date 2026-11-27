import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { REPORT_SECTIONS, visibleSections } from "../src/pages/reports/registry.ts";
import { page as spending } from "../src/pages/reports/pages/Spending.tsx";
import type { ReportContext } from "../src/pages/reports/types.ts";

/** A context with only the parts a test reads: the sections look at nothing else. */
const context = (data: Record<string, unknown>, accounts: unknown[] = []): ReportContext => ({ data, meta: { today: "2026-10-11", accounts }, range: { from: "2026-08-01", to: "2026-08-31" }, exportHref: () => "/export.csv" }) as unknown as ReportContext;

/** The sections that stay (docs/design/README.md, section 2). */
const SECTION_IDS = ["kategoriat", "lainat", "mika-muuttui", "osittain", "saldot", "tulot", "tulot-ja-menot", "vuodet", "yhteiset-menot"];
const plain = (out: string) => out.replace(/[\u00a0\u202f]/g, " ");

describe("Raportit > Menot kategorioittain: the tiles the page opens with", () => {
  const flow = (debtPaidCents: number, creditDrawnCents: number, feesCents: number, fromSavingsCents = 0) => ({ categories: { totalCents: 500_000, debtPaidCents, creditDrawnCents, feesCents }, spendingMonths: { fromSavingsCents } });
  const lead = (data: Record<string, unknown>) => plain(renderToStaticMarkup(createElement(spending.Lead!, { ctx: context(data) })));

  it("have a tile for each of the debt paid, the credit drawn and the fees that is above zero, the draw a link to its rows", () => {
    const all = lead(flow(120_000, 50_000, 4_550));
    expect(all).toContain("josta velkaa");
    expect(all).toContain("Uutta luottoa");
    expect(all).toContain("Pankkikulut ja muistutusmaksut");
    expect(all).toContain('href="#/transactions?category=credit_draw&amp;from=2026-08-01&amp;to=2026-08-31"');
    const feesOnly = lead(flow(0, 0, 4_550));
    expect(feesOnly).toContain("Pankkikulut ja muistutusmaksut");
    expect(feesOnly).not.toContain("josta velkaa");
    expect(feesOnly).not.toContain("Uutta luottoa");
  });

  it("with no debt paid, no draw and no fees the spending stands alone", () => {
    const alone = lead(flow(0, 0, 0));
    expect(alone).toContain("Menot");
    expect(alone.match(/strip-item/g)).toHaveLength(1);
  });

  it("name the debt paid from savings, which the first page's Menot leave out, only when the sum is not 0", () => {
    expect(lead(flow(0, 0, 0))).not.toContain("Säästöistä maksettu");
    expect(lead(flow(0, 0, 0, 460_00))).toMatch(/Säästöistä maksettu.*460/);
  });
});

describe("the page of a section", () => {
  /** What every section needs to be visible: the page has them all. */
  const full = () =>
    context({
      balances: { accounts: [{}] },
      yearOverYear: { comparable: true },
      categories: { comparable: true, groups: [{}], creditDrawnCents: 50_000 },
      loans: { saved: 1 },
    }, [{}]);
  const ids = (page: "month" | "bills" | "balances" | "reports" | "optimise" | "settings") => visibleSections(full(), page).map((s) => s.id);

  it("every section names one, and each page shows the sections that name it", () => {
    expect(REPORT_SECTIONS.map((x) => x.id).sort()).toEqual(SECTION_IDS);
    expect(ids("bills")).toEqual([]);
    expect(ids("settings")).toEqual([]);
    // Yhteiset menot needs a joint account the user is weighted in, which the full answer does not have
    expect(ids("reports")).not.toContain("yhteiset-menot");
    expect(ids("balances")).toEqual(["saldot", "lainat"]);
    expect(ids("reports")).not.toContain("saldot");
    // the parts of a category come only from an add-on module
    expect(ids("reports")).not.toContain("osittain");
  });

  it("Yhteiset menot shows only for a user who is weighted in a joint account", () => {
    const section = REPORT_SECTIONS.find((s) => s.id === "yhteiset-menot")!;
    const ctx = (users: { userId: string; weight: number }[], split?: "unknown") => ({ meta: { user: { id: "u1" }, accounts: [{ use: { users, split } }] } }) as unknown as ReportContext;
    expect(section.visible?.(ctx([{ userId: "u1", weight: 50 }, { userId: "u2", weight: 50 }]))).toBe(true);
    // a near miss: she is named with no weight, or alone
    expect(section.visible?.(ctx([{ userId: "u1", weight: 0 }, { userId: "u2", weight: 100 }]))).toBe(false);
    expect(section.visible?.(ctx([{ userId: "u1", weight: 100 }]))).toBe(false);
  });

  it("Yhteiset menot stays hidden while the split of the joint account is not said", () => {
    const section = REPORT_SECTIONS.find((s) => s.id === "yhteiset-menot")!;
    const ctx = (split?: "unknown") => ({ meta: { user: { id: "u1" }, accounts: [{ use: { users: [{ userId: "u1", weight: 1 }, { userId: "u2", weight: 1 }], split } }] } }) as unknown as ReportContext;
    expect(section.visible?.(ctx("unknown"))).toBe(false);
    expect(section.visible?.(ctx())).toBe(true);
  });

  it("a page renders only its own sections", () => {
    expect(ids("optimise")).toEqual([]);
  });
});
