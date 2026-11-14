/** Kuukausi: the rest row ("Muut kategoriat") opens to the categories it holds, in the running month and in an earlier one. */
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Month } from "../src/pages/reports/Month.tsx";
import { queryClient } from "../src/query-client.ts";
import { failing, stubApi } from "./dom-kit.ts";

const meta = { today: "2026-11-11" } as never;
const range = { from: "2026-11-01", to: "2026-11-11" } as never;
const scope = "all" as never;

const cat = (category: string, label: string, totalCents: number) => ({ category, label, totalCents });
const groups = [{ categories: [cat("a", "Ruoka", 50_000), cat("b", "Auto", 30_000), cat("c", "Vuokra", 90_000), cat("d", "Muu menot", 16_252)] }];
const gap = (category: string | null, label: string, spentCents: number) => ({ category, day: null, label, spentCents, expectedCents: spentCents, gapCents: 0 });
const income = { months: [], stability: null };

const running = (rest: boolean) => ({
  thisMonth: {
    month: "2026-11",
    spentCents: 186_252,
    expectedCents: 150_000,
    gapCents: 36_252,
    gapReason: null,
    categories: [gap("a", "Ruoka", 50_000), gap("b", "Auto", 30_000), ...(rest ? [gap(null, "Muut kategoriat", 106_252)] : [gap("c", "Vuokra", 90_000), gap("d", "Muu menot", 16_252)])],
  },
  categories: { totalCents: 186_252, groups },
  income,
});

const view = (rest: boolean) => ({
  spendingChange: {
    views: [
      {
        view: "expected",
        change: {
          target: { months: ["2026-10"], from: "2026-10-01", to: "2026-10-31" },
          nowCents: 186_252,
          baseCents: 150_000,
          changeCents: 36_252,
          categories: [
            { category: "a", label: "Ruoka", nowCents: 50_000, baseCents: 50_000, changeCents: 0 },
            { category: "b", label: "Auto", nowCents: 30_000, baseCents: 30_000, changeCents: 0 },
            ...(rest ? [{ category: null, label: "Muut (2)", nowCents: 106_252, baseCents: 70_000, changeCents: 36_252 }] : [{ category: "c", label: "Vuokra", nowCents: 106_252, baseCents: 70_000, changeCents: 36_252 }]),
          ],
        },
      },
    ],
  },
  categories: { totalCents: 186_252, groups },
  income,
});

async function open(answer: unknown, hash: string) {
  queryClient.clear();
  window.location.hash = hash;
  const seen = stubApi({ "GET /api/reports": answer, "GET /api/explain": failing(500, { error: "x" }) });
  render(createElement(QueryClientProvider, { client: queryClient }, createElement(Month, { meta, range, scope })));
  return seen;
}

const sum = (text: string) => Number(text.replace(/[^\d,-]/g, "").replace(",", ""));

describe("Kuukausi rest row", () => {
  for (const [name, hash, answer] of [
    ["the running month", "#/reports", running(true)],
    ["an earlier month", "#/reports?month=2026-10", view(true)],
  ] as const) {
    it(`opens to its categories in ${name}`, async () => {
      const seen = await open(answer, hash);
      const toggle = await screen.findByRole("button", { name: "Muut kategoriat", expanded: false });
      const asked = vi.mocked(fetch).mock.calls.map((c) => new URL(String(c[0]), "http://localhost"));
      const reports = asked.find((u) => u.pathname === "/api/reports")!;
      expect(reports.searchParams.get("reports")).toContain("categories");
      if (name === "the running month") expect([reports.searchParams.get("from"), reports.searchParams.get("to")]).toEqual(["2026-11-01", "2026-11-11"]);
      expect(seen.length).toBeGreaterThan(0);
      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      const table = screen.getByRole("table");
      expect(within(table).getByText("Vuokra")).toBeTruthy();
      expect(within(table).getByText("Muu menot")).toBeTruthy();
      expect(within(table).queryAllByText("Ruoka")).toHaveLength(1);
      const doors = table.querySelectorAll(".why-door");
      expect(doors.length).toBeGreaterThanOrEqual(4);
      fireEvent.click(within(table).getByRole("button", { name: /Vuokra/ }));
      const explain = await vi.waitFor(() => {
        const u = vi.mocked(fetch).mock.calls.map((c) => new URL(String(c[0]), "http://localhost")).find((x) => x.pathname === "/api/explain")!;
        expect(u).toBeTruthy();
        return u;
      });
      expect(explain.searchParams.get("figure")).toBe("spend.category");
      expect(explain.searchParams.get("category")).toBe("c");
      const listed = ["Vuokra", "Muu menot"].map((n) => sum(within(table).getByText(n).closest("tr")!.querySelectorAll("td")[0]!.textContent!));
      expect(listed.reduce((a, b) => a + b, 0)).toBe(106_252);
    });
  }

  it("draws no toggle when the list has no rest row", async () => {
    await open(running(false), "#/reports");
    await screen.findByText("Vuokra");
    expect(screen.queryByRole("button", { name: "Muut kategoriat" })).toBeNull();
    expect(document.querySelector("[aria-expanded]")).toBeNull();
  });
});

describe("Kuukausi heading and income line", () => {
  it("names the running month with its year, and the days read under it", async () => {
    await open({ ...running(false), income: { months: [{ month: "2026-11", totalCents: 9_900, earnedCents: 2_300, usualCents: 398_000 }], stability: { medianCents: 395_000 } } }, "#/reports");
    expect((await screen.findByRole("heading", { level: 2 })).textContent).toBe("Marraskuu 2026");
    expect(document.querySelector(".km-days")?.textContent).toBe("1.–11.11.");
    // the earned income and its usual level, as Yhteenveto's tile says them: not the sum of every kind of money in, and not the regular median
    expect(document.querySelector(".km-income")?.textContent?.replace(/\s/g, " ")).toBe("Tulot 23 €, tavallisesti 3 980 € kuussa");
  });

  it("names an ended month alone: it is read whole", async () => {
    await open(view(false), "#/reports?month=2026-10");
    expect((await screen.findByRole("heading", { level: 2 })).textContent).toBe("Lokakuu 2026");
    expect(document.querySelector(".km-days")).toBeNull();
  });
});
