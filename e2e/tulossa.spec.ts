import { expect, test, type BrowserContext } from "@playwright/test";
import { join } from "node:path";
import { parseSeriesId } from "../packages/core/src/recurring.ts";
import { cents, watch } from "./helpers.ts";

// Tulossa (docs/design/README.md 1.3) on the demo household of the administrator that e2e/run.mjs made: a bill the
// history cannot know is added by hand, is a row of the one list and is in the payments Nyt takes off the balance; and
// a row of the list opens the bill's earlier payments with their sum.
// The demo's dates follow the day the spec runs, so the due day is read from the window the API gives.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };
const NAME = "E2E-puuttuva lasku";
const CENTS = 4_321;

interface Dashboard {
  ahead: { from: string; to: string };
  home: { runway: { sum: { paymentsCents: number; freeCents: number } } };
}
const dashboardOf = async (context: BrowserContext): Promise<Dashboard> => (await context.request.get("/api/dashboard")).json();

interface Series {
  id: string;
  merchant: string;
  kind: string;
  active: boolean;
}

test("a row of Tulossa opens the bill's earlier amounts, and their sum is the sum of the rows behind them", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  try {
    // a bill of the demo household that is the only series of its payee, so the row is named by the payee alone
    const { series } = (await (await context.request.get("/api/recurring")).json()) as { series: Series[] };
    const bill = series.find((s) => s.kind === "bill" && s.active && parseSeriesId(s.id)?.direction === "out" && series.filter((o) => o.merchant === s.merchant).length === 1);
    expect(bill, "a bill in the demo household").toBeTruthy();
    const { accountId } = parseSeriesId(bill!.id)!;
    // the rows behind it: the payee's transactions on the bill's account
    const behind = (await (await context.request.get(`/api/transactions?merchant=${encodeURIComponent(bill!.merchant)}&accountId=${encodeURIComponent(accountId)}&limit=100`)).json()) as { total: number; items: { amountCents: number; partCents?: number }[] };
    expect(behind.items.length).toBe(behind.total);
    expect(behind.items.length).toBeGreaterThan(1);
    const paid = behind.items.map((r) => -(r.partCents ?? r.amountCents));

    await page.goto("/#/bills");
    const row = page.locator("#laskut-taulukko tbody tr").filter({ has: page.getByRole("button", { name: `Tiedot: ${bill!.merchant}`, exact: true }) });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: `Tiedot: ${bill!.merchant}`, exact: true }).click();
    const history = page.locator(".sub-drill .rt-drillrows");
    await expect(history.locator("tbody tr").first()).toBeVisible();

    // the earlier amounts, one row a payment, are the rows behind the bill
    const shown = (await history.locator("tbody tr td:last-child").allInnerTexts()).map(cents);
    expect(shown).toEqual(paid);
    // and the sum the row tells is their sum
    const sum = cents(await history.locator(".rt-drill-total dd").innerText());
    expect(sum).toBe(shown.reduce((a, b) => a + b, 0));
    expect(sum).toBe(paid.reduce((a, b) => a + b, 0));

    // a series that is one product among several of its payee has no rows of its own to ask for: its row opens with no
    // history, never with the payments of the payee's other products
    await page.getByRole("button", { name: `Tiedot: ${bill!.merchant}`, exact: true }).click();
    await expect(history).toHaveCount(0);
    const products = series.filter((s) => s.active && typeof parseSeriesId(s.id)?.product === "number");
    let opened = 0;
    for (const s of products) {
      const p = parseSeriesId(s.id)!;
      // the row's name is the payee and the product's price (format.ts `seriesName`)
      const button = page.locator("#laskut-taulukko").getByRole("button", { name: new RegExp(`^Tiedot: ${p.merchant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\d`) }).first();
      if ((await button.count()) === 0) continue;
      await button.click();
      await expect(page.locator(".sub-drill")).toBeVisible();
      await expect(history).toHaveCount(0);
      await button.click();
      opened += 1;
    }
    expect(opened, "product rows of the demo household opened").toBeGreaterThan(0);
    expect(seen.problems).toEqual([]);
  } finally {
    await context.close();
  }
});

/** The payments of Nyt's sum row as the page shows them. */
async function paymentsOnNyt(context: BrowserContext): Promise<number> {
  const page = await context.newPage();
  await page.goto("/#/overview");
  const row = page.locator(".home-sum-row");
  const shown = Math.abs(cents(await row.locator("div", { has: page.getByText("Maksut ennen palkkapäivää", { exact: true }) }).first().locator("dd").innerText()));
  await page.close();
  return shown;
}

test("a missing bill added by hand on Tulossa is a row of the list and is in the Nyt sum", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  const before = await dashboardOf(context);
  expect(await paymentsOnNyt(context)).toBe(before.home.runway.sum.paymentsCents);
  // a day of the window Nyt counts: tomorrow when the window reaches it
  const tomorrow = new Date(Date.parse(before.ahead.from) + 86_400_000).toISOString().slice(0, 10);
  const due = tomorrow <= before.ahead.to ? tomorrow : before.ahead.from;

  try {
    await page.goto("/#/bills");
    // the list only: no timeline, no sum lines, no price steps and no contract panel
    await expect(page.locator(".bills-time-sum, .bills-time-rows, .nd-axis, .ps-plot")).toHaveCount(0);
    await page.locator("#tulossa").getByRole("button", { name: "Lisää lasku" }).click();
    const form = page.getByRole("dialog", { name: "Lisää lasku" });
    await form.getByLabel("Nimi").fill(NAME);
    await form.getByLabel("Summa").fill("43,21");
    await form.getByLabel("Eräpäivä").fill(due);
    await form.getByLabel("Toistuu").selectOption({ label: "kerran" });
    await form.getByRole("button", { name: "Lisää lasku" }).click();
    await expect(form).toHaveCount(0);

    // in the list, with its sum
    const row = page.locator("#laskut-taulukko tbody tr").filter({ has: page.locator("button.rt-drill") }).filter({ hasText: NAME });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("43,21");

    // in the Nyt sum: the payments grew by the bill and what is left shrank by it
    const after = await dashboardOf(context);
    expect(after.home.runway.sum.paymentsCents).toBe(before.home.runway.sum.paymentsCents + CENTS);
    expect(after.home.runway.sum.freeCents).toBe(before.home.runway.sum.freeCents - CENTS);
    expect(await paymentsOnNyt(context)).toBe(after.home.runway.sum.paymentsCents);
    expect(seen.problems).toEqual([]);
  } finally {
    // the demo household is shared with the other specs of the worker
    const { bills } = (await (await context.request.get("/api/expected-bills")).json()) as { bills: { id: string; name: string }[] };
    for (const b of bills.filter((b) => b.name === NAME)) await context.request.delete(`/api/expected-bills/${b.id}`, { headers: FETCH });
    await context.close();
  }
});
