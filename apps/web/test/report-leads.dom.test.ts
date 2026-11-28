/** The sentence each Raportit page opens with. Made-up figures only. */
import { fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "./fixed-clock.ts";
import { page as spending } from "../src/pages/reports/pages/Spending.tsx";
import { BalancesTiles } from "../src/pages/reports/sections/Balances.tsx";
import { DebtFree } from "../src/pages/DebtFree.tsx";
import type { ReportContext } from "../src/pages/reports/types.ts";

const flat = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const lead = (Lead: (props: { ctx: ReportContext }) => unknown, data: Record<string, unknown>) =>
  flat(renderToStaticMarkup(createElement(Lead as never, { ctx: { data, range: { from: "2026-09-01", to: "2026-11-11" }, meta: { today: "2026-11-11", accounts: [], sharedAccounts: [] } } as unknown as ReportContext })).replace(/<[^>]*>/g, " "));

describe("Menot kategorioittain: the tiles", () => {
  const categories = (more: Record<string, unknown>) => ({ categories: { totalCents: 250_000, debtPaidCents: 0, creditDrawnCents: 0, ...more } });
  const say = (more: Record<string, unknown>) => lead(spending.Lead!, categories(more));

  it("shows the spending, adding the debt paid and the credit drawn when there are any", () => {
    expect(say({})).toBe("Kaikki menot 2 500 €");
    expect(say({ debtPaidCents: 80_000 })).toBe("Kaikki menot 2 500 € josta velkaa 800 €");
    expect(say({ creditDrawnCents: 50_000 })).toBe("Kaikki menot 2 500 € Uutta luottoa 500 €");
    expect(say({ debtPaidCents: 80_000, creditDrawnCents: 50_000 })).toBe("Kaikki menot 2 500 € josta velkaa 800 € Uutta luottoa 500 €");
  });

  it("puts the fees and the debt paid from savings in rows, and only when each is a hundredth of the spending or more", () => {
    expect(say({ feesCents: 7_00 })).toBe("Kaikki menot 2 500 €");
    expect(say({ feesCents: 30_000 })).toBe("Kaikki menot 2 500 € Pankkikulut ja muistutusmaksut 300 €");
  });

  it("shows nothing when nothing was spent", () => {
    expect(say({ totalCents: 0 })).toBe("");
  });
});

describe("Varat ja velat: the debt-free head", () => {
  const held = { accounts: [{}], holdings: { accountsCents: 120_000, debtCents: 30_000 } };
  const head = (balances: Record<string, unknown>, loans: Record<string, unknown>) =>
    flat(renderToStaticMarkup(createElement(DebtFree as never, { ctx: { data: { balances, loans: { planSteps: [], ...loans } }, meta: { today: "2026-11-11" } } } as never)).replace(/<[^>]*>/g, " "));

  it("asks for the missing balances in place of the day, linking while one is still asked", () => {
    const lacking = { ...held, holdings: { ...held.holdings, unsavedLoans: { count: 2, rows: [{ debtId: "a" }] } } };
    expect(head(lacking, { plan: null, loans: [] })).toBe("Lisää 2 saldoa, niin näet päivän jolloin olet velaton");
  });

  it("tells the plan's debt-free month, and nothing without a plan", () => {
    const plan = { debtFreeDate: "2038-05-15", baseDebtFreeDate: "2038-05-15", debts: [{ id: "l1", order: 1, endDate: "2038-05-15", baseEndDate: "2038-05-15" }] };
    expect(head(held, { plan, loans: [{ id: "l1", name: "Asuntolaina", balance: { cents: 9_000_000 } }] })).toContain("Velaton 5/2038");
    expect(head(held, { plan: null, loans: [] })).toBe("");
  });

  it("shows the slider only with steps, and a step moves the month, strikes the old one and tells the saving", () => {
    const debt = (endDate: string) => ({ id: "l1", order: 1, endDate, baseEndDate: "2038-05-15" });
    const plan = { debtFreeDate: "2038-05-15", baseDebtFreeDate: "2038-05-15", debts: [debt("2038-05-15")] };
    const loans = [{ id: "l1", name: "Asuntolaina", balance: { cents: 9_000_000 } }];
    expect(head(held, { plan, loans })).not.toContain("/ kk");
    const steps = [
      { extraCents: 5_000, savedMoreCents: 120_000, plan: { ...plan, debtFreeDate: "2036-01-15", debts: [debt("2036-01-15")] } },
      { extraCents: 10_000, savedMoreCents: 200_000, plan: { ...plan, debtFreeDate: "2034-03-15", debts: [debt("2034-03-15")] } },
      { extraCents: 15_000, savedMoreCents: 10_000, plan },
    ];
    const view = render(createElement(DebtFree as never, { ctx: { data: { balances: held, loans: { plan, loans, planSteps: steps } }, meta: { today: "2026-11-11" } } } as never));
    const slider = view.getByRole("slider") as HTMLInputElement;
    expect(slider.max).toBe("3");
    expect(flat(view.container.textContent)).toContain("+0 € / kk");
    fireEvent.change(slider, { target: { value: "2" } });
    expect(view.container.querySelector("del")?.textContent).toBe("5/2038");
    expect(view.container.querySelector(".debt-hero")?.textContent).toBe("5/20383/2034");
    expect(flat(view.container.textContent)).toContain("+100 € / kk");
    expect(flat(view.container.textContent)).toContain("Korkoja säästyy 2 000 €");
    // a step that leaves the month as it is strikes nothing
    fireEvent.change(slider, { target: { value: "3" } });
    expect(view.container.querySelector("del")).toBeNull();
    expect(view.container.querySelector(".debt-hero")?.textContent).toBe("5/2038");
    fireEvent.change(slider, { target: { value: "0" } });
    expect(view.container.querySelector("del")).toBeNull();
    view.unmount();
  });

  it("names each lane by its loan, in the plan's order", () => {
    const debt = (id: string, order: number) => ({ id, order, endDate: "2038-05-15", baseEndDate: "2038-05-15" });
    const plan = { debtFreeDate: "2038-05-15", baseDebtFreeDate: "2038-05-15", debts: [debt("l2", 1), debt("l1", 2)] };
    const loans = [{ id: "l1", name: "Asuntolaina", balance: { cents: 9_000_000 } }, { id: "l2", name: "Autolaina", balance: { cents: 500_000 } }];
    const text = head(held, { plan, loans });
    expect(text).not.toContain("l1");
    expect(text.indexOf("Autolaina")).toBeGreaterThan(-1);
    expect(text.indexOf("Autolaina")).toBeLessThan(text.indexOf("Asuntolaina"));
  });
});

describe("Varat ja velat: the tiles", () => {
  const held = { accounts: [], accountsCents: 120_000, debtCents: 0, netCents: 120_000 };
  const owing = { accounts: [], accountsCents: 120_000, debtCents: 30_000, netCents: 90_000 };
  const markup = (holdings: Record<string, unknown>, more: Record<string, unknown> = {}) =>
    renderToStaticMarkup(createElement(BalancesTiles as never, { ctx: { data: { balances: { accounts: [{}], holdings, ...more } }, meta: { today: "2026-11-11", accounts: [], sharedAccounts: [] } } } as never));
  // the tags become spaces so a tile reads label, figure
  const say = (holdings: Record<string, unknown>, more: Record<string, unknown> = {}) => flat(markup(holdings, more).replace(/<[^>]*>/g, " "));

  it("shows what the accounts hold, what is owed and what is left, under the names the groups below have", () => {
    expect(say(held)).toBe("Tilien saldo 1 200 €");
    expect(say(owing)).toBe("Tilien saldo 1 200 € Velat yhteensä 300 € Varat velkojen jälkeen 900 €");
  });

  it("names the debts as the known ones and no net figure while the balance of a debt is missing, and leaves the ask to the head", () => {
    const open = { ...owing, netCents: null, unsavedLoans: { count: 1, rows: [{ debtId: "proposal:a" }] } };
    expect(say(open)).toBe("Tilien saldo 1 200 € Velat yhteensä, tiedossa 300 €");
    expect(markup(open)).not.toContain("href=");
    // a debt answered "En tiedä" is asked no more, and a lender's few payments never were
    const asked = { ...owing, netCents: null, unsavedLoans: { count: 1, rows: [{ debtId: "proposal:a", asked: true }] }, unsavedFewPayments: 1 };
    expect(say(asked)).toBe("Tilien saldo 1 200 € Velat yhteensä, tiedossa 300 €");
    // no known debt at all: the accounts alone, and the line
    expect(say({ ...held, netCents: null, unsavedFewPayments: 1 })).toBe("Tilien saldo 1 200 €");
    // a total that cannot be known is said, never left out
    expect(say({ ...held, debtCents: null, netCents: null })).toBe("Tilien saldo 1 200 € Velat yhteensä Ei tiedossa");
  });

  it("opens the Tilien saldo figure to the part of a traced account and to the buffer, and has no panel with neither", () => {
    // the panel is closed until the figure is pressed: the text of the opened one
    const opened = (holdings: Record<string, unknown>, more: Record<string, unknown> = {}, accounts: object[] = []) => {
      const { container, unmount } = render(createElement(BalancesTiles as never, { ctx: { data: { balances: { accounts: [{}], holdings, ...more } }, meta: { today: "2026-11-11", accounts, sharedAccounts: [] } } } as never));
      const button = container.querySelector<HTMLButtonElement>("button.fig-open");
      if (button) fireEvent.click(button);
      const text = flat(container.textContent);
      unmount();
      return { text, hasPanel: button !== null };
    };
    expect(opened(held).hasPanel).toBe(false);
    expect(opened(held, { bufferMonths: 1.4 }).text).toMatch(/Puskuri\s*1,4 kk/);
    // a buffer below zero is no length of time
    expect(opened(held, { bufferMonths: -0.3 }).hasPanel).toBe(false);
    expect(opened(held, { bufferMonths: null }).hasPanel).toBe(false);
    const joint = { ...held, accounts: [{ id: "a1", name: "Yhteistili", part: { from: 1, to: 2, of: 2 } }] };
    const traced = opened(joint, {}, [{ id: "a1", traced: true }]);
    expect(traced.text).toContain("Yhteistili");
    expect(traced.text).not.toContain("Puskuri");
  });

  it("says nothing without an account or a known balance", () => {
    expect(say(held, { accounts: [] })).toBe("");
    expect(say({ ...held, accountsCents: null })).toBe("");
  });
});
