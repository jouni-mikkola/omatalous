import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, plain, watch } from "./helpers.ts";

// Raportit > Kiinteät menot on the demo household: one table whose total is the figure Laskut puts beside its list, a line
// opens its payments, and a payment's day opens the payee's row of that day in Tapahtumat. At a phone's width and a desktop's.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const SHOTS = process.env.E2E_SHOTS ?? "";

for (const width of [390, 1440]) {
  test(`${width} px: Kiinteät menot adds up to Laskut's month and opens the rows behind a line`, async ({ browser }) => {
    const phone = width < 600;
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, isMobile: phone, hasTouch: phone });
    const page = await context.newPage();
    const seen = watch(page);

    await page.goto("/#/bills");
    const euros = (s: string) => plain(s).replace(/\D/g, "");
    const billsMonth = euros(await page.locator("#laskut-taulukko .fig").first().innerText());
    expect(billsMonth).not.toBe("");

    await page.goto("/#/reports?q=kiinteat");
    const block = page.locator("#kiinteat-menot");
    await expect(block.getByRole("table", { name: "Kiinteät menot kuussa ja vuodessa" })).toBeVisible();
    // about today: the page draws no period switch
    await expect(page.getByRole("toolbar", { name: "Aikaväli" })).toHaveCount(0);
    // the demo has no lender paid on no steady day, so the month is the one Laskut says
    const datum = plain(await block.locator(".card-datum").first().innerText());
    expect(euros(datum.split(" kuussa")[0]!), datum).toBe(billsMonth);
    // a line reads its category at every width; a phone leaves out the year, which is twelve of its months
    const line = block.locator("tbody > tr").first();
    await expect(line.getByText("Vuokra ja vastike")).toBeVisible();
    const yearCell = line.locator("td").last();
    if (phone) await expect(yearCell).toBeHidden();
    else await expect(yearCell).toBeVisible();

    const first = block.locator("tbody .rt-drill").first();
    const name = (await first.getAttribute("aria-label"))!;
    await first.click();
    const paid = block.getByRole("table", { name: `${name}: maksut 12 kuukauden ajalta` });
    await expect(paid).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `fixed-costs-open-${width}.png`), fullPage: true });

    const day = paid.locator("tbody a").first();
    const href = (await day.getAttribute("href"))!;
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("from")).toBe(params.get("to"));
    await day.click();
    await expect(page).toHaveURL(/#\/transactions\?/);
    await expect(page.getByText(params.get("merchant")!, { exact: false }).first()).toBeVisible();
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}
