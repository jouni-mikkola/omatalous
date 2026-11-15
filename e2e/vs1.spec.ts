import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// Tarkistettavat asks no number for the savings checks: the page that took one is gone. The server has the administrator
// and the demo household already (e2e/run.mjs makes them).
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("Tarkistettavat asks for no number for the savings checks", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  try {
    const items = (await (await context.request.get("/api/review")).json()).items as { id: string; kind: string }[];
    expect(items.map((i) => i.id).filter((id) => id.startsWith("input:"))).toEqual([]);
    await page.goto("/#/review");
    await expect(page.getByRole("heading", { name: "Paljonko ajat vuodessa?" })).toHaveCount(0);
    expect(seen.problems).toEqual([]);
  } finally {
    await context.close();
  }
});
