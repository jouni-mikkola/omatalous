/** A figure opens its parts as a panel: Escape, an outside click and its own button close it and focus returns to the figure; the Menot panel shows the parts core gave. Made-up figures only. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "./fixed-clock.ts";
import { FigurePanel } from "../src/components/FigurePanel.tsx";
import { cashflowSpendPanel } from "../src/pages/reports/MenotPanels.tsx";
import type { ReportContext } from "../src/pages/reports/types.ts";

afterEach(cleanup);

const flat = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

describe("FigurePanel", () => {
  const mount = () =>
    render(createElement("div", null, createElement(FigurePanel as never, { label: "Osat", figure: "1 000 €" }, createElement("p", null, "rivi")), createElement("p", null, "ulkona")));

  it("opens under the figure and closes on Escape with focus back on the figure", () => {
    mount();
    const figure = screen.getByRole("button", { name: "1 000 €" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(figure);
    expect(screen.getByRole("dialog", { name: "Osat" }).textContent).toContain("rivi");
    expect(figure.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(figure);
  });

  it("closes on a press outside and keeps open on a press inside", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "1 000 €" }));
    fireEvent.pointerDown(screen.getByText("rivi"));
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.pointerDown(screen.getByText("ulkona"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Menot panel of Tulot ja menot", () => {
  const month = (m: string, cents: number) => ({ month: m, cents, from: `${m}-01`, to: `${m}-28` });
  const ctx = (usual: unknown) =>
    ({
      data: {
        figureParts: {
          cashflowSpend: { cents: 300_000, months: [month("2026-08", 100_000), month("2026-09", 200_000)], usual },
          categorySpend: { cents: 350_000, completeMonthsCents: 300_000, partialMonths: [month("2026-10", 50_000)], fromSavingsCents: 0, otherCents: 0, monthsInRange: 3, completeMonths: 2 },
        },
      },
      range: { from: "2026-08-01", to: "2026-10-20" },
      running: "2026-10",
      meta: { today: "2026-10-20", accounts: [], sharedAccounts: [] },
    }) as unknown as ReportContext;

  it("lists the months and the usual month from the parts it is given, and the bridge to the categories' figure", () => {
    const panel = cashflowSpendPanel(ctx({ cents: 140_000, months: 2, largePurchasesCents: 20_000 }));
    const text = flat(render(createElement("div", null, panel!.content as never)).container.textContent);
    expect(text).toContain("1 000 €");
    expect(text).toContain("2 000 €");
    expect(text).toContain("3 000 €");
    expect(text).toContain("1 400 €");
    expect(text).toContain("3 500 €");
  });

  it("has no usual month block when core gave none", () => {
    const panel = cashflowSpendPanel(ctx(null));
    const text = flat(render(createElement("div", null, panel!.content as never)).container.textContent);
    expect(text).not.toContain("1 400 €");
  });
});
