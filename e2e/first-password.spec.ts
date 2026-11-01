import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { overflow, removeMember, watch } from "./helpers.ts";

const FETCH = { "X-Requested-With": "fetch" };

// A member's first sign-in: the temporary password was just typed, so the page that follows asks the new password twice
// and nothing else. The shots in the artifact come from this run (E2E_SHOTS=dir).
for (const width of [1440, 390]) {
  test(`at ${width} px the first password asks only the new one, twice`, async ({ browser }) => {
    const admin = await browser.newContext({ storageState: join(process.env.E2E_DIR ?? ".", "admin-state.json") });
    const username = `e2e-eka-${width}`;
    const made = await admin.request.post("/api/users", { data: { username, displayName: username }, headers: FETCH });
    expect(made.ok()).toBe(true);
    const { user, temporaryPassword } = (await made.json()) as { user: { id: string }; temporaryPassword: string };
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    try {
      const page = await context.newPage();
      const seen = watch(page);
      await page.goto("/");
      await page.getByLabel("Käyttäjätunnus").fill(username);
      await page.getByLabel("Salasana", { exact: true }).fill(temporaryPassword);
      await page.getByRole("button", { name: "Kirjaudu sisään" }).click();
      const form = page.locator(".auth-form");
      await expect(form.getByLabel("Uusi salasana (vähintään 12 merkkiä)")).toBeVisible();
      await expect(form.getByLabel("Uusi salasana uudelleen")).toBeVisible();
      await expect(form.locator("input[type=password]")).toHaveCount(2);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      if (process.env.E2E_SHOTS) await page.screenshot({ path: join(process.env.E2E_SHOTS, `first-password-${width}.png`) });
      await form.getByLabel("Uusi salasana (vähintään 12 merkkiä)").fill(`${username}-oma-salasana`);
      await form.getByLabel("Uusi salasana uudelleen").fill(`${username}-oma-salasana`);
      await form.getByRole("button", { name: "Vaihda salasana" }).click();
      await expect(form).toHaveCount(0);
      expect(seen.problems).toEqual([]);
    } finally {
      await context.close();
      await admin.close();
      await removeMember(browser, user.id);
    }
  });
}
