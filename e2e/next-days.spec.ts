import { expect, test, type Browser, type BrowserContext, type Locator } from "@playwright/test";
import { join } from "node:path";
import { cents, overflow, watch } from "./helpers.ts";

// The block Erääntyvät maksut on Yhteenveto: does the account cover what is due before the pay comes, on the demo
// household of the administrator that e2e/run.mjs made. The demo's dates follow the day the spec runs, so the spec
// asserts the shape and what the API the page reads says of this run, never a date or a sum of its own. The states the
// demo does not have (no regular payer, a late pay, payments that exceed the balance, no balance) are proved by
// apps/web/test/next-days.test.ts (the sentences) and packages/core/test/ahead-payday.test.ts (the window and the figures).
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

interface Ahead {
  reason: "payday" | "late" | "none";
  payday: { name: string; cents: number } | null;
  rows: { name: string; cents: number; source: string }[];
  upcoming: { cents: number; onCard?: boolean }[];
  totals: { dueCents: number; cardCents: number; transferCents: number };
  balance: { startCents: number; freeCents: number } | null;
}

/** The window as the API the page reads gives it. */
const aheadOf = async (context: BrowserContext): Promise<Ahead> => (await (await context.request.get("/api/dashboard")).json()).ahead;

/** The merchants of the demo household's series, as the app reads them from the demo's rows: the only names a bill or a pay can carry. */
async function demoNames(context: BrowserContext): Promise<Set<string>> {
  const series: { merchant: string }[] = (await (await context.request.get("/api/recurring")).json()).series;
  return new Set(series.map((s) => s.merchant));
}

/** The names of a table's rows: the cell carries the whole name as its title, whatever line stands under it. */
const namesOf = (table: Locator) => table.locator("tbody tr td:nth-child(2)").evaluateAll((cells) => cells.map((c) => c.getAttribute("title")));

async function open(browser: Browser, width: number) {
  const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview");
  const card = page.locator(".card", { has: page.getByRole("heading", { name: "Erääntyvät maksut", exact: true }) });
  await expect(card).toBeVisible();
  return { context, page, seen, card };
}

test("the line over the figures names the payday, the three figures are the API's and the payments add up to their figure", async ({ browser }) => {
  const { context, seen, card } = await open(browser, 1280);
  const ahead = await aheadOf(context);
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Erääntyvät maksut");
  // the demo household has a regular pay, so the window runs to its payday
  expect(ahead.reason).toBe("payday");
  await expect(card.locator(".ahead-window")).toHaveText(/^(Palkkapäivään asti, (su|ma|ti|ke|to|pe|la) \d{1,2}\.\d{1,2}\.|Seuraavat \d+ päivää\.)( Palkka ei ole vielä tullut, sen piti tulla (su|ma|ti|ke|to|pe|la) \d{1,2}\.\d{1,2}\.)?$/);

  // the three figures in their order, each the API's own, and the third is the first less the second
  const figures = card.locator("dl .st-row");
  await expect(figures.locator("dt")).toHaveText(["Saldo", "Erääntyvät maksut", "Käytettävissä"]);
  const [balance, due, free] = (await figures.locator("dd.st-num").allInnerTexts()).map(cents);
  expect([balance, due, free]).toEqual([ahead.balance!.startCents, ahead.totals.dueCents, ahead.balance!.freeCents]);
  expect(free).toBe(balance! - due!);

  // the table of the payments is the window's payments and nothing else, in order, and it adds up to the figure to the
  // cent. A payday today or tomorrow can leave a window with nothing due in it: the table says so in its one row, a figure of 0.
  const paid = ahead.rows.filter((r) => r.cents < 0);
  const known = await demoNames(context);
  for (const r of ahead.rows.filter((r) => r.source === "recurring" || r.source === "income")) expect(known.has(r.name), `${r.name} is a name the demo's rows give`).toBe(true);
  const table = card.getByRole("table", { name: /^Erääntyvät maksut / });
  await expect(table).toHaveCount(1);
  const none = table.locator("tbody td[colspan]");
  await expect(none).toHaveCount(paid.length > 0 ? 0 : 1);
  if (paid.length === 0) await expect(none).toHaveText("Ei erääntyviä maksuja.");
  expect(await namesOf(table)).toEqual(paid.map((r) => r.name));
  const amounts = (await table.locator("tbody tr td.st-num").allInnerTexts()).map(cents);
  expect(amounts.reduce((sum, c) => sum + c, 0), "the table adds up to the figure").toBe(due);
  // the days and the sums are called estimates under the table, in a line of three words, and no usual spending is told
  await expect(card.getByText("Eräpäivät ja summat ovat arvioita.", { exact: true })).toHaveCount(paid.length > 0 ? 1 : 0);
  await expect(card.getByText(/tavallisesti|arvioitu aiemmista/)).toHaveCount(0);
  // two groups: the figures at the left under the line of the window, the tables at the right from the block's second column on
  const [left, right, whole] = await Promise.all([card.locator("dl.st-rows"), table, card].map(async (l) => (await l.boundingBox())!));
  expect(left!.x + left!.width).toBeLessThan(right!.x);
  expect(Math.abs(right!.x - 18 - (whole!.x + whole!.width / 3)), "the tables start on the line of the second column").toBeLessThanOrEqual(2);

  // what is to arrive has its own table: other pay of the window, and as its last row the pay the window waits for
  const arriving = card.getByRole("table", { name: "Saapuvat maksut" });
  expect(await namesOf(arriving)).toEqual([...ahead.rows.filter((r) => r.cents > 0).map((r) => r.name), ahead.payday!.name]);
  const pay = arriving.locator("tbody tr").last();
  await expect(pay.locator("td:nth-child(2)")).toHaveText(/acme/i);
  expect(cents(await pay.locator("td:last-child").innerText())).toBe(ahead.payday!.cents);

  // the block is figures and tables: no chart, and nothing to switch
  await expect(card.locator("svg, canvas, button")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("on a phone nothing scrolls sideways, the figures come before the tables and a row keeps its three cells", async ({ browser }) => {
  const { context, page, seen, card } = await open(browser, 390);
  expect(await overflow(page), "the page scrolls sideways at 390 px").toBeLessThanOrEqual(1);
  const [head, figure] = [await card.getByRole("heading", { level: 2 }).boundingBox(), await card.locator("dl .st-row").first().boundingBox()];
  expect(head!.y).toBeLessThan(figure!.y);
  // the pay's table is there whatever the day is, so the block has a table: the figures stand above the first one
  const tables = card.locator("table");
  expect(figure!.y, "the first figure is above the tables").toBeLessThan((await tables.first().boundingBox())!.y);
  // a table is three columns inside the card: the day, the name, the sum. A long name is cut; a sum never is.
  const shape = await tables.evaluateAll((all) =>
    all.map((t) => ({
      wide: t.getBoundingClientRect().width > t.parentElement!.getBoundingClientRect().width + 1,
      cells: Array.from(t.querySelectorAll("tbody tr:not(:has(td[colspan]))")).map((r) => r.children.length),
      cut: Array.from(t.querySelectorAll("td.st-num")).filter((c) => c.scrollWidth > c.clientWidth + 1).length,
    })),
  );
  expect(shape.length).toBeGreaterThan(0);
  for (const t of shape) {
    expect(t.wide, "a table wider than its card").toBe(false);
    expect(t.cells.filter((n) => n !== 3), "a row without its three cells").toEqual([]);
    expect(t.cut, "a sum that is cut").toBe(0);
  }
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Laskut has the same payments in groups: the first group's sum is the figure of Yhteenveto without a card's bill and an own transfer, and what a card is charged is the last group", async ({ browser }) => {
  const { context, page, seen, card } = await open(browser, 1280);
  const ahead = await aheadOf(context);
  expect(ahead.reason).toBe("payday");
  const due = cents(await card.locator("dl .st-row", { hasText: "Erääntyvät maksut" }).locator("dd.st-num").innerText());
  expect(due).toBe(ahead.totals.dueCents);

  await page.goto("/#/bills");
  const heads = page.locator("#tulossa .group-head");
  await expect(heads.first()).toContainText("Palkkapäivään asti");
  const groups = (await heads.evaluateAll((rows) => rows.map((r) => [r.querySelector("th")!.textContent ?? "", r.querySelector("td")!.textContent ?? ""]))).map(([title, sum]) => ({ title: title!, cents: cents(sum!) }));
  // the first group is what the accounts pay in the window. Yhteenveto's figure adds to it only a card's bill and an
  // own transfer, so with neither in the window the two are one figure under one line
  expect(groups[0]!.cents).toBe(due - ahead.totals.cardCents - ahead.totals.transferCents);
  // the demo's card is charged subscriptions: they are the last group, with their own sum
  const onCard = ahead.upcoming.filter((r) => r.onCard);
  expect(onCard.length).toBeGreaterThan(0);
  expect(groups.at(-1)).toEqual({ title: "Kortilta veloitettavat", cents: onCard.reduce((sum, r) => sum - r.cents, 0) });
  // and the groups together are the whole list
  expect(groups.reduce((sum, g) => sum + g.cents, 0)).toBe(ahead.upcoming.reduce((sum, r) => sum - r.cents, 0));
  expect(seen.problems).toEqual([]);
  await context.close();
});
