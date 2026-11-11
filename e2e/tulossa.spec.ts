import { expect, test, type BrowserContext } from "@playwright/test";
import { join } from "node:path";
import { cents, watch } from "./helpers.ts";

// Tulossa (docs/design/README.md 1.3) on the demo household of the administrator that e2e/run.mjs made: a bill the
// history cannot know is added by hand, is a row of the one list and is in the payments Nyt takes off the balance.
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
