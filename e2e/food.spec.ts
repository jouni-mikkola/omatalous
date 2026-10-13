import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { join } from "node:path";
import { cents, overflow, plain, watch } from "./helpers.ts";

// Raportit > Ruoka of the demo household of the administrator that e2e/run.mjs made: the four lines with the figures
// core gives, each opening to its months, payees and weekdays; no sideways scroll at 390 px; and the link to it from the
// table of themes on Yhteenveto.
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

test("Ruoka has the four lines with core's figures, and a line opens to its months, payees and weekdays", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await open(context, "/#/reports?period=12m");
  const seen = watch(page);
  const food = ((await (await context.request.get("/api/reports?reports=food")).json()) as { food: Food | null }).food;
  expect(food, "the demo household has three complete months and spends on food").not.toBeNull();
  const section = page.locator("#ruoka");
  await expect(section.getByRole("heading", { name: "Ruoka", exact: true })).toBeVisible();

  // the rows: the card bills first when the window holds some, then the four lines, then the total
  const rows = section.locator("tbody tr.food-line");
  await expect(rows).toHaveCount(4);
  expect(await rows.locator("th").allInnerTexts()).toEqual(["Ruokakauppa", "Ravintolat ja kahvilat", "Ruoan kotiinkuljetus", "Alko"]);
  for (const [i, l] of food!.lines.entries()) expect(cents(await rows.nth(i).locator(".food-month").innerText()), l.heading).toBe(l.monthlyCents);
  expect(cents(await section.locator("tr.food-total .food-month").innerText())).toBe(food!.monthlyCents);
  expect(await section.locator(".food-bills").count()).toBe(food!.cardBills ? 1 : 0);
  if (food!.cardBills) expect(cents(await section.locator(".food-bills .food-month").innerText())).toBe(food!.cardBills.monthlyCents);

  // it is the table of themes' sum: Yhteenveto's Ruoka row
  const dashboard = (await (await context.request.get("/api/dashboard")).json()) as { themes: { themes: { id: string; monthlyCents: number }[] } };
  expect(dashboard.themes.themes.find((t) => t.id === "food")!.monthlyCents).toBe(food!.monthlyCents);

  // Ruokakauppa opens: the payees and Muut add up to the months of the table, to the cent
  const shop = food!.lines[0]!;
  await section.getByRole("button", { name: "Ruokakauppa" }).click();
  const detail = section.locator(".food-open");
  await expect(detail.getByRole("heading", { name: "Kauppiaat" })).toBeVisible();
  const payees = await detail.locator(".st-rows .st-num").allInnerTexts();
  expect(payees.map(cents).reduce((a, b) => a + b, 0)).toBe(shop.monthCents.reduce((a, b) => a + b, 0));
  await detail.getByRole("button", { name: "Taulukko" }).click();
  const months = await detail.locator("table.food-months tbody tr td.num").allInnerTexts();
  expect(months).toHaveLength(shop.monthCents.length);
  expect(months.map(cents)).toEqual(shop.monthCents);
  // the dearest month is marked, and the weekdays are a table of the same purchases as their bars
  await expect(detail.locator("tr.food-dearest")).toHaveCount(1);
  if (shop.weekdays) expect((await detail.locator("table.food-days td.st-num").allInnerTexts()).map(Number)).toEqual(shop.weekdays);
  expect(plain(await detail.innerText())).toContain("Ostoskerta keskimäärin");
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Ruoka at 390 px does not scroll sideways, closed or open", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 800 } });
  const page = await open(context, "/#/reports?period=12m");
  const section = page.locator("#ruoka");
  await expect(section).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await section.getByRole("button", { name: "Ruokakauppa" }).click();
  await expect(section.locator(".food-open")).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await section.getByRole("button", { name: "Taulukko" }).click();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await context.close();
});

test("the Ruoka row of Menot kategorioittain on Yhteenveto links to Ruoka on Raportit", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await open(context, "/");
  await page.locator(".themes-table .themes-row", { hasText: "Ruoka" }).getByRole("link").click();
  await expect(page).toHaveURL(/#\/reports#ruoka$/);
  await expect(page.locator("#ruoka")).toBeInViewport();
  await context.close();
});
