import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// Every finding is answered in one place: the insights the overview and Raportit > Havainnot told are Muut havainnot
// on Säästövinkit, answered with the same words and listed under Päätetyt. Switched off, they are back where they
// were. Runs after app.spec.ts, which created the administrator and loaded the demo household.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("the insights are Muut havainnot on Säästövinkit, Ei koske meitä lists one under Päätetyt, and with the page off they show on Kuukausi and Raportit", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1366, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  const flag = (on: boolean) => context.request.put("/api/admin/features", { headers: { "X-Requested-With": "fetch" }, data: { optimise: on } });
  try {
    // with Säästövinkit on, Kuukausi and Raportit leave the insights to it
    await page.goto("/#/overview");
    await expect(page.getByRole("heading", { name: "Ennuste kuun loppuun" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".insights")).toHaveCount(0);
    await page.goto("/#/reports");
    await expect(page.getByRole("heading", { name: "Tulot ja menot" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Havainnot" })).toHaveCount(0);

    // the demo's two rises together are an insight no finding covers: Adobe's rise alone is a finding
    await page.goto("/#/optimise");
    await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    const others = page.getByRole("region", { name: "Muut havainnot" });
    const rises = others.getByRole("article").filter({ hasText: "toistuvaa maksua kallistui" });
    await expect(rises).toBeVisible();
    await expect(rises).toContainText(/168\s€ vuodessa/);
    const title = (await rises.locator(".finding-title").innerText()).trim();

    // Ei koske meitä, the finding's words: the insight moves to Päätetyt with its state, and stays there after a reload
    await rises.getByRole("button", { name: "Ei koske meitä" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Havainto siirrettiin kohtaan Päätetyt." })).toBeFocused();
    await expect(rises).toHaveCount(0);
    const decided = page.getByRole("region", { name: "Päätetyt" });
    const row = decided.getByRole("listitem").filter({ hasText: title });
    await expect(row).toContainText("Ei koske meitä · 168");
    await expect(row).toContainText("palaa, jos summa muuttuu 25 % tai enemmän");
    await page.reload();
    await expect(row).toBeVisible();
    await expect(rises).toHaveCount(0);

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
    await expect(rises).toBeVisible();
    await expect(decided).toHaveCount(0);

    // switched off: Kuukausi shows the first insights again and Raportit has Havainnot
    expect((await flag(false)).ok()).toBe(true);
    await page.goto("/#/overview");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Ennuste kuun loppuun" })).toBeVisible();
    await expect(page.locator(".insights").getByText(title)).toBeVisible();
    await page.goto("/#/reports");
    await expect(page.getByRole("heading", { name: "Havainnot" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Havainnot" })).toContainText(title);
    expect(seen.problems).toEqual([]);
  } finally {
    // the flag is back at its default, so the pages after this test see the app as shipped
    await flag(true);
  }
  await context.close();
});
