/** The sums above Tapahtumat are of the rows the filter shows and say that own transfers are not in them. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Meta } from "../src/types.ts";

const answer = { total: 2, inCents: 2000_00, outCents: 25_50, items: [] as unknown[] };
vi.mock("../src/hooks.ts", async (orig) => ({
  ...(await orig<typeof import("../src/hooks.ts")>()),
  useApi: (path: string) => ({ data: path.startsWith("/api/merchants/summary") ? { summary: null } : answer, error: null, loading: false, reload: () => {} }),
}));
vi.mock("../src/pages/TransactionRows.tsx", async (orig) => ({ ...(await orig<typeof import("../src/pages/TransactionRows.tsx")>()), usePhone: () => false }));

const { Transactions } = await import("../src/pages/Transactions.tsx");
const meta = { accounts: [], sharedAccounts: [], categories: [], today: "2026-10-13" } as unknown as Meta;
const render = (params: string) => renderToStaticMarkup(createElement(Transactions, { meta, params: new URLSearchParams(params), scope: "own" })).replace(/[  ]/g, " ");

describe("Tapahtumat totals", () => {
  it("say that own transfers are left out, and that a list with no period is the whole history", () => {
    const all = render("");
    expect(all).toContain("Maksettu");
    expect(all).toContain("Koko historia");
    expect(all).toContain("Siirrot omien tilien välillä eivät ole mukana.");
    const september = render("from=2026-09-01&to=2026-09-30");
    expect(september).toContain("Siirrot omien tilien välillä eivät ole mukana.");
    expect(september).not.toContain("Koko historia");
  });

  it("name the payee the list is filtered to", () => {
    expect(render("merchant=Ruokakauppa&from=2026-09-01")).toMatch(/Ruokakauppa, /);
  });
});
