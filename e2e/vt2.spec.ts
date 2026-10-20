import { type Browser, expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { cents, overflow, watch } from "./helpers.ts";

// Tapahtumat on the table kit (VT2): one-line rows at two densities, a day's row with the server's sums, sorting inside
// a day, a row that opens on its payee's twelve months, the period picked on a calendar of our own, the strip's
// histogram that narrows the list, the empty, first and loading states. The demo household of e2e/run.mjs.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

async function open(browser: Browser, path: string, width = 1280, height = 900) {
  const context = await browser.newContext({ storageState: STATE, viewport: { width, height } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto(path);
  return { context, page, seen };
}

const rows = (page: Page) => page.locator("table.tx-table tbody tr:not(.rt-group):not(.tx-drill)");
const heights = (page: Page, n: number) => rows(page).evaluateAll((els, n) => els.slice(0, n).map((el) => Math.round(el.getBoundingClientRect().height)), n);

test("a row is one line of 44 px, 32 px in Tiivis, and the density is kept after a reload", async ({ browser }) => {
  const { context, page, seen } = await open(browser, "/#/transactions");
  await expect(rows(page).first()).toBeVisible();
  // a linked document (private build) or a joint part adds a line; the plain rows of the demo are one line each
  const roomy = await heights(page, 20);
  expect(roomy.filter((h) => Math.abs(h - 44) <= 1).length, `heights ${roomy.join(", ")}`).toBeGreaterThanOrEqual(18);
  // about ten rows under the strip at 1280 by 900 once the list is scrolled to its head
  const groups = await page.locator("table.tx-table tr.rt-group").evaluateAll((els) => els.slice(0, 3).map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(groups.every((h) => Math.abs(h - 28) <= 1), `day rows ${groups.join(", ")}`).toBe(true);

  await page.getByRole("button", { name: "Listan asetukset" }).click();
  await page.getByRole("group", { name: "Rivien tiheys" }).getByRole("button", { name: "Tiivis" }).click();
  await page.keyboard.press("Escape");
  const compact = await heights(page, 20);
  expect(compact.filter((h) => Math.abs(h - 32) <= 1).length, `heights ${compact.join(", ")}`).toBeGreaterThanOrEqual(18);
  await expect(page.locator("table.tx-table .tx-text").first()).toBeHidden();
  await page.reload();
  await expect(rows(page).first()).toBeVisible();
  expect(Math.round((await rows(page).first().boundingBox())!.height)).toBeLessThanOrEqual(33);

  // back to Väljä for the next spec
  await page.getByRole("button", { name: "Listan asetukset" }).click();
  await page.getByRole("group", { name: "Rivien tiheys" }).getByRole("button", { name: "Väljä" }).click();
  expect(await overflow(page)).toBe(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a day's row says the server's whole-day sums, also for a day the page cuts", async ({ browser }) => {
  const { context, page, seen } = await open(browser, "/#/transactions");
  const answer = (await (await page.request.get("/api/transactions?limit=100&scope=own")).json()) as { items: { bookingDate: string }[]; daySums: { date: string; count: number; outCents: number }[] };
  await expect(rows(page).first()).toBeVisible();
  const first = page.locator("table.tx-table tr.rt-group").first();
  const sum = answer.daySums.find((d) => d.date === answer.items[0]!.bookingDate)!;
  await expect(first.locator(".rt-group-count")).toHaveText(new RegExp(`^${sum.count} tapahtuma`));
  if (sum.outCents > 0) expect(cents((await first.locator(".rt-sub").first().innerText()).trim())).toBe(-sum.outCents);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Summa sorts the rows inside each day, largest first, then smallest, then the bank's order again", async ({ browser }) => {
  const { context, page, seen } = await open(browser, "/#/transactions");
  await expect(rows(page).first()).toBeVisible();
  const head = page.locator("table.tx-table thead th", { hasText: "Summa" });
  const day = page.locator("table.tx-table tbody").filter({ has: page.locator("tr:not(.rt-group)").nth(2) }).first();
  const amounts = async () => (await day.locator("td.tx-sum .tx-amount").allInnerTexts()).map((t) => Math.abs(cents(t)));
  const before = await amounts();
  await head.getByRole("button").click();
  await expect(head).toHaveAttribute("aria-sort", "descending");
  const down = await amounts();
  expect(down).toEqual([...before].sort((a, b) => b - a));
  await head.getByRole("button").click();
  await expect(head).toHaveAttribute("aria-sort", "ascending");
  expect(await amounts()).toEqual([...before].sort((a, b) => a - b));
  await head.getByRole("button").click();
  await expect(head).toHaveAttribute("aria-sort", "none");
  expect(await amounts()).toEqual(before);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a row opens on its payee's twelve months and closes again", async ({ browser }) => {
  const { context, page, seen } = await open(browser, "/#/transactions");
  const row = rows(page).filter({ has: page.locator(".tx-name", { hasText: "K-Supermarket" }) }).first();
  await expect(row).toBeVisible();
  const toggle = row.getByRole("button", { name: "Avaa K-Supermarket: 12 kuukautta" });
  await toggle.click();
  await expect(row.getByRole("button", { name: "Sulje K-Supermarket: 12 kuukautta" })).toHaveAttribute("aria-expanded", "true");
  const drill = page.locator("tr.tx-drill");
  await expect(drill.getByText("12 kuukautta", { exact: true })).toBeVisible();
  await expect(drill.getByText("Ostoskerta keskimäärin")).toBeVisible();
  await expect(drill.locator(".tx-drill-bars li")).toHaveCount(12);
  await expect(drill.locator(".tx-drill-bars li.peak")).toHaveCount(1);
  await expect(drill.getByRole("link", { name: "Kaikki kauppiaan tapahtumat" })).toHaveAttribute("href", /merchant=K-Supermarket/);
  await row.getByRole("button", { name: /^Sulje/ }).click();
  await expect(drill).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the period is a named one or two days on our own calendar, never a browser date field", async ({ browser }) => {
  const { context, page, seen } = await open(browser, "/#/transactions");
  await expect(rows(page).first()).toBeVisible();
  await expect(page.locator("input[type=date]")).toHaveCount(0);
  await page.getByRole("button", { name: "Aikaväli", exact: true }).click();
  const range = page.getByRole("dialog", { name: "Aikaväli" });
  await range.getByRole("button", { name: "Edellinen kuu", exact: true }).click();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}/);
  await expect(page.locator(".tx-fchip.set")).toContainText("Edellinen kuu");
  await expect(page.getByRole("region", { name: "Rajattujen tapahtumien summat" })).toContainText("Menot päivittäin");

  await page.locator(".tx-fchip.set .tx-fchip-main").click();
  const calendar = page.getByRole("dialog", { name: "Aikaväli" });
  const days = calendar.locator(".tx-cal-day:not(:disabled)");
  await days.nth(2).click();
  await expect(calendar.getByRole("button", { name: "Näytä jakso" })).toBeEnabled();
  await days.nth(9).click();
  await calendar.getByRole("button", { name: "Näytä jakso" }).click();
  await expect(page.locator(".tx-fchip.set")).toContainText(/\d{1,2}\.\d{1,2}\.–\d{1,2}\.\d{1,2}\.\d{4}/);
  const url = new URLSearchParams(page.url().split("?")[1]);
  expect(url.get("to")! > url.get("from")!).toBe(true);
  await page.getByRole("button", { name: "Poista rajaus: Aikaväli" }).click();
  await expect(page).toHaveURL(/#\/transactions$/);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Enter on the histogram narrows the list to its tallest bin, and a filter that matches nothing can be cleared", async ({ browser }) => {
  const { context, page, seen } = await open(browser, "/#/transactions");
  const hist = page.getByRole("img", { name: /^Menot (päivittäin|viikoittain|kuukausittain), suurin / });
  await expect(hist).toBeVisible();
  await expect(page.locator(".tx-hist-readout")).toContainText("maksettu");
  // Kalenteri opens the rhythm of the same rows under the strip, shaded by the server
  await page.getByRole("group", { name: "Kuvan muoto" }).getByRole("button", { name: "Kalenteri" }).click();
  await expect(page.locator(".tx-rhythm")).toBeVisible();
  await expect(page.locator(".tx-rhythm").getByText("Minä päivinä rahaa meni?").or(page.getByRole("img", { name: /Minä päivinä rahaa meni/ })).first()).toBeAttached();
  await page.getByRole("group", { name: "Kuvan muoto" }).getByRole("button", { name: "Pylväät" }).click();
  await expect(page.locator(".tx-rhythm")).toHaveCount(0);
  await hist.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
  await expect(rows(page).first()).toBeVisible();

  await page.goto("/#/transactions?q=eiosumiamissaan");
  await expect(page.getByText("Näillä rajauksilla ei ole tapahtumia.")).toBeVisible();
  // the strip waits for rows; the chips stay so a filter can be undone one at a time
  await expect(page.getByRole("region", { name: "Rajattujen tapahtumien summat" })).toHaveCount(0);
  await page.getByRole("button", { name: "Tyhjennä rajaukset" }).click();
  await expect(page).toHaveURL(/#\/transactions$/);
  await expect(rows(page).first()).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("before its answer the page stands at its final shape: the strip's frame and grey rows under the table's head", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.route(/\/api\/transactions\?/, () => {
    // never answered: the page keeps loading
  });
  await page.goto("/#/transactions");
  await expect(page.locator(".tx-skel.tx-totals")).toBeVisible();
  await expect(page.locator("table.tx-table thead th").first()).toBeVisible();
  await expect(page.locator(".tx-skel-row")).toHaveCount(4);
  await expect(page.getByRole("status").filter({ hasText: "Ladataan" })).toBeAttached();
  await expect(page.getByText("Tapahtumia ei vielä ole")).toHaveCount(0);
  await context.close();
});

test("390 px: a card keeps its chevron on its second line, and the drill opens under the card", async ({ browser }) => {
  const { context, page, seen } = await open(browser, "/#/transactions", 390, 844);
  const card = page.locator(".tx-item").first();
  await expect(card).toBeVisible();
  const box = (await card.boundingBox())!;
  expect(box.height, "two lines").toBeLessThan(80);
  await card.locator(".tx-open").click();
  await expect(card.locator(".tx-drill-body")).toBeVisible();
  await expect(card.locator(".tx-drill-bars li")).toHaveCount(12);
  // the month names that show stand apart: on a phone every third and the peak keep theirs
  const names = card.locator(".tx-drill-month");
  const shown: { x: number; width: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const name = names.nth(i);
    if (await name.evaluate((e) => getComputedStyle(e).visibility === "visible")) shown.push((await name.boundingBox())!);
  }
  expect(shown.length).toBeGreaterThanOrEqual(4);
  for (let j = 1; j < shown.length; j++) expect(shown[j]!.x, `month name ${j} starts after the one before it ends`).toBeGreaterThanOrEqual(shown[j - 1]!.x + shown[j - 1]!.width);
  expect(await overflow(page)).toBe(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});
