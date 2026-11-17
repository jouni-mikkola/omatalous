/** The sums above Tapahtumat are of the rows the filter shows; a list with no period is the running month, and period=all is the whole history. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Meta } from "../src/types.ts";

const answer: Record<string, unknown> = { total: 2, inCents: 2000_00, outCents: 25_50, items: [] as unknown[] };
vi.mock("../src/hooks.ts", async (orig) => ({
  ...(await orig<typeof import("../src/hooks.ts")>()),
  useApi: (path: string) => ({ data: path.startsWith("/api/merchants/summary") ? { summary: null } : answer, error: null, loading: false, reload: () => {} }),
}));
vi.mock("../src/pages/TransactionRows.tsx", async (orig) => ({ ...(await orig<typeof import("../src/pages/TransactionRows.tsx")>()), usePhone: () => false }));

const { Transactions } = await import("../src/pages/Transactions.tsx");
const meta = { accounts: [], sharedAccounts: [], categories: [], today: "2026-10-13" } as unknown as Meta;
const render = (params: string) => renderToStaticMarkup(createElement(Transactions, { meta, params: new URLSearchParams(params), scope: "own" })).replace(/[  ]/g, " ");

describe("Tapahtumat totals", () => {
  it("say that a list with no period is the running month and period=all the whole history", () => {
    expect(render("")).toContain("Tämä kuu");
    expect(render("")).not.toContain("Koko historia");
    const all = render("period=all");
    expect(all).toContain("Menot");
    // the tab names the page: no heading repeats it
    expect(all).not.toMatch(/<h[12][^>]*>Tapahtumat</);
    expect(all).toContain("Koko historia");
    const september = render("from=2026-09-01&to=2026-09-30");
    expect(september).toContain("Menot");
    expect(september).not.toContain("Koko historia");
  });

  it("tell that they are updating, and no sum, while the server has none", () => {
    const was = { ...answer };
    Object.assign(answer, { inCents: null, outCents: null, netCents: null, savedCents: null, histogram: null });
    try {
      const out = render("period=all");
      expect(out).toContain("Summat päivittyvät");
      expect(out).not.toContain("Erotus");
      expect(out).not.toContain("0 €");
    } finally {
      Object.assign(answer, was);
    }
  });

  it("are not shown under a chip, which narrows the rows in the browser: the server's sums would be of other rows", () => {
    expect(render("chip=manual")).not.toContain("Erotus");
    expect(render("chip=pending&from=2026-09-01")).not.toContain("Erotus");
  });

  it("name the payee the list is filtered to in its Kauppias chip, and in no note under the sums", () => {
    const out = render("merchant=Ruokakauppa&from=2026-09-01");
    expect(out).toMatch(/Kauppias[^]*Ruokakauppa/);
    expect(out).not.toContain("tx-totals-note");
    expect(out).not.toMatch(/Ruokakauppa\. /);
  });
});
