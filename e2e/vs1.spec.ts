import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// Säästövinkit asks nothing on its own page: a number its checks wait for is a question in Tarkistettavat, answered
// with the page's own route, and the page lists it under Annetut tiedot. The demo household waits for its yearly
// distance. The server has the administrator and the demo household already (e2e/run.mjs makes them).
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const HEADERS = { "X-Requested-With": "fetch" };

test("a number Säästövinkit waits for is asked in Tarkistettavat and saved through the page's own route", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  try {
    await page.goto("/#/optimise");
    await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Tiedot, joita tarvitaan" })).toHaveCount(0);
    await expect(page.locator('#seuraavat input, #vinkit input, #tarkistettu input')).toHaveCount(0);

    const before = (await (await context.request.get("/api/review")).json()).items as { id: string; kind: string }[];
    expect(before.map((i) => i.id)).toContain("input:car_km");

    await page.goto("/#/review");
    const question = page.getByRole("heading", { name: "Paljonko ajat vuodessa?" });
    // the queue is the most money first and the distance carries none: pass the items before it
    for (let i = 0; i < 30 && !(await question.isVisible()); i++) await page.getByRole("button", { name: "Ohita" }).click();
    await expect(question).toBeVisible();
    await expect(page.locator(".review-kind")).toHaveText("Säästövinkit");
    await page.getByRole("textbox", { name: "Ajomäärä" }).fill("14000");
    await page.getByRole("button", { name: "Tallenna" }).click();
    await expect(question).toHaveCount(0);

    const after = (await (await context.request.get("/api/review")).json()).items as { id: string }[];
    expect(after.map((i) => i.id)).not.toContain("input:car_km");
    await page.goto("/#/optimise");
    await expect(page.getByRole("region", { name: "Annetut tiedot" })).toContainText(/14\s000 km vuodessa/);
    expect(seen.problems).toEqual([]);
  } finally {
    await context.request.delete("/api/optimise/inputs/car_km", { headers: HEADERS });
    await context.close();
  }
});

test("Muut havainnot at 390: the Ei koske meitä button stands under the avatar and the title, in both looks", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto("/#/optimise");
    await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    const tips = page.locator(".tip.other");
    await expect(tips.first()).toBeVisible({ timeout: 15_000 });
    for (const look of ["light", "night"]) {
      await page.evaluate((l) => (l === "night" ? document.documentElement.setAttribute("data-look", "night") : document.documentElement.removeAttribute("data-look")), look);
      for (let i = 0; i < (await tips.count()); i++) {
        const tip = tips.nth(i);
        await tip.scrollIntoViewIfNeeded();
        const button = (await tip.getByRole("button", { name: "Ei koske meitä" }).boundingBox())!;
        const head = (await tip.locator(".other-head").boundingBox())!;
        // the button starts below the head's bottom: it covers neither the avatar nor the title
        expect(button.y, `${look}: tip ${i}`).toBeGreaterThanOrEqual(head.y + head.height - 1);
      }
    }
  } finally {
    await context.close();
  }
});
