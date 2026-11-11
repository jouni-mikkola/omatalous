import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// A number the savings checks wait for is a question in Tarkistettavat, answered with the input route. The demo household waits for its yearly
// distance. The server has the administrator and the demo household already (e2e/run.mjs makes them).
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const HEADERS = { "X-Requested-With": "fetch" };

test("a number the savings checks wait for is asked in Tarkistettavat and saved through the input route", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  try {
    const before = (await (await context.request.get("/api/review")).json()).items as { id: string; kind: string }[];
    expect(before.map((i) => i.id)).toContain("input:car_km");

    await page.goto("/#/review");
    const question = page.getByRole("heading", { name: "Paljonko ajat vuodessa?" });
    // the queue is the most money first and the distance carries none: pass the items before it
    for (let i = 0; i < 30 && !(await question.isVisible()); i++) await page.getByRole("button", { name: "Ohita" }).click();
    await expect(question).toBeVisible();
    await expect(page.locator(".review-kind")).toHaveText("Lisätiedot");
    await page.getByRole("textbox", { name: "Ajomäärä" }).fill("14000");
    await page.getByRole("button", { name: "Tallenna" }).click();
    await expect(question).toHaveCount(0);

    const after = (await (await context.request.get("/api/review")).json()).items as { id: string }[];
    expect(after.map((i) => i.id)).not.toContain("input:car_km");
    expect(seen.problems).toEqual([]);
  } finally {
    await context.request.delete("/api/optimise/inputs/car_km", { headers: HEADERS });
    await context.close();
  }
});
