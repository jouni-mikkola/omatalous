import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// Asetukset > Tilit, "Täsmää pankin saldoon": on the demo household the checking account proves over its history and
// the savings account has only the available balance. A card has no such line. Needs the administrator and the demo
// household that e2e/run.mjs makes.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

for (const [width, height] of [[1280, 800], [390, 844]] as const) {
  test(`Tilit says whether the account matches the bank's balance, at ${width}`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height } });
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/settings");
    const tilit = page.locator("#tilit");
    const row = (name: string) => tilit.getByRole("row").filter({ hasText: name }).first();

    // the checking account proves: a tick, and opened the stretch with its days
    const checking = row("Käyttötili (esimerkki)").locator(".acc-rec");
    await expect(checking.locator("summary")).toContainText("Täsmää pankin saldoon");
    await expect(checking.getByRole("img", { name: "täsmää" })).toBeVisible();
    await expect(checking.locator("li")).toHaveCount(1);
    await expect(checking).not.toHaveAttribute("open", "");
    await checking.locator("summary").click();
    await expect(checking.locator("li").first()).toContainText(/päivää, täsmää/);
    await expect(checking.locator("li").first()).toContainText("–");

    // the savings account has only the available balance: the reason, nothing to open
    const savings = row("Säästötili (esimerkki)").locator(".acc-rec");
    await expect(savings).toContainText("Täsmää pankin saldoon");
    await expect(savings).toContainText("vain käytettävissä oleva saldo");
    await expect(savings.getByRole("img")).toHaveCount(0);
    await expect(savings.locator("details, summary")).toHaveCount(0);

    // a card has no line
    await expect(row("Nordea Gold (esimerkki)").locator(".acc-rec")).toHaveCount(0);

    expect(await overflow(page)).toBeLessThanOrEqual(1);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}
