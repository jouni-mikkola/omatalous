import { type Browser, type BrowserContext, expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// A mark belongs to one subscription: a merchant with two of them has a row and a mark for each. The demo household
// has two from one merchant on its card, Apple at 12,99 and at 0,99 a month. The rows are the demo data of a household
// member made here and removed at the end, so the demo household of the other specs stays as it was.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };
const PASSWORD = "merkki-testin-salasana-1";

/**
 * The administrator: signed in by app.spec.ts when the whole suite runs, and set up here through the API when this
 * spec runs alone (`pnpm e2e e2e/marks.spec.ts`).
 */
async function administrator(browser: Browser): Promise<BrowserContext> {
  if (existsSync(STATE)) return browser.newContext({ storageState: STATE });
  const context = await browser.newContext();
  const setup = await context.request.post("/api/auth/setup", { headers: FETCH, data: { code: process.env.E2E_SETUP_CODE, username: "aino", displayName: "Aino", password: "aino-salasana-123", confirm: "aino-salasana-123" } });
  expect(setup.status(), await setup.text()).toBe(200);
  return context;
}

/** "238 €/kk" or "1 238 €": the whole euros of a sum as the page prints them. */
const euros = (text: string) => Number(/(\d[\d\s]*)\s€/.exec(text)![1]!.replace(/\s/g, ""));

test("a mark is on one subscription: of a merchant's two, Lopetettu takes one out and the other stays, and an old mark on the merchant still covers both", async ({ browser }) => {
  const admin = await administrator(browser);
  const created = await admin.request.post("/api/users", { headers: FETCH, data: { username: "merkki", displayName: "Merkki" } });
  expect(created.ok(), await created.text()).toBe(true);
  const { user, temporaryPassword } = await created.json();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    expect((await context.request.post("/api/auth/login", { headers: FETCH, data: { username: "merkki", password: temporaryPassword } })).status()).toBe(200);
    expect((await context.request.post("/api/auth/password", { headers: FETCH, data: { current: temporaryPassword, next: PASSWORD } })).status()).toBe(200);
    expect((await context.request.post("/api/demo", { headers: FETCH })).status()).toBe(200);

    const page = await context.newPage();
    const seen = watch(page);

    // the dearer one is a small service paid for a year, and the overview asks about it; the 0,99 is too small to ask about
    await page.goto("/#/overview");
    const alerts = page.getByRole("list", { name: "Huomiot" });
    await expect(alerts.getByText(/Apple 12,99\s€\/kk/)).toBeVisible();
    await expect(alerts.getByText(/Apple 0,99\s€\/kk/)).toHaveCount(0);

    // Laskut: one merchant, two rows, each with its price after the name and in its buttons
    await page.goto("/#/bills");
    const subs = page.locator(".card", { has: page.getByRole("heading", { name: "Tilaukset", exact: true }) });
    const row = (price: string) => subs.locator("tr", { has: page.getByRole("link", { name: "Apple", exact: true }) }).filter({ has: page.locator(".muted", { hasText: price }) });
    const total = async () => euros(await subs.locator(".card-head strong").innerText());
    const inLine = async () => euros((/joista tilauksia (.*)$/.exec(await page.locator(".bills-line").innerText()) ?? [])[1] ?? "");
    await expect(row("0,99")).toHaveCount(1);
    await expect(row("12,99")).toHaveCount(1);
    const before = await total();
    expect(before).toBeGreaterThan(100);
    expect(await inLine()).toBe(before);

    // Lopetettu on the dearer one stores a mark on that series, not on the merchant
    const sent = page.waitForRequest((r) => r.url().endsWith("/api/marks") && r.method() === "PUT");
    await page.getByRole("button", { name: /^Lopetettu: Apple 12,99\s€$/ }).click();
    expect((await sent).postDataJSON()).toMatchObject({ subject: expect.stringMatching(/^series:out:[^:]+:Apple#1299$/), mark: "cancelled" });
    await expect(row("12,99").locator(".badge", { hasText: "Lopetettu" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Kumoa: Apple 12,99\s€$/ })).toBeVisible();
    // the other one is still a subscription that can be answered, and the only Apple in the totals
    await expect(page.getByRole("button", { name: /^Lopetettu: Apple 0,99\s€$/ })).toBeVisible();
    await expect(row("0,99").locator(".badge", { hasText: "Lopetettu" })).toHaveCount(0);
    await expect.poll(async () => before - (await total())).toBeGreaterThanOrEqual(12);
    expect(before - (await total())).toBeLessThanOrEqual(13);
    expect(await inLine()).toBe(await total());
    await expect(subs.getByText("Merkitty lopetetuksi")).toBeVisible();

    // after a reload the same, and the overview no longer asks about the one that was answered
    await page.reload();
    await expect(page.getByRole("button", { name: /^Kumoa: Apple 12,99\s€$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Lopetettu: Apple 0,99\s€$/ })).toBeVisible();
    await page.goto("/#/overview");
    await expect(alerts.getByRole("listitem").first()).toBeVisible();
    await expect(alerts.getByText(/Apple 12,99\s€\/kk/)).toHaveCount(0);

    // the rows with their prices and buttons fit a phone
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/bills");
    await expect(page.getByRole("button", { name: /^Kumoa: Apple 12,99\s€$/ })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await overflow(page), "Laskut with two subscriptions of one merchant scrolls sideways at 390px").toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Kumoa takes the mark away: the sum is as it was
    await page.getByRole("button", { name: /^Kumoa: Apple 12,99\s€$/ }).click();
    await expect(page.getByRole("button", { name: /^Lopetettu: Apple 12,99\s€$/ })).toBeVisible();
    await expect.poll(total).toBe(before);

    // a mark stored before marks named a series is on the merchant: it covers both rows, says so, and Kumoa on one takes it from both
    expect((await context.request.put("/api/marks", { headers: FETCH, data: { subject: "merchant:Apple", mark: "cancelled" } })).status()).toBe(200);
    await page.reload();
    await expect(subs.getByText("Koskee kaikkia kauppiaan tilauksia.")).toHaveCount(2);
    await expect(subs.locator(".badge", { hasText: "Lopetettu" })).toHaveCount(2);
    // both Apple prices leave the sum: 13,98 a month
    await expect.poll(async () => before - (await total())).toBeGreaterThanOrEqual(13);
    expect(before - (await total())).toBeLessThanOrEqual(14);
    await page.getByRole("button", { name: "Kumoa: Apple", exact: true }).first().click();
    await expect(page.getByRole("button", { name: /^Lopetettu: Apple 0,99\s€$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Lopetettu: Apple 12,99\s€$/ })).toBeVisible();
    await expect(subs.locator(".badge", { hasText: "Lopetettu" })).toHaveCount(0);
    await expect.poll(total).toBe(before);

    // the question on the overview is answered for the one series it names
    await page.goto("/#/overview");
    await expect(alerts.getByText(/Apple 12,99\s€\/kk/)).toBeVisible();
    const answered = page.waitForRequest((r) => r.url().endsWith("/api/marks") && r.method() === "PUT");
    await alerts.getByRole("listitem").filter({ hasText: /Apple 12,99\s€\/kk/ }).getByRole("button", { name: "Käytössä: Apple" }).click();
    expect((await answered).postDataJSON()).toMatchObject({ subject: expect.stringMatching(/^series:out:[^:]+:Apple#1299$/), mark: "in_use" });
    await expect(alerts.getByText(/Apple 12,99\s€\/kk/)).toHaveCount(0);
    await page.goto("/#/bills");
    await expect(row("12,99").locator(".badge", { hasText: "Käytössä" })).toBeVisible();
    await expect(row("0,99").locator(".badge")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Lopetettu: Apple 0,99\s€$/ })).toBeVisible();

    expect(seen.problems).toEqual([]);
  } finally {
    await context.close();
    await admin.request.delete(`/api/users/${user.id}`, { headers: FETCH });
    await admin.close();
  }
});
