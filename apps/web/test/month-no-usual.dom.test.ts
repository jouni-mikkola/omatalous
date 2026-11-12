/**
 * Kuukausi with no usual: the report's reason is the one shown (`usualGap` in core, which Yhteenveto's month reads too),
 * and the month's categories are listed with their sums whatever the reason, in the running month and an earlier one.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Month } from "../src/pages/reports/Month.tsx";
import { queryClient } from "../src/query-client.ts";
import { stubApi } from "./dom-kit.ts";

const meta = { today: "2026-11-11" } as never;
const range = { from: "2026-11-01", to: "2026-11-11" } as never;
const scope = "all" as never;

const groups = [{ categories: [{ category: "a", label: "Ruoka", totalCents: 50_000, count: 4 }, { category: "b", label: "Auto", totalCents: 30_000, count: 2 }] }];
const categories = { totalCents: 80_000, groups };
const income = { months: [], stability: null };

const running = (gapReason: "cards" | "history") => ({
  thisMonth: { month: "2026-11", spentCents: 80_000, expectedCents: null, gapCents: null, gapReason, categories: [] },
  categories,
  income,
});
const earlier = (gapReason: "cards" | "history" | null) => ({ spendingChange: { views: [], gapReason }, categories, income });

async function open(answer: unknown, hash: string) {
  queryClient.clear();
  window.location.hash = hash;
  stubApi({ "GET /api/reports": answer });
  render(createElement(QueryClientProvider, { client: queryClient }, createElement(Month, { meta, range, scope })));
  await screen.findByText("Ruoka");
}

const total = () => document.querySelector(".km-total")?.textContent ?? "";
const note = () => document.querySelector(".km-note")?.textContent ?? "";

describe("Kuukausi with no usual", () => {
  for (const [name, hash, of] of [
    ["the running month", "#/reports", running],
    ["an earlier month", "#/reports?month=2026-10", earlier],
  ] as const) {
    it(`${name}: a card's purchases missing before is told as that, with the sums of the categories`, async () => {
      await open(of("cards"), hash);
      expect(note()).toContain("kortin ostot puuttuvat");
      expect(total()).not.toContain("kun takana on");
      expect(screen.getByRole("table")).toBeTruthy();
      expect(screen.getByText("Auto")).toBeTruthy();
    });

    if (of === earlier) {
      it(`${name}: a usual level with no view (rows that end before the month) lists the sums and asks no wait`, async () => {
        await open(earlier(null), hash);
        expect(total()).not.toContain("kun takana on");
        expect(document.querySelector(".km-note")).toBeNull();
        expect(screen.getByText("Auto")).toBeTruthy();
      });
    }

    it(`${name}: a short history is told as that`, async () => {
      await open(of("history"), hash);
      expect(total()).toContain("kun takana on 3 kuukautta");
      expect(document.querySelector(".km-note")).toBeNull();
    });
  }
});
