import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { REPORT_SECTIONS, visibleSections } from "../src/pages/reports/registry.ts";
import { section as borrowed } from "../src/pages/reports/sections/Borrowed.tsx";
import type { ReportContext, ReportSection } from "../src/pages/reports/types.ts";

/** A context with only the parts a test reads: the sections look at nothing else. */
const context = (data: Record<string, unknown>, accounts: unknown[] = []): ReportContext => ({ data, meta: { today: "2026-10-11", accounts }, range: { from: "2026-08-01", to: "2026-08-31" }, exportHref: () => "/export.csv" }) as unknown as ReportContext;
const html = (s: ReportSection, ctx: ReportContext) => renderToStaticMarkup(createElement(s.Component, { ctx }));

/** The sections that stay (docs/design/README.md, section 2). */
const SECTION_IDS = ["kategoriat", "kuukausi", "lainat", "nostettu-luotto", "osittain", "saldot", "verovuosi", "vuodet", "yhteiset-menot"];
const plain = (out: string) => out.replace(/[\u00a0\u202f]/g, " ");

describe("Raportit: Nostettu luotto", () => {
  it("tells the credit drawn and is quiet without a draw", () => {
    const flow = (creditDrawnCents: number) => ({ categories: { creditDrawnCents } });
    expect(plain(html(borrowed, context(flow(50_000))))).toContain("Nostettu luotto ei ole tuloa");
    expect(borrowed.visible?.(context(flow(0)))).toBe(false);
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
      taxYear: { income: { types: [{}] }, refunds: { rows: [] }, interest: { rows: [] }, loanPayments: [], household: { rows: [] }, residual: { rows: [] } },
    }, [{}]);
  const ids = (page: "month" | "bills" | "reports" | "optimise" | "settings") => visibleSections(full(), page).map((s) => s.id);

  it("every section names one, and each page shows the sections that name it", () => {
    expect(REPORT_SECTIONS.map((x) => x.id).sort()).toEqual(SECTION_IDS);
    expect(ids("bills")).toEqual([]);
    expect(ids("settings")).toEqual([]);
    // Yhteiset menot needs a joint account the user is weighted in, which the full answer does not have
    expect(ids("reports")).not.toContain("yhteiset-menot");
    expect(ids("reports")).toContain("nostettu-luotto");
    // the parts of a category come only from an add-on module
    expect(ids("reports")).not.toContain("osittain");
  });

  it("Yhteiset menot shows only for a user who is weighted in a joint account", () => {
    const section = REPORT_SECTIONS.find((s) => s.id === "yhteiset-menot")!;
    const ctx = (users: { userId: string; weight: number }[]) => ({ meta: { user: { id: "u1" }, accounts: [{ use: { users } }] } }) as unknown as ReportContext;
    expect(section.visible?.(ctx([{ userId: "u1", weight: 50 }, { userId: "u2", weight: 50 }]))).toBe(true);
    // a near miss: she is named with no weight, or alone
    expect(section.visible?.(ctx([{ userId: "u1", weight: 0 }, { userId: "u2", weight: 100 }]))).toBe(false);
    expect(section.visible?.(ctx([{ userId: "u1", weight: 100 }]))).toBe(false);
  });

  it("a page renders only its own sections", () => {
    expect(ids("optimise")).toEqual([]);
  });
});
