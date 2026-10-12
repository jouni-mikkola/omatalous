import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";
import { join } from "node:path";

const FETCH = { "X-Requested-With": "fetch" };

/** Everything a visitor would call "broken": console errors, uncaught errors, failed requests and any 4xx or 5xx. */
export function watch(page: Page): { problems: string[] } {
  const seen = { problems: [] as string[] };
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "assert") seen.problems.push(`console ${m.type()}: ${m.text()} (${m.location().url})`);
  });
  page.on("pageerror", (e) => seen.problems.push(`page error: ${e.message}`));
  page.on("requestfailed", (r) => {
    // The app never aborts a request itself, so an aborted GET is one that a reload or navigation cut off.
    if (r.method() === "GET" && r.failure()?.errorText === "net::ERR_ABORTED") return;
    seen.problems.push(`request failed: ${r.method()} ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) seen.problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
  });
  return seen;
}

/** How far the page scrolls sideways, in pixels. */
export async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function post(context: BrowserContext, path: string, data: object): Promise<Record<string, any>> {
  const r = await context.request.post(path, { data, headers: FETCH });
  expect(r.ok(), `POST ${path} answered ${r.status()}`).toBe(true);
  return (await r.json()) as Record<string, any>;
}

/**
 * A member with a household of its own, signed in: the state file to open a context with, and the id for `removeMember`.
 * The administrator of the worker's server is there already (run.mjs made it).
 */
export async function makeMember(browser: Browser, username: string): Promise<{ state: string; id: string }> {
  const dir = process.env.E2E_DIR ?? ".";
  const admin = await browser.newContext({ storageState: join(dir, "admin-state.json") });
  const { user, temporaryPassword } = await post(admin, "/api/users", { username, displayName: username, role: "member" });
  await admin.close();
  const member = await browser.newContext();
  await post(member, "/api/auth/login", { username, password: temporaryPassword });
  await post(member, "/api/auth/password", { current: temporaryPassword, next: `${username}-123456` });
  const state = join(dir, `${username}-state.json`);
  await member.storageState({ path: state });
  await member.close();
  return { state, id: user.id };
}

/** The member and what it linked go, so the instance is as the spec found it. */
export async function removeMember(browser: Browser, id: string): Promise<void> {
  const admin = await browser.newContext({ storageState: join(process.env.E2E_DIR ?? ".", "admin-state.json") });
  const gone = await admin.request.delete(`/api/users/${id}`, { headers: FETCH });
  expect(gone.ok(), `DELETE /api/users answered ${gone.status()}`).toBe(true);
  await admin.close();
}

/** The fake bank e2e/server.mjs started: its address, its consent host and the application it accepts. */
export function fakeBank(): { url: string; consentHost: string; appId: string; privateKeyPem: string } {
  if (!process.env.E2E_FAKE_BANK) throw new Error("Run the suite with `pnpm e2e`: it starts the fake bank.");
  return JSON.parse(process.env.E2E_FAKE_BANK);
}

/**
 * Asetukset > Pankkiyhteydet as the signed-in user of `page` does it: the fake bank's application is saved as their own,
 * the bank is picked, the consent page answers, and the page comes back linked. Only the host of the consent page does not
 * exist here; every other request goes where it would in production.
 */
export async function linkFakeBank(page: Page): Promise<void> {
  const bank = fakeBank();
  const context = page.context();
  const saved = await context.request.put("/api/bank/credentials", { data: { appId: bank.appId, privateKeyPem: bank.privateKeyPem }, headers: FETCH });
  expect(saved.ok(), `PUT /api/bank/credentials answered ${saved.status()} ${await saved.text()}`).toBe(true);
  // The consent page. The fake bank answers with the redirect to the address it was given, the project's static return page
  // of a plain-http install; the browser would not follow a second answered hop, so that page's job is done here: it
  // sends the browser on to the app with the same query.
  await context.route(`https://${bank.consentHost}/**`, async (route) => {
    const answer = await route.fetch({ url: `${bank.url}${new URL(route.request().url()).pathname}`, maxRedirects: 0 });
    const back = new URL(answer.headers().location ?? "");
    await route.fulfill({ status: 302, headers: { location: `${process.env.E2E_BASE_URL}/api/connections/callback${back.search}` } });
  });
  await page.goto("/#/settings");
  await page.getByRole("button", { name: /^Yhdistä (toinen )?pankki$/ }).click();
  await page.getByRole("button", { name: "Yhdistä Nordea" }).click();
  await expect(page.locator(".notice").filter({ hasText: "Pankki yhdistetty" })).toBeVisible();
}
