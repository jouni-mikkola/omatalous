import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { makeMember, overflow, removeMember, watch } from "./helpers.ts";

// Pankit ja tilit has one card for the bank app. The administrator chooses between the household's application and
// their own; a member with no shared application has the own one only.
const SHOTS = process.env.E2E_SHOTS;
const shot = async (page: import("@playwright/test").Page, who: string, width: number) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${process.env.E2E_SHOT_NAME ?? "after"}-${who}-banks-${width}.png`), fullPage: true });
};

for (const width of [1440, 390]) {
  test(`at ${width} px the administrator has one card for the bank app`, async ({ browser }) => {
    const { state, id } = await makeMember(browser, `e2e-sovellus-a-${width}`, "admin");
    const context = await browser.newContext({ storageState: state, viewport: { width, height: 844 } });
    try {
      const page = await context.newPage();
      const seen = watch(page);
      await page.goto("/#/settings/banks");
      await expect(page.getByRole("heading", { name: "Pankkisovellus", exact: true })).toBeVisible();
      await shot(page, "admin", width);
      await expect(page.getByRole("heading", { name: /Enable Banking -sovellus/ })).toHaveCount(0);
      const card = page.locator("#pankkisovellus");
      await expect(card.getByRole("heading", { name: "Pankkisovellus", exact: true })).toHaveCount(1);
      if (!(await card.evaluate((d) => (d as HTMLDetailsElement).open))) await card.locator("summary").click();
      const choice = card.getByRole("group", { name: "Sovellus" });
      await expect(choice.getByRole("button")).toHaveText(["Talouden sovellus", "Oma sovellus"]);
      await expect(choice.getByRole("button", { name: "Talouden sovellus" })).toHaveAttribute("aria-pressed", "true");
      await expect(card.getByRole("button", { name: "Tallenna ja testaa" })).toHaveCount(0);
      await choice.getByRole("button", { name: "Oma sovellus" }).click();
      await expect(choice.getByRole("button", { name: "Oma sovellus" })).toHaveAttribute("aria-pressed", "true");
      await expect(card.getByRole("button", { name: "Tallenna ja testaa" })).toBeVisible();
      await expect(card.getByText("Allowed redirect URLs").first()).toBeVisible();
      await shot(page, "admin-own", width);
      await choice.getByRole("button", { name: "Talouden sovellus" }).click();
      await expect(card.getByRole("button", { name: "Tallenna ja testaa" })).toHaveCount(0);
      expect(await overflow(page), `Pankit ja tilit scrolls sideways at ${width}px`).toBeLessThanOrEqual(1);
      expect(seen.problems).toEqual([]);
    } finally {
      await context.close();
      await removeMember(browser, id);
    }
  });

  test(`at ${width} px a member has one card for the bank app with their own application`, async ({ browser }) => {
    const { state, id } = await makeMember(browser, `e2e-sovellus-j-${width}`);
    const context = await browser.newContext({ storageState: state, viewport: { width, height: 844 } });
    try {
      const page = await context.newPage();
      const seen = watch(page);
      await page.goto("/#/settings/banks");
      await expect(page.getByRole("heading", { name: "Pankkisovellus", exact: true })).toBeVisible();
      await shot(page, "member", width);
      await expect(page.getByRole("heading", { name: /Enable Banking -sovellus/ })).toHaveCount(0);
      const card = page.locator("#pankkisovellus");
      await expect(card.getByRole("heading", { name: "Pankkisovellus", exact: true })).toHaveCount(1);
      if (!(await card.evaluate((d) => (d as HTMLDetailsElement).open))) await card.locator("summary").click();
      await expect(card.getByRole("group", { name: "Sovellus" })).toHaveCount(0);
      await expect(card.getByRole("button", { name: "Tallenna ja testaa" })).toBeVisible();
      expect(await overflow(page), `Pankit ja tilit scrolls sideways at ${width}px`).toBeLessThanOrEqual(1);
      expect(seen.problems).toEqual([]);
    } finally {
      await context.close();
      await removeMember(browser, id);
    }
  });
}
