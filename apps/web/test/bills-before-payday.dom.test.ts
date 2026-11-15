/**
 * Laskut starts with the payments Nyt takes off before the payday: the rows of `ahead.rows` of the dashboard answer
 * (the card bill too) and the payday as one income row; with no sum in Nyt the section is not drawn.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { Meta } from "../src/types.ts";
import { stubApi } from "./dom-kit.ts";

const flat = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ");
const row = (date: string, name: string, cents: number, source: string) => ({ date, name, cents, source, category: null });

function dashboard(known: boolean, quiet = false) {
  // quiet: nothing leaves the counted accounts before the payday, and one payment leaves another account
  const outside = quiet ? [{ ...row("2026-11-16", "Laina", -42182, "recurring"), outside: true, account: { name: "Yhteinen tili", digits: "0381" } }] : [];
  const all = [
    row("2026-11-12", "Helen", -4812, "recurring"),
    row("2026-11-15", "Elisa", -2914, "recurring"),
    row("2026-11-20", "Visa", -182228, "card"),
    row("2026-11-25", "Työnantaja", 300000, "income"),
  ];
  const rows = quiet ? all.slice(-1) : all;
  return {
    nyt: {
      left: known
        ? { known: true, payday: { date: "2026-11-25", name: "Työnantaja" }, days: 14, balanceCents: 500000, billsCents: quiet ? 0 : 189954, cardDebtCents: 0, leftCents: quiet ? 500000 : 310046, perDayCents: 22146, elsewhereCents: quiet ? 42182 : 0 }
        : { known: false, reason: "no-payday" },
      usualPerDayCents: null,
      pace: { day: 11, spentCents: 0, usual: null },
    },
    ahead: { from: "2026-11-11", to: "2026-11-24", payday: known ? { date: "2026-11-25", name: "Työnantaja", pay: { floorCents: 290000 } } : null, rows, upcoming: outside, outside },
  };
}

async function mount(known: boolean, quiet = false, answer: object = dashboard(known, quiet)) {
  const seen = stubApi({
    "GET /api/recurring": { series: [], marks: [] },
    "GET /api/reports": { upcoming: { manual: [] } },
    "GET /api/dashboard": answer,
  });
  const { queryClient } = await import("../src/query-client.ts");
  queryClient.clear();
  const { Bills } = await import("../src/pages/Bills.tsx");
  const meta = { today: "2026-11-11", categories: [], accounts: [{ id: "a", type: "checking" }], sharedAccounts: [] } as unknown as Meta;
  render(createElement(Bills, { meta, scope: "own" }));
  return { seen, queryClient };
}

describe("Laskut: payments before the payday", () => {
  it("lists the card bill and the two bills, their sum, and the payday", async () => {
    await mount(true);
    const section = await waitFor(() => {
      const el = document.getElementById("ennen-palkkapaivaa");
      expect(el).toBeTruthy();
      return el!;
    });
    expect(within(section).getByRole("heading").textContent).toBe("Maksut ennen palkkapäivää");
    // it stands in the card of Tulevat maksut, the three figures of the answer over the bars and the rows
    expect(section.closest("#tulossa")).toBeTruthy();
    const stats = [...section.querySelectorAll(".bp-stat")].map((e) => flat(e.textContent));
    expect(stats).toEqual(["Maksut ennen palkkapäivää1 900 €", "Saldo5 000 €", "Käytettävissä palkkapäivään3 100 €"]);
    // the bars: the days from today to the payday, one piece to each payment of the list and none to the pay
    expect(section.querySelectorAll(".pb-axis li").length).toBe(15);
    expect(section.querySelectorAll(".pb-axis li[data-payday]").length).toBe(1);
    expect(section.querySelectorAll(".pb-col[data-payday]").length).toBe(1);
    expect(section.querySelectorAll(".pb-piece").length).toBe(3);
    expect(section.querySelector("#before-payday-h")).toBeTruthy();
    const bills = [...section.querySelectorAll("[data-kind=bill]")].map((li) => flat(li.textContent));
    expect(bills).toEqual(["12.11.Helen48,12 €", "15.11.Elisa29,14 €", "20.11.Visa1 822,28 €"]);
    const sums = [...section.querySelectorAll("[data-kind=bill] .bp-sum")].map((e) => Number(flat(e.textContent).replace(/[^\d,]/g, "").replace(",", ".")) * 100);
    expect(Math.round(sums.reduce((a, b) => a + b, 0))).toBe(189954);
    expect(flat(section.querySelector("[data-kind=total]")?.textContent)).toContain("1 899,54 €");
    const income = section.querySelectorAll("[data-kind=income]");
    expect(income.length).toBe(1);
    expect(flat(income[0]!.textContent)).toContain("25.11.");
    expect(flat(income[0]!.textContent)).toContain("Palkkapäivä");
  });

  // a sum of nothing printed a second zero as its total, and a payment due from another account was nowhere
  it("with nothing to pay it has no total row, and names a payment that leaves another account", async () => {
    await mount(true, true);
    const section = await waitFor(() => {
      const el = document.getElementById("ennen-palkkapaivaa");
      expect(el).toBeTruthy();
      return el!;
    });
    expect(section.querySelectorAll("[data-kind=bill]").length).toBe(0);
    expect(section.querySelectorAll("[data-kind=total]").length).toBe(0);
    const out = [...section.querySelectorAll("[data-kind=outside]")].map((li) => flat(li.textContent));
    expect(out).toEqual(["16.11.Laina Yhteinen tili ·· 0381421,82 €"]);
    expect(section.querySelectorAll("[data-kind=income]").length).toBe(1);
    // the answer's own sum of them is a second figure under the first, named by the account, so the 0 € above is not read as no payments at all
    expect(flat(section.querySelector(".bp-elsewhere")?.textContent)).toBe("Tililtä Yhteinen tili ·· 0381421,82 €");
    expect(section.querySelector(".bp-elsewhere .fig")).toBeTruthy();
  });

  // `upcoming` holds 30 days, so a payday further off left the payments of the other account after day 30 out of the list
  it("names what another account pays up to a payday more than 30 days off", async () => {
    const far = dashboard(true, true);
    // the answer names no account on this row: it reads as another account, and the head names none
    const later = { ...row("2026-12-14", "Laina", -42182, "recurring"), outside: true };
    const answer = {
      nyt: { ...far.nyt, left: { ...far.nyt.left, payday: { date: "2026-12-21", name: "Työnantaja" }, days: 40, elsewhereCents: 2 * 42182 } },
      ahead: { ...far.ahead, to: "2026-12-20", payday: { date: "2026-12-21", name: "Työnantaja", pay: { floorCents: 290000 } }, rows: [row("2026-12-21", "Työnantaja", 300000, "income")], outside: [...far.ahead.outside, later] },
    };
    await mount(true, true, answer);
    const section = await waitFor(() => {
      const el = document.getElementById("ennen-palkkapaivaa");
      expect(el).toBeTruthy();
      return el!;
    });
    const out = [...section.querySelectorAll("[data-kind=outside]")].map((li) => flat(li.textContent));
    expect(out).toEqual(["16.11.Laina Yhteinen tili ·· 0381421,82 €", "14.12.Laina muulta tililtä421,82 €"]);
    expect(flat(section.querySelector(".bp-elsewhere")?.textContent)).toBe("Muilta tileiltä843,64 €");
  });

  it("opens with the next payment: its payee and its exact sum", async () => {
    const base = dashboard(true);
    await mount(true, false, { ...base, ahead: { ...base.ahead, upcoming: base.ahead.rows.slice(0, 3) } });
    const next = await waitFor(() => {
      const el = document.querySelector(".bills-next");
      expect(el).toBeTruthy();
      return el!;
    });
    expect(within(next as HTMLElement).getByRole("heading").textContent).toBe("Seuraavaksi");
    const text = flat(next.textContent);
    expect(text).toContain("Helen");
    expect(text).toContain("48,12 €");
    expect(text).not.toContain("Elisa");
  });

  it("has no line of payments from other accounts when there are none", async () => {
    await mount(true);
    const section = await waitFor(() => {
      const el = document.getElementById("ennen-palkkapaivaa");
      expect(el).toBeTruthy();
      return el!;
    });
    expect(section.querySelector(".bp-elsewhere")).toBeNull();
  });

  it("is not drawn when Nyt has no sum", async () => {
    const { seen, queryClient } = await mount(false);
    await screen.findByText("Laskut, sopimukset ja tilaukset");
    await waitFor(() => expect(seen.some((r) => r.path === "/api/dashboard")).toBe(true));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(document.getElementById("ennen-palkkapaivaa")).toBeNull();
  });
});
