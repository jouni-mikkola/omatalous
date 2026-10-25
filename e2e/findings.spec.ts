import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// Every finding is answered in one place: the insights the overview and Raportit > Havainnot told are Muut havainnot
// on Säästövinkit, answered with the same words and listed under Päätetyt. Switched off, they are back where they
// were. The server has the administrator and the demo household already (e2e/run.mjs makes them).
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("the insights are Muut havainnot on Säästövinkit, Ei koske meitä lists one under Päätetyt, and with the page off they show on Yhteenveto and Raportit", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1366, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  // the demo's own alerts and its row for an unconnected account (which come with the date) would take the four rows Ilmoitukset has and push the insight out of them
  // Yhteenveto takes the insights the dashboard names first, which the date decides (a price rise leads some months), so the spec reads the first from the answer
  let first = "";
  await page.route("**/api/dashboard**", async (route) => {
    const answer = await route.fetch();
    const json = await answer.json();
    first = json.insights?.find((i: { tone: string }) => i.tone !== "good")?.title ?? first;
    await route.fulfill({ response: answer, json: { ...json, connectNotice: null, alerts: [] } });
  });
  const flag = (on: boolean) => context.request.put("/api/admin/features", { headers: { "X-Requested-With": "fetch" }, data: { optimise: on } });
  try {
    // with Säästövinkit on, Yhteenveto and Raportit leave the insights to it
    await page.goto("/#/overview");
    await expect(page.getByRole("heading", { name: "Tulot ja menot", exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("region", { name: "Ilmoitukset" }).getByText("Uusi toistuva maksu: OpenAI")).toHaveCount(0);
    await page.goto("/#/reports");
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
    await expect(page.getByRole("status").filter({ hasText: "Havainto siirrettiin kohtaan Päätetyt." })).toBeFocused();
    await expect(charge).toHaveCount(0);
    const decided = page.getByRole("region", { name: "Päätetyt" });
    const row = decided.getByRole("listitem").filter({ hasText: title });
    await expect(row).toContainText(/Ei koske meitä · maksaa 276\s€ vuodessa/);
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

    // switched off: Yhteenveto shows the first insights again and Raportit has Havainnot
    expect((await flag(false)).ok()).toBe(true);
    await page.goto("/#/overview");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Tulot ja menot", exact: true })).toBeVisible();
    expect(first, "the dashboard names an insight").not.toBe("");
    await expect(page.getByRole("region", { name: "Ilmoitukset" }).getByText(first, { exact: false })).toBeVisible();
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

test("Säästövinkit tells what it checked: every check that is not a finding in one of three groups, and no sideways scroll at 390px", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/optimise");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  const checked = page.getByRole("region", { name: "Mitä tarkistettiin?" });
  await expect(checked).toBeVisible();
  expect(await checked.locator("li").count()).toBeGreaterThan(0);
  for (const text of await checked.locator(".checked-group h3").allInnerTexts()) expect(text.replace(/\s+/g, " ")).toMatch(/^. (Kunnossa|Tietoja puuttuu|Ei tarkistettavaa) \d+$/);
  for (const text of await checked.locator(".checked-why").allInnerTexts()) expect(text).toMatch(/^(Täydennä|.+\.)$/);
  await page.waitForLoadState("networkidle");
  expect(await overflow(page), "Tarkistettu scrolls sideways at 390px").toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});
