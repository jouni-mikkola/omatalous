import { type Browser, type BrowserContext, expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { overflow, OVERVIEW_TILES, watch } from "./helpers.ts";

// The demo household has no bridge on Yhteenveto and none on Raportit: the bar Tulojen käyttö and its month table went
// with the extra report sections (6fbd30df7, T60), and Tulot is the kinds of income and the tax year's rows.
// The rows are the demo data of a member made here, so the demo household of the administrator that the other specs
// read stays as it is. The member is removed at the end, and one a broken run left behind is removed first, so the
// spec passes again against a server that was kept. Run alone, the spec creates the administrator itself.
const DIR = process.env.E2E_DIR ?? ".";
const STATE = join(DIR, "admin-state.json");
const MEMBER = join(DIR, "bridge-state.json");
const BASE = process.env.E2E_BASE_URL ?? "";

const USERNAME = "e2e-silta";
const FETCH = { "X-Requested-With": "fetch" };

/** The server's own day (/api/meta), read once the member is signed in. */
let today = "";
/** The member made here, removed in the end. */
let memberId = "";

async function post(context: BrowserContext, path: string, data: object): Promise<Record<string, unknown>> {
  const r = await context.request.post(`${BASE}${path}`, { data, headers: FETCH });
  expect(r.ok(), `POST ${path} answered ${r.status()}`).toBe(true);
  return (await r.json()) as Record<string, unknown>;
}

/** A member with the demo household, signed in. */
async function household(browser: Browser): Promise<void> {
  if (!existsSync(STATE)) {
    const setup = await browser.newContext();
    await post(setup, "/api/auth/setup", { code: process.env.E2E_SETUP_CODE ?? "", username: "e2e-admin", displayName: "E2E Admin", password: "e2e-salasana-123456" });
    await post(setup, "/api/admin/instance/complete", {});
    await post(setup, "/api/demo", {});
    await setup.storageState({ path: STATE });
    await setup.close();
  }
  const admin = await browser.newContext({ storageState: STATE });
  // a member left by a run that broke before its end
  const { users } = (await (await admin.request.get(`${BASE}/api/users`, { headers: FETCH })).json()) as { users: { id: string; username: string }[] };
  for (const u of users.filter((x) => x.username === USERNAME)) await admin.request.delete(`${BASE}/api/users/${u.id}`, { headers: FETCH });
  const { user, temporaryPassword } = (await post(admin, "/api/users", { username: USERNAME, displayName: "E2E Silta", role: "member" })) as { user: { id: string }; temporaryPassword: string };
  memberId = user.id;
  await admin.close();
  const member = await browser.newContext();
  await post(member, "/api/auth/login", { username: USERNAME, password: temporaryPassword });
  await post(member, "/api/auth/first-password", { next: "e2e-silta-123456" });
  today = ((await (await member.request.get(`${BASE}/api/meta`, { headers: FETCH })).json()) as { today: string }).today;
  expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await post(member, "/api/demo", {});
  await member.storageState({ path: MEMBER });
  await member.close();
}

/** The member and its rows go, so the instance is as the spec found it. */
async function remove(browser: Browser): Promise<void> {
  if (!memberId) return;
  const admin = await browser.newContext({ storageState: STATE });
  const gone = await admin.request.delete(`${BASE}/api/users/${memberId}`, { headers: FETCH });
  expect(gone.ok(), `DELETE /api/users answered ${gone.status()}`).toBe(true);
  await admin.close();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => household(browser));
test.afterAll(async ({ browser }) => remove(browser));

test("The demo household: Yhteenveto carries no bridge, and Tulot has no bar of where the income went", async ({ browser }) => {
  const context = await browser.newContext({ storageState: MEMBER, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  // Yhteenveto answers the question of the payday: it has no bridge and no savings rate
  await page.goto("/#/overview");
  await expect(page.locator(OVERVIEW_TILES)).toBeVisible();
  await expect(page.locator(".bridge")).toHaveCount(0);
  await page.goto("/#/reports?q=tulot");
  await expect(page.getByRole("region", { name: "Tulolajit" })).toBeVisible();
  await expect(page.locator("#kassavirta")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Tulojen käyttö/ })).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("390 px: Yhteenveto and Tulot fit the phone", async ({ browser }) => {
  const context = await browser.newContext({ storageState: MEMBER, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview");
  await expect(page.locator(OVERVIEW_TILES)).toBeVisible();
  expect(await overflow(page), "sideways scroll").toBeLessThanOrEqual(1);

  await page.goto("/#/reports?q=tulot");
  await expect(page.getByRole("table", { name: "Tulolajit" })).toBeVisible();
  expect(await overflow(page), "sideways scroll on Tulot").toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});
