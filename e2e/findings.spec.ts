import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// Every finding is answered in one place: the insights are Muut havainnot on Säästövinkit, answered with the same
// words and listed under Päätetyt. The server has the administrator and the demo household already (e2e/run.mjs makes them).
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("the insights are Muut havainnot on Säästövinkit, Ei koske meitä lists one under Päätetyt, and Raportit has no Havainnot", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1366, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  // the demo's own alerts and its row for an unconnected account (which come with the date) would take the four rows Ilmoitukset has
  await page.route("**/api/dashboard**", async (route) => {
    const answer = await route.fetch();
    const json = await answer.json();
    await route.fulfill({ response: answer, json: { ...json, connectNotice: null, alerts: [] } });
  });
  {
    // Yhteenveto keeps its Huomioitavaa; Raportit has no Havainnot section of its own
    await page.goto("/#/overview");
    await expect(page.getByRole("region", { name: "Huomioitavaa", exact: true })).toBeVisible();
    await page.goto("/#/reports?q=tulot");
    await expect(page.getByRole("heading", { name: "Tulot ja menot" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Havainnot" })).toHaveCount(0);

    // the demo's new OpenAI charge is an insight no finding covers, a card with its cost and one key, no advice; the two rises
    // together are not, since Adobe's rise and Netflix in the video overlap are the findings' to tell
    await page.goto("/#/optimise");
    await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    const others = page.getByRole("region", { name: "Muut havainnot" });
    await expect(others.getByRole("article").filter({ hasText: "toistuvaa maksua kallistui" })).toHaveCount(0);
    const charge = others.getByRole("article").filter({ hasText: "Uusi toistuva maksu: OpenAI" });
    await expect(charge).toBeVisible();
    await expect(charge.locator(".tip-figure")).toContainText(/276\s€\s*maksaa vuodessa/);
    await expect(charge).not.toContainText("Tarkista, onko palvelu käytössä.");
    await expect(charge.locator("button")).toHaveCount(1);
    // the basis sentence and the working under the title (UI4)
    await expect(charge.locator(".tip-action")).toContainText("Ensimmäinen veloitus");
    await expect(charge.getByText("Laskelma")).toBeVisible();
    const title = (await charge.locator(".tip-title").innerText()).trim();

    // Ei koske meitä, the finding's words: the insight moves to Päätetyt with its state, and stays there after a reload
    await charge.getByRole("button", { name: "Ei koske meitä" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Siirsimme havainnon kohtaan Päätetyt." })).toBeFocused();
    await expect(charge).toHaveCount(0);
    const decided = page.getByRole("region", { name: "Päätetyt" });
    const row = decided.getByRole("listitem").filter({ hasText: title });
    await expect(row).toContainText(/Ohitettu · maksaa 276\s€ vuodessa/);
    await expect(row).toContainText("palaa, jos summa muuttuu 25 % tai enemmän");
    await page.reload();
    await expect(row).toBeVisible();
    await expect(charge).toHaveCount(0);

    // a phone with both lists on the page
    const phone = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const small = await phone.newPage();
    const seenSmall = watch(small);
    await small.goto("/#/optimise");
    await expect(small.getByRole("region", { name: "Päätetyt" })).toContainText(title);
    await small.waitForLoadState("networkidle");
    expect(await overflow(small), "Säästövinkit with Päätetyt scrolls sideways at 390px").toBeLessThanOrEqual(1);
    expect(seenSmall.problems).toEqual([]);
    await phone.close();

    // Peruuta brings it back among Muut havainnot
    await page.getByRole("button", { name: `Peruuta päätös: ${title}` }).click();
    await expect(charge).toBeVisible();
    await expect(decided).toHaveCount(0);
    expect(seen.problems).toEqual([]);
  }
  await context.close();
});
