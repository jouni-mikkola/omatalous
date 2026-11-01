import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, plain, watch } from "./helpers.ts";

// The demo's Adobe rise (62,99 € to 74,99 €, 144 € a year) is worked out on one page, Kiinteät menot > Hinnanmuutokset. Yhteenveto,
// Säästövinkit and Laskut name the rise in one line that links there. Runs on the demo household that e2e/run.mjs makes.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FORMULA = "(74,99 € − 62,99 €) × 12";
const HERE = "#/reports?q=kiinteat#kiinteat-hinnat";
// the calculation is the formula, or its lines as Säästövinkit used to list them
const hasCalc = (text: string) => text.includes(plain(FORMULA)) || (text.includes("Hinta ennen") && text.includes("Veloituksia vuodessa"));

for (const width of [390, 1440]) {
  test(`${width} px: the Adobe rise is calculated on one page and the others link to it`, async ({ browser }) => {
    const phone = width < 600;
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, isMobile: phone, hasTouch: phone });
    const page = await context.newPage();
    const seen = watch(page);
    const withCalc: string[] = [];
    const shot = async (name: string) => process.env.E2E_SHOTS && (await page.screenshot({ path: join(process.env.E2E_SHOTS, `price-rise-${name}-${width}.png`), fullPage: true }));
    const read = async () => plain(await page.locator("main").innerText());

    // Yhteenveto: one note, its link opens the section
    await page.goto("/#/overview");
    const note = page.getByText("Kaksi maksuasi kallistui");
    await expect(note).toBeVisible();
    await expect(page.getByRole("link", { name: "Tarkista, oletko hyväksynyt korotuksen." })).toHaveAttribute("href", HERE);
    if (hasCalc(await read())) withCalc.push("overview");
    await shot("overview");

    // Säästövinkit: the tip names the rise and links; its working holds no prices
    await page.goto("/#/optimise");
    const tip = page.locator("article.tip").filter({ hasText: "Adobe: hinta nousi" });
    await expect(tip).toHaveCount(1);
    await expect(tip.getByRole("link", { name: /^Laskelma/ })).toHaveAttribute("href", HERE);
    await tip.getByRole("button", { name: /Näytä laskelma/ }).click();
    // the working is fetched when it opens: read it once it is there
    await expect(tip.locator(".calc-line")).toBeVisible();
    if (hasCalc(await read())) withCalc.push("optimise");
    // the calculation line of the tip tells no prices either, only Kiinteät menot does (the months and rows under it are the tip's own evidence)
    expect(await tip.locator(".calc-line").innerText(), "prices in the tip's calculation").not.toContain("62,99");
    await shot("optimise");

    // Laskut: the opened row of Adobe names the rise and links
    await page.goto("/#/bills");
    await page.getByRole("button", { name: /^Tiedot: Adobe/ }).click();
    const move = page.locator(".ps-move").first();
    await expect(move).toContainText("144");
    await expect(move.getByRole("link", { name: "Laskelma" })).toHaveAttribute("href", HERE);
    if (hasCalc(await read())) withCalc.push("bills");
    await shot("bills");

    // Kiinteät menot: the calculation
    await page.goto("/#/reports?q=kiinteat");
    const section = page.locator("#kiinteat-hinnat");
    await expect(section.getByRole("heading", { name: "Hinnanmuutokset" })).toBeVisible();
    await expect(section).toContainText(FORMULA);
    if (hasCalc(await read())) withCalc.push("kiinteat");
    await shot("kiinteat");
    expect(await overflow(page), "sideways scroll").toBeLessThanOrEqual(1);

    // the link of Yhteenveto lands on that section
    await page.goto("/#/overview");
    await page.getByRole("link", { name: "Tarkista, oletko hyväksynyt korotuksen." }).click();
    await expect(page.locator("#kiinteat-hinnat").getByRole("heading", { name: "Hinnanmuutokset" })).toBeVisible();

    expect(withCalc, "pages with the calculation").toEqual(["kiinteat"]);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}
