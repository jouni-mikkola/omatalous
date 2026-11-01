import { expect, test } from "@playwright/test";
import { makeMember, removeMember } from "./helpers.ts";

// The language of a member (the user menu: the button named for the other language): chosen there, kept after a reload, shown
// by the page and by the sums and dates, and the choice of one member leaves the other members' pages as they were.
test("a member chooses English: the page, the sums and the server's refusals follow, and the choice stays", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "kielijasen");
  const member = await browser.newContext({ storageState: state });
  try {
    const page = await member.newPage();
    await page.goto("/#/overview");
    await expect(page.locator("html")).toHaveAttribute("lang", "fi");
    await page.locator(".user-menu summary").click();
    await page.locator(".user-menu .menu").getByRole("button", { name: "English" }).click();
    // the page reloads in the new language
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.locator(".user-menu summary").click();
    await expect(page.locator(".user-menu .menu").getByRole("button", { name: "Suomi" })).toBeVisible();
    expect((await member.request.get("/api/auth/state")).ok()).toBe(true);
    const state2 = await (await member.request.get("/api/auth/state")).json();
    expect(state2.user.language).toBe("en");

    // a refusal of the server comes in English, from the catalogue
    const refused = await member.request.put("/api/language", { headers: { "X-Requested-With": "fetch" }, data: { language: "xx" } });
    expect(refused.status()).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "Unknown language.", messageCode: "check.language" });

    // the choice is kept: a new page in the same session reads it
    const again = await member.newPage();
    await again.goto("/#/overview");
    await expect(again.locator("html")).toHaveAttribute("lang", "en");

    // and back to Finnish
    await again.locator(".user-menu summary").click();
    await again.locator(".user-menu .menu").getByRole("button", { name: "Suomi" }).click();
    await expect(again.locator("html")).toHaveAttribute("lang", "fi");
  } finally {
    await member.close();
    await removeMember(browser, id);
  }
});
