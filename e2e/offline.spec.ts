import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { createMember, removeMember } from "./helpers.ts";
import { join } from "node:path";

// The installable app: a manifest the browser accepts, and Yhteenveto that opens with no network from what the device kept
// at the last visit, with the time of those figures. The kept figures are one user's and end at logout. The specs sign in
// again (the login form) instead of using the administrator's state file: a logout ends the session it was made with, and the
// other specs share that one.
const ADMIN = { username: "e2e-admin", password: "e2e-salasana-123456" };
const STORE = "omatalous-figures";

async function signIn(page: Page, username = ADMIN.username, password = ADMIN.password): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Käyttäjätunnus").fill(username);
  await page.getByLabel("Salasana").fill(password);
  await page.getByRole("button", { name: "Kirjaudu" }).click();
  await expect(page.getByRole("navigation", { name: "Päävalikko" })).toBeVisible();
}

/** The service worker is in charge of the page, so a later visit with no network finds the app's files. */
async function waitForWorker(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

/** The requests whose answers the page kept for offline use, or null while there is no store. */
async function kept(page: Page): Promise<string[] | null> {
  return page.evaluate(async (name) => {
    if (!(await caches.has(name))) return null;
    return (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search);
  }, STORE);
}

async function openOffline(context: BrowserContext, page: Page): Promise<void> {
  await context.setOffline(true);
  // the service worker's own requests must fail too, or the test would prove nothing about the kept files
  for (const worker of context.serviceWorkers()) {
    expect(await worker.evaluate(() => fetch("/index.html").then(() => "reached", () => "unreachable"))).toBe("unreachable");
  }
  await page.reload();
}

async function signedInContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page);
  await waitForWorker(page);
  return { context, page };
}

test("the app is installable: a manifest with icons the browser accepts and a service worker in charge", async ({ browser }) => {
  const { context, page } = await signedInContext(browser);
  const cdp = await context.newCDPSession(page);
  const manifest = (await cdp.send("Page.getAppManifest")) as { url?: string; errors: unknown[]; data?: string };
  expect(manifest.errors).toEqual([]);
  const parsed = JSON.parse(manifest.data ?? "{}") as { name: string; display: string; icons: { purpose: string; sizes: string }[] };
  expect(parsed.name).toBe("Omatalous");
  expect(parsed.display).toBe("standalone");
  expect(parsed.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
  const { installabilityErrors } = (await cdp.send("Page.getInstallabilityErrors")) as { installabilityErrors: { errorId: string }[] };
  expect(installabilityErrors).toEqual([]);
  await context.close();
});

test("Yhteenveto opens with no network after one visit and says when its figures were fetched", async ({ browser }) => {
  const { context, page } = await signedInContext(browser);
  const pace = page.getByRole("region", { name: "Menot tässä kuussa", exact: true });
  await expect(pace).toBeVisible({ timeout: 15_000 });
  // what the page kept: who is signed in, the shell's answer, the questions and the figures of the month
  await expect.poll(async () => (await kept(page))?.some((p) => p.startsWith("/api/reports?")) ?? false).toBe(true);
  expect(await kept(page)).toEqual(expect.arrayContaining(["/api/auth/state", "/api/meta", "/api/review", expect.stringMatching(/^\/api\/dashboard\?/)]));
  // nothing the page marked as not for keeping: the login's answers, the security log and the like
  expect((await kept(page))!.filter((p) => /security|users|auth\/login/.test(p))).toEqual([]);
  await expect(page.getByText("Ei yhteyttä palvelimeen")).toHaveCount(0);

  await openOffline(context, page);
  await expect(pace).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Yhteenveto" })).toBeAttached();
  const notice = page.getByRole("status").filter({ hasText: "Ei yhteyttä palvelimeen" });
  await expect(notice).toContainText(/Näkyvät luvut on haettu \d{1,2}\.\d{1,2}\.\d{4} klo \d{1,2}\.\d{2}\./);
  // no line about a failed fetch from the bank: nothing was asked of it
  await expect(page.getByText("Tapahtumien haku pankista epäonnistui")).toHaveCount(0);

  // the network is back: the page asks again, and the notice goes when the server answers
  await context.setOffline(false);
  await expect(notice).toHaveCount(0, { timeout: 15_000 });
  await expect(pace).toBeVisible();
  await context.close();
});

test("logout empties the kept figures, and with no session and no network there is nothing to open", async ({ browser }) => {
  const { context, page } = await signedInContext(browser);
  await expect(page.getByRole("region", { name: "Menot tässä kuussa", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => kept(page)).toEqual(expect.arrayContaining(["/api/meta"]));

  await page.locator(".user-menu > summary").click();
  await page.getByRole("button", { name: "Kirjaudu ulos" }).click();
  await expect(page.getByRole("heading", { name: "Kirjaudu sisään" })).toBeVisible();
  expect(await kept(page)).toBeNull();

  await openOffline(context, page);
  await expect(page.getByText("Palvelimeen ei saada yhteyttä")).toBeVisible();
  await expect(page.getByRole("region", { name: "Menot tässä kuussa", exact: true })).toHaveCount(0);
  expect(await kept(page)).toBeNull();
  await context.close();
});

test("a lost session and another user's sign-in empty what the last user's visit left", async ({ browser }) => {
  const dir = process.env.E2E_DIR ?? ".";
  const admin = await browser.newContext({ storageState: join(dir, "admin-state.json") });
  const member = await browser.newContext();
  const username = "offlinemember";
  const id = await createMember(admin, member, username);
  await member.close();
  await admin.close();
  try {
    const { context, page } = await signedInContext(browser);
    await expect(page.getByRole("region", { name: "Menot tässä kuussa", exact: true })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => kept(page)).toEqual(expect.arrayContaining(["/api/meta"]));

    // the session ends without a logout in the page (it ran out, or the cookie was cleared): the next visit finds no user
    await context.clearCookies();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Kirjaudu sisään" })).toBeVisible();
    expect(await kept(page)).toBeNull();

    // another member of the household signs in on the same browser: only their own figures are kept
    await page.getByLabel("Käyttäjätunnus").fill(username);
    await page.getByLabel("Salasana").fill(`${username}-123456`);
    await page.getByRole("button", { name: "Kirjaudu" }).click();
    await expect(page.getByRole("navigation", { name: "Päävalikko" })).toBeVisible();
    await expect.poll(() => kept(page)).toEqual(expect.arrayContaining(["/api/auth/state", "/api/meta"]));
    const stored = await page.evaluate(async (name) => (await (await (await caches.open(name)).match("/api/auth/state"))!.json()) as { user: { username: string } }, STORE);
    expect(stored.user.username).toBe(username);
    expect((await kept(page))!.filter((p) => p.startsWith("/api/dashboard"))).toEqual([]);
    await context.close();
  } finally {
    await removeMember(browser, id);
  }
});

test("answers that reach an old tab after another user signed in, in another tab, are not kept for the new user", async ({ browser }) => {
  const dir = process.env.E2E_DIR ?? ".";
  const admin = await browser.newContext({ storageState: join(dir, "admin-state.json") });
  const member = await browser.newContext();
  const username = "latemember";
  const id = await createMember(admin, member, username);
  await member.close();
  await admin.close();
  try {
    const context = await browser.newContext();
    const first = await context.newPage();
    await signIn(first);
    await waitForWorker(first);
    await first.goto("about:blank");

    // the administrator's dashboard is fetched by the old tab, and held on its way to the page
    const old = await context.newPage();
    let release = () => {};
    const held = new Promise<void>((ok) => (release = ok));
    let reached = () => {};
    const asked = new Promise<void>((ok) => (reached = ok));
    await old.route(/\/api\/dashboard\?/, async (route) => {
      const answer = await route.fetch();
      reached();
      await held;
      await route.fulfill({ response: answer });
    });
    await old.goto("/");
    await asked;

    // the same for the administrator's "who is signed in", held in a tab of its own
    const late = await context.newPage();
    let releaseAuth = () => {};
    const heldAuth = new Promise<void>((ok) => (releaseAuth = ok));
    let reachedAuth = () => {};
    const askedAuth = new Promise<void>((ok) => (reachedAuth = ok));
    await late.route(/\/api\/auth\/state$/, async (route) => {
      const answer = await route.fetch();
      reachedAuth();
      await heldAuth;
      await route.fulfill({ response: answer });
    });
    await late.goto("/");
    await askedAuth;

    // in another tab the administrator logs out and another member signs in on the same browser
    const next = await context.newPage();
    await next.goto("/");
    await next.locator(".user-menu > summary").click();
    await next.getByRole("button", { name: "Kirjaudu ulos" }).click();
    await expect(next.getByRole("heading", { name: "Kirjaudu sisään" })).toBeVisible();
    await next.getByLabel("Käyttäjätunnus").fill(username);
    await next.getByLabel("Salasana").fill(`${username}-123456`);
    await next.getByRole("button", { name: "Kirjaudu" }).click();
    await expect(next.getByRole("navigation", { name: "Päävalikko" })).toBeVisible();
    await expect.poll(() => kept(next)).toEqual(expect.arrayContaining(["/api/auth/state"]));

    // the old answer arrives now, and gets a moment to be written
    releaseAuth();
    release();
    await old.waitForTimeout(1500);
    const keys = (await kept(next))!;
    expect(keys.filter((p) => /^\/api\/(dashboard|reports)/.test(p))).toEqual([]);
    expect(await next.evaluate(async (name) => (await (await (await caches.open(name)).match("/figures/owner"))!.text()), STORE)).toBe(id);
    // and the user the device would open as with no network is the new one, not the administrator
    const stored = await next.evaluate(async (name) => (await (await (await caches.open(name)).match("/api/auth/state"))!.json()) as { user: { username: string } }, STORE);
    expect(stored.user.username).toBe(username);
    await context.close();
  } finally {
    await removeMember(browser, id);
  }
});
