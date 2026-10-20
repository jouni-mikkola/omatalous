import { expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// VC4: the Laskut month board. The arrows move the month within what the server allows, a past month holds only what
// was paid and the next only what is coming, and a missed bill is the first tile and the first group. Reads the
// administrator's demo household and changes nothing; the missed bill is made on the answer's way, as the demo has none.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

const board = (page: Page) => page.locator("section.mb");
const tiles = (page: Page) => board(page).locator(".mb-states > .mb-state:not(.mb-fixed) dt");
const title = (page: Page) => board(page).locator("#mb-title");

test("the arrows move the board a month at a time: a past month is what was paid, the next what is coming", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/bills");
  await expect(title(page)).toBeVisible({ timeout: 15_000 });
  const now = (await title(page).innerText()).trim();

  await board(page).getByRole("button", { name: "Edellinen kuukausi" }).click();
  await expect(title(page)).not.toHaveText(now);
  await expect(board(page)).not.toHaveClass(/loading/);
  for (const word of await tiles(page).allInnerTexts()) expect(word).toMatch(/^Maksettu/);

  await board(page).getByRole("button", { name: "Seuraava kuukausi" }).click();
  await expect(title(page)).toHaveText(now);
  await board(page).getByRole("button", { name: "Seuraava kuukausi" }).click();
  await expect(title(page)).not.toHaveText(now);
  await expect(board(page)).not.toHaveClass(/loading/);
  for (const word of await tiles(page).allInnerTexts()) expect(word).toMatch(/^Tulossa/);
  // one month ahead is as far as the board goes
  await expect(board(page).getByRole("button", { name: "Seuraava kuukausi" })).toBeDisabled();
  expect(seen.problems).toEqual([]);
  await context.close();
});

for (const width of [1280, 390]) {
  test(`at ${width} px a missed bill is the first tile, the first group and says how late it is`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 } });
    const page = await context.newPage();
    const seen = watch(page);
    await page.route(/\/api\/bill-month(\?|$)/, async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      const b = json.board;
      const coming = b.rows.find((r: { state: string }) => r.state === "coming");
      if (coming) {
        coming.state = "missing";
        coming.date = b.from;
        b.rows = [coming, ...b.rows.filter((r: unknown) => r !== coming)];
        b.totals.comingCents -= coming.cents;
        b.totals.missingCents += coming.cents;
      }
      await route.fulfill({ response, json });
    });
    await page.goto("/#/bills");
    await expect(title(page)).toBeVisible({ timeout: 15_000 });
    await expect(tiles(page).first()).toContainText("Puuttuu");
    await expect(board(page).locator(".mb-group").first().locator(".mb-group-head")).toContainText("Puuttuu");
    await expect(board(page).locator(".mb-group.mb-missing .mb-day").first()).toContainText("myöhässä");
    // the tile's figure is the door to its rows
    await expect(board(page).locator(".mb-missing.mb-state button.why-door")).toHaveAttribute("aria-label", /^Näytä tapahtumat: Puuttuu /);
    expect(await overflow(page), `Laskut scrolls sideways at ${width} px`).toBeLessThanOrEqual(1);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}
