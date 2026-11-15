/** Tapahtumat before its first answer is loading, not empty; an empty answer is the only empty state. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Meta } from "../src/types.ts";

type Answer = { total: number; inCents: number; outCents: number; items: unknown[] } | null;
let answer: Answer = null;
vi.mock("../src/hooks.ts", async (orig) => ({
  ...(await orig<typeof import("../src/hooks.ts")>()),
  useApi: () => ({ data: answer, error: null, loading: answer === null, reload: () => {} }),
}));
vi.mock("../src/pages/TransactionRows.tsx", async (orig) => ({ ...(await orig<typeof import("../src/pages/TransactionRows.tsx")>()), usePhone: () => false }));

const { Transactions } = await import("../src/pages/Transactions.tsx");
const meta = { accounts: [], sharedAccounts: [], categories: [], today: "2026-10-13" } as unknown as Meta;
const render = () => renderToStaticMarkup(createElement(Transactions, { meta, params: new URLSearchParams(), scope: "own" }));
const row = { id: "t1", merchant: "ESIMERKKI OY", bookingDate: "2026-10-12", amountCents: -1250, category: "other", accountId: "a", own: true };

describe("Tapahtumat first load", () => {
  it("shows the loading state and no empty state before the first answer", () => {
    answer = null;
    const out = render();
    expect(out).toContain('role="status"');
    expect(out).not.toContain("Tapahtumia ei vielä ole");
  });

  it("shows the rows, not the loading state, once they are there", () => {
    answer = { total: 1, inCents: 0, outCents: 1250, items: [row] };
    const out = render();
    expect(out).toContain("ESIMERKKI OY");
    expect(out).not.toContain('class="stack" role="status"');
  });

  it("shows the empty state only for an answer with zero rows", () => {
    answer = { total: 0, inCents: 0, outCents: 0, items: [] };
    const out = render();
    expect(out).toContain("Tapahtumia ei vielä ole");
    expect(out).not.toContain('class="stack" role="status"');
  });
});
