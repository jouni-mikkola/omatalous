import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { makeMember, removeMember, watch } from "./helpers.ts";

const FETCH = { "X-Requested-With": "fetch" };

// The sign-in form stands in place of the page and leaves the address alone (App.tsx): a link from a notice or a bookmark,
// opened with no session, opens its own page once the form is sent, with the parameters it carried.
const ADDRESSES = [
  ["#/bills", /^Laskut/],
  ["#/reports?q=menot&period=6m", /^Raportit/],
  ["#/settings/security", /^Asetukset/],
] as const;

const hash = (page: Page) => () => new URL(page.url()).hash;
// the one problem let through is a 401 of the page's first read of who is signed in, and its console line. With no session
// that read answers 200 with no user today, so this filters nothing: it is here because nothing else may ever pass
const butFirstRead = (problems: string[]) => problems.filter((p) => !/^(HTTP 401: GET \S+\/api\/auth\/state|console error: .*\b401\b.*\(\S+\/api\/auth\/state\))$/.test(p));

async function signIn(page: Page, username: string, password: string): Promise<void> {
  await expect(page.getByRole("heading", { name: "Kirjaudu sisään" })).toBeVisible();
  await page.getByLabel("Käyttäjätunnus").fill(username);
  await page.getByLabel("Salasana", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Kirjaudu sisään" }).click();
}

test("signing in opens the page the address named, with its parameters", async ({ browser }) => {
  const username = "e2e-osoite";
  const { id } = await makeMember(browser, username);
  try {
    for (const [address, title] of ADDRESSES) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      try {
        const page = await context.newPage();
        const seen = watch(page);
        await page.goto(`/${address}`);
        await signIn(page, username, `${username}-123456`);
        await expect(page).toHaveTitle(title);
        await expect(page.getByRole("heading", { name: "Kirjaudu sisään" })).toHaveCount(0);
        await page.waitForLoadState("networkidle");
        expect(hash(page)(), `${address} stays after the sign-in`).toBe(address);
        expect(butFirstRead(seen.problems), address).toEqual([]);
      } finally {
        await context.close();
      }
    }
  } finally {
    await removeMember(browser, id);
  }
});

test("a member who must change the password first starts at Yhteenveto, whatever the address named", async ({ browser }) => {
  const admin = await browser.newContext({ storageState: join(process.env.E2E_DIR ?? ".", "admin-state.json") });
  const username = "e2e-osoite-eka";
  const made = await admin.request.post("/api/users", { data: { username, displayName: username }, headers: FETCH });
  expect(made.ok()).toBe(true);
  const { user, temporaryPassword } = (await made.json()) as { user: { id: string }; temporaryPassword: string };
  await admin.close();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/reports?q=menot&period=6m");
    await signIn(page, username, temporaryPassword);
    const form = page.locator(".auth-form");
    await expect(form.getByLabel("Uusi salasana (vähintään 12 merkkiä)")).toBeVisible();
    // the address is still the one that was opened while the new password is asked
    expect(hash(page)()).toBe("#/reports?q=menot&period=6m");
    await form.getByLabel("Uusi salasana (vähintään 12 merkkiä)").fill(`${username}-oma-salasana`);
    await form.getByLabel("Uusi salasana uudelleen").fill(`${username}-oma-salasana`);
    await form.getByRole("button", { name: "Vaihda salasana" }).click();
    await expect(page).toHaveTitle(/^Yhteenveto/);
    await page.waitForLoadState("networkidle");
    expect(hash(page)()).toBe("#/overview");
    expect(butFirstRead(seen.problems)).toEqual([]);
  } finally {
    await context.close();
    await removeMember(browser, user.id);
  }
});
