import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { join } from "node:path";
import { cents, overflow, plain, watch } from "./helpers.ts";

// Raportit > Ruoka of the demo household of the administrator that e2e/run.mjs made: the four lines with the figures
// core gives, each opening to its months, payees and weekdays; no sideways scroll at 390 px.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

type Food = {
  monthlyCents: number;
  cardBills: { monthlyCents: number } | null;
  lines: { id: string; heading: string; monthlyCents: number; monthCents: number[]; payees: { cents: number }[]; otherCents: number; weekdays: number[] | null }[];
};

async function open(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(path);
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  return page;
}

test("Ruoka has the four lines with core's figures, and a line opens to its payees and weekdays", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await open(context, "/#/reports?period=12m&tab=menot");
  const seen = watch(page);
  const food = ((await (await context.request.get("/api/reports?reports=food")).json()) as { food: Food | null }).food;
  expect(food, "the demo household has three complete months and spends on food").not.toBeNull();
  const section = page.locator("#ruoka");
  await expect(section.getByRole("heading", { name: "Ruoka", exact: true })).toBeVisible();

  // the rows: the card bills first when the window holds some, then the four lines; the total at the foot
  const table = section.locator("table.food-lines").first();
  const rows = table.locator("tbody tr:not(.rt-detail)");
  const bills = food!.cardBills ? 1 : 0;
  await expect(rows).toHaveCount(4 + bills);
  // the name after the arrow that opens the line
  const names = (await rows.locator("td:first-child").allInnerTexts()).map((n) => plain(n).replace(/^›\s*/, ""));
  expect(names.slice(bills)).toEqual(["Ruokakauppa", "Ravintolat ja kahvilat", "Ruoan kotiinkuljetus", "Alko"]);
  // a month's spend in whole euros, core's figure rounded with the other lines (printedParts): within a euro of its own
  for (const [i, l] of food!.lines.entries()) expect(Math.abs(cents(await rows.nth(i + bills).locator("td").nth(2).innerText()) - l.monthlyCents), l.heading).toBeLessThan(100);
  expect(cents(await table.locator("tfoot td.num").first().innerText())).toBe(Math.round(food!.monthlyCents / 100) * 100);

  // it is the sum core's themes give for Ruoka
  const dashboard = (await (await context.request.get("/api/dashboard")).json()) as { themes: { themes: { id: string; monthlyCents: number }[] } };
  expect(dashboard.themes.themes.find((t) => t.id === "food")!.monthlyCents).toBe(food!.monthlyCents);

  // Ruokakauppa opens: the payees and Muut add up to the line, each rounded to the euro
  const shop = food!.lines[0]!;
  await section.getByRole("button", { name: "Kauppiaat: Ruokakauppa" }).click();
  const detail = section.locator(".food-open");
  await expect(detail).toBeVisible();
  const lists = detail.locator("ul.rt-months");
  const payees = (await lists.first().locator("li .num").allInnerTexts()).map(cents);
  expect(Math.abs(payees.reduce((a, b) => a + b, 0) - shop.monthCents.reduce((a, b) => a + b, 0))).toBeLessThanOrEqual(50 * payees.length);
  if (shop.weekdays) expect((await lists.nth(1).locator("li .num").allInnerTexts()).map(Number)).toEqual(shop.weekdays);
  // the basket question answers with core's visits and mean purchase
  expect(plain(await section.locator(".qc-a").first().innerText())).toMatch(/Ruokakaupassa käytiin|Ostoskertojen vertailuun/);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Ruoka at 390 px does not scroll sideways, closed or open", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 800 } });
  const page = await open(context, "/#/reports?period=12m&tab=menot");
  const section = page.locator("#ruoka");
  await expect(section).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await section.getByRole("button", { name: "Kauppiaat: Ruokakauppa" }).click();
  await expect(section.locator(".food-open")).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await section.locator(".card-head").getByRole("button", { name: "Taulukko" }).click();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await context.close();
});
