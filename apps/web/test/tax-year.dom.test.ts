/**
 * Asetukset > Tiedot, Verovuoden rivit: the card asks the server for the whole calendar year, and Viime vuosi asks for the
 * year before the running one. It tells its page once it has its rows, so an address that names the card can scroll to it.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../src/query-client.ts";
import { TaxYear } from "../src/pages/settings/TaxYear.tsx";
import type { Meta } from "../src/types.ts";
import "./fixed-clock.ts";

const meta = { today: "2026-11-11", categories: [] } as unknown as Meta;

/** The year the report is for; an answer holds only the fields the card reads to draw its heading. */
const answerOf = (year: number) => ({
  taxYear: {
    year,
    range: { from: `${year}-01-01`, to: `${year}-12-31` },
    partial: false,
    income: { totalCents: 0, types: [] },
    refunds: { cents: 0, rows: [] },
    residual: { cents: 0, rows: [] },
    interest: { cents: 0, rows: [] },
    loanPayments: [],
    household: { cents: 0, rows: [] },
  },
});

/** Every request is answered with the report of the year its `from` names; the paths asked are returned in order. */
function stubReports(): string[] {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      asked.push(input);
      const year = Number(new URL(input, "http://localhost").searchParams.get("from")?.slice(0, 4));
      return new Response(JSON.stringify(answerOf(year)), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  return asked;
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("Verovuoden rivit", () => {
  it("asks for this calendar year, and for the year before it after Viime vuosi", async () => {
    const asked = stubReports();
    render(createElement(TaxYear, { meta }));
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]).toContain("from=2026-01-01&to=2026-12-31");
    expect(asked[0]).toContain("reports=taxYear");
    fireEvent.click(await screen.findByRole("button", { name: "Viime vuosi" }));
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1]).toContain("from=2025-01-01&to=2025-12-31");
    await waitFor(() => expect(screen.getByRole("button", { name: "Viime vuosi" }).getAttribute("aria-pressed")).toBe("true"));
  });

  it("tells its page once that it has its rows", async () => {
    stubReports();
    const loaded = vi.fn();
    render(createElement(TaxYear, { meta, onLoaded: loaded }));
    await waitFor(() => expect(loaded).toHaveBeenCalledTimes(1));
    expect(loaded).toHaveBeenCalledWith(false);
    fireEvent.click(await screen.findByRole("button", { name: "Viime vuosi" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Viime vuosi" }).getAttribute("aria-pressed")).toBe("true"));
    expect(loaded).toHaveBeenCalledTimes(1);
  });
});
