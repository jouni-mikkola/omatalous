import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { join } from "node:path";
import { parseSeriesId } from "../packages/core/src/recurring.ts";
import { cents, openBillFolds, watch } from "./helpers.ts";

// Tulossa (docs/design/README.md 1.3) on the demo household of the administrator that e2e/run.mjs made: a bill the
// history cannot know is added by hand, is a row of the one list and is in the payments Nyt takes off the balance;
// a row of the list opens the bill's earlier payments with their sum; and a found bill that is no recurring bill is
// marked away and leaves the list.
// The demo's dates follow the day the spec runs, so the due day is read from the window the API gives.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };
const NAME = "E2E-puuttuva lasku";
const CENTS = 4_321;

interface Dashboard {
  ahead: { from: string; to: string };
  home: { runway: { sum: { paymentsCents: number; freeCents: number }; leftOnPayday: { leftCents: number } } };
  nyt: { left: { billsCents: number; leftCents: number } };
}
const dashboardOf = async (context: BrowserContext): Promise<Dashboard> => (await context.request.get("/api/dashboard")).json();

/** Opens the folded rows of the open month on Laskut: the paid ones, where a bill paid this month stands, and a card's. */
async function showPaid(page: Page): Promise<void> {
  await expect(page.locator("#laskut-taulukko .bill-month-name")).toBeVisible();
  await openBillFolds(page.locator("#laskut-taulukko"));
}

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
    await showPaid(page);
    const row = page.locator("#laskut-taulukko tbody tr").filter({ has: page.getByRole("button", { name: `Tiedot: ${bill!.merchant}`, exact: true }) });
    // the bill stands in each of the months it falls in; the first one is opened
    await expect(row.first()).toBeVisible();
    await row.first().getByRole("button", { name: `Tiedot: ${bill!.merchant}`, exact: true }).click();
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
    await page.getByRole("button", { name: `Tiedot: ${bill!.merchant}`, exact: true }).first().click();
    await expect(history).toHaveCount(0);
    const products = series.filter((s) => s.active && typeof parseSeriesId(s.id)?.product === "number");
    let opened = 0;
    for (const s of products) {
      const p = parseSeriesId(s.id)!;
      // the row's name is the payee, with the product's price where another series of the payee stands in the list (format.ts `seriesName`)
      const button = page.locator("#laskut-taulukko").getByRole("button", { name: new RegExp(`^Tiedot: ${p.merchant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\d|$)`) }).first();
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

test("a found bill that is no recurring bill is marked away on Tulossa and is no longer a row of the list", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  // a bill of the demo household that is the only series of its payee: the last one, the history test opens the first
  const { series } = (await (await context.request.get("/api/recurring")).json()) as { series: (Series & { typicalAmountCents: number })[] };
  const bill = series.filter((s) => s.kind === "bill" && s.active && parseSeriesId(s.id)?.direction === "out" && parseSeriesId(s.id)?.product === null && series.filter((o) => o.merchant === s.merchant).length === 1).at(-1);
  expect(bill, "a bill in the demo household").toBeTruthy();
  const name = bill!.merchant;
  try {
    await page.goto("/#/bills");
    await showPaid(page);
    const row = page.locator("#laskut-taulukko tbody tr").filter({ has: page.getByRole("button", { name: `Tiedot: ${name}`, exact: true }) });
    await expect(row.first()).toBeVisible();
    await row.first().getByRole("button", { name: `Tiedot: ${name}`, exact: true }).click();
    await page.locator(".sub-drill").getByRole("button", { name: `Poista lasku ${name}`, exact: true }).click();
    const ask = page.getByRole("dialog", { name: `Poista lasku ${name}?` });
    await ask.getByRole("button", { name: "Poista lasku", exact: true }).click();
    await expect(ask).toHaveCount(0);

    // the row is gone, and the list read again does not bring it back
    await expect(row).toHaveCount(0);
    await expect(page.locator("#laskut-taulukko tbody tr").first()).toBeVisible();
    await page.reload();
    await expect(page.locator("#laskut-taulukko tbody tr").first()).toBeVisible();
    await showPaid(page);
    await expect(row).toHaveCount(0);
    const after = (await (await context.request.get("/api/recurring")).json()) as { series: Series[] };
    expect(after.series.some((s) => s.id === bill!.id)).toBe(false);
    expect(seen.problems).toEqual([]);
  } finally {
    // the demo household is shared with the other specs of the worker: the mark goes
    const { marks } = (await (await context.request.get("/api/recurring")).json()) as { marks: { subject: string }[] };
    for (const m of marks.filter((m) => m.subject.startsWith("not-recurring:"))) await context.request.put("/api/marks", { headers: FETCH, data: { subject: m.subject, mark: null } });
    await context.close();
  }
});

/** What is left on payday on Yhteenveto's first tile, to the cent as the page shows it. */
/** The big figure of Nyt is in whole euros. */
const whole = (c: number) => Math.round(c / 100) * 100;

async function leftOnNyt(context: BrowserContext): Promise<number> {
  const page = await context.newPage();
  await page.goto("/#/overview");
  const shown = cents(await page.locator("[data-tile=left] .fig").innerText());
  await page.close();
  return shown;
}

test("a missing bill added by hand on Tulossa is a row of the list and is in the sum left on payday", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  const before = await dashboardOf(context);
  expect(await leftOnNyt(context)).toBe(whole(before.home.runway.leftOnPayday.leftCents));
  // a day of the window Nyt counts: tomorrow when the window reaches it
  const tomorrow = new Date(Date.parse(before.ahead.from) + 86_400_000).toISOString().slice(0, 10);
  const due = tomorrow <= before.ahead.to ? tomorrow : before.ahead.from;

  try {
    await page.goto("/#/bills");
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

    // in the sum left on payday: the payments grew by the bill and what is left shrank by it
    const after = await dashboardOf(context);
    expect(after.home.runway.sum.paymentsCents).toBe(before.home.runway.sum.paymentsCents + CENTS);
    expect(after.home.runway.sum.freeCents).toBe(before.home.runway.sum.freeCents - CENTS);
    expect(await leftOnNyt(context)).toBe(whole(after.home.runway.leftOnPayday.leftCents));
    expect(after.home.runway.leftOnPayday.leftCents).toBe(before.home.runway.leftOnPayday.leftCents - CENTS);
    expect(after.nyt.left.billsCents).toBe(before.nyt.left.billsCents + CENTS);
    expect(seen.problems).toEqual([]);
  } finally {
    // the demo household is shared with the other specs of the worker
    const { bills } = (await (await context.request.get("/api/expected-bills")).json()) as { bills: { id: string; name: string }[] };
    for (const b of bills.filter((b) => b.name === NAME)) await context.request.delete(`/api/expected-bills/${b.id}`, { headers: FETCH });
    await context.close();
  }
});
