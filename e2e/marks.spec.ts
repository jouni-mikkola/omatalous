import { type Browser, type BrowserContext, expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// A mark belongs to one subscription: a merchant with two of them has a row and a mark for each. The rows belong to a
// household member made here and removed at the end, so the demo household of the other specs stays as it was.
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

/** A year of two subscriptions from one merchant, 7,99 on the 3rd and 12,99 on the 17th, up to `today`. */
function twoSubscriptions(today: string): string {
  const [year, month] = today.split("-").map(Number) as [number, number];
  const rows = ["Kirjauspäivä;Määrä;Nimi;Otsikko"];
  for (let back = 0; back < 13; back++) {
    const m = new Date(Date.UTC(year, month - 1 - back, 1));
    const ym = `${m.getUTCFullYear()}/${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
    for (const [day, amount] of [["03", "-7,99"], ["17", "-12,99"]] as const) {
      if (`${ym}/${day}`.replace(/\//g, "-") <= today) rows.push(`${ym}/${day};${amount};;NETFLIX.COM`);
    }
  }
  return rows.join("\n");
}

test("a mark is on one subscription: of a merchant's two, Lopetettu takes one out and the other stays, and an old mark on the merchant still covers both", async ({ browser }) => {
  const admin = await administrator(browser);
  const created = await admin.request.post("/api/users", { headers: FETCH, data: { username: "merkki", displayName: "Merkki" } });
  expect(created.ok(), await created.text()).toBe(true);
  const { user, temporaryPassword } = await created.json();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    expect((await context.request.post("/api/auth/login", { headers: FETCH, data: { username: "merkki", password: temporaryPassword } })).status()).toBe(200);
    expect((await context.request.post("/api/auth/password", { headers: FETCH, data: { current: temporaryPassword, next: PASSWORD } })).status()).toBe(200);
    const { today } = await (await context.request.get("/api/meta")).json();
    expect((await context.request.post("/api/import/csv", { headers: FETCH, data: { content: twoSubscriptions(today), accountName: "Käyttötili", accountType: "checking" } })).status()).toBe(200);

    const page = await context.newPage();
    const seen = watch(page);

    // both are small services paid for a year: the overview asks about each
    await page.goto("/#/overview");
    const alerts = page.getByRole("list", { name: "Huomiot" });
    await expect(alerts.getByText(/Netflix 12,99\s€\/kk/)).toBeVisible();
    await expect(alerts.getByText(/Netflix 7,99\s€\/kk/)).toBeVisible();

    // Laskut: one merchant, two rows, each with its price after the name and in its buttons
    await page.goto("/#/bills");
    const subs = page.locator(".card", { has: page.getByRole("heading", { name: "Tilaukset", exact: true }) });
    const row = (price: string) => subs.locator("tr", { has: page.getByRole("link", { name: "Netflix", exact: true }) }).filter({ has: page.locator(".muted", { hasText: price }) });
    await expect(row("7,99")).toHaveCount(1);
    await expect(row("12,99")).toHaveCount(1);
    await expect(subs.locator(".card-head strong")).toHaveText(/^21\s€\/kk$/);
    await expect(page.locator(".bills-line")).toContainText(/joista tilauksia 21\s€/);

    // Lopetettu on the cheaper one stores a mark on that series, not on the merchant
    const sent = page.waitForRequest((r) => r.url().endsWith("/api/marks") && r.method() === "PUT");
    await page.getByRole("button", { name: /^Lopetettu: Netflix 7,99\s€$/ }).click();
    expect((await sent).postDataJSON()).toMatchObject({ subject: expect.stringMatching(/^series:out:[^:]+:Netflix#799$/), mark: "cancelled" });
    await expect(row("7,99").locator(".badge", { hasText: "Lopetettu" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Kumoa: Netflix 7,99\s€$/ })).toBeVisible();
    // the other one is still a subscription that can be answered, and the only one in the totals
    await expect(page.getByRole("button", { name: /^Lopetettu: Netflix 12,99\s€$/ })).toBeVisible();
    await expect(row("12,99").locator(".badge", { hasText: "Lopetettu" })).toHaveCount(0);
    await expect(subs.locator(".card-head strong")).toHaveText(/^13\s€\/kk$/);
    await expect(page.locator(".bills-line")).toContainText(/joista tilauksia 13\s€/);
    await expect(subs.getByText("Merkitty lopetetuksi")).toBeVisible();

    // after a reload the same, and the overview asks only about the one that was not answered
    await page.reload();
    await expect(page.getByRole("button", { name: /^Kumoa: Netflix 7,99\s€$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Lopetettu: Netflix 12,99\s€$/ })).toBeVisible();
    await page.goto("/#/overview");
    await expect(alerts.getByText(/Netflix 12,99\s€\/kk/)).toBeVisible();
    await expect(alerts.getByText(/Netflix 7,99\s€\/kk/)).toHaveCount(0);

    // the rows with their prices and buttons fit a phone
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/bills");
    await expect(page.getByRole("button", { name: /^Kumoa: Netflix 7,99\s€$/ })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await overflow(page), "Laskut with two subscriptions of one merchant scrolls sideways at 390px").toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Kumoa takes the mark away: both are asked about again
    await page.getByRole("button", { name: /^Kumoa: Netflix 7,99\s€$/ }).click();
    await expect(page.getByRole("button", { name: /^Lopetettu: Netflix 7,99\s€$/ })).toBeVisible();
    await expect(subs.locator(".card-head strong")).toHaveText(/^21\s€\/kk$/);

    // a mark stored before marks named a series is on the merchant: it covers both rows, says so, and Kumoa on one takes it from both
    expect((await context.request.put("/api/marks", { headers: FETCH, data: { subject: "merchant:Netflix", mark: "cancelled" } })).status()).toBe(200);
    await page.reload();
    await expect(subs.getByText("Koskee kaikkia kauppiaan tilauksia.")).toHaveCount(2);
    await expect(subs.locator(".badge", { hasText: "Lopetettu" })).toHaveCount(2);
    await expect(page.locator(".bills-line")).toHaveCount(0);
    await page.getByRole("button", { name: "Kumoa: Netflix", exact: true }).first().click();
    await expect(page.getByRole("button", { name: /^Lopetettu: Netflix 7,99\s€$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Lopetettu: Netflix 12,99\s€$/ })).toBeVisible();
    await expect(subs.locator(".badge", { hasText: "Lopetettu" })).toHaveCount(0);

    // the question on the overview is answered for the one series it names, here the dearer one
    await page.goto("/#/overview");
    await expect(alerts.getByText(/Netflix 12,99\s€\/kk/)).toBeVisible();
    const answered = page.waitForRequest((r) => r.url().endsWith("/api/marks") && r.method() === "PUT");
    await alerts.getByRole("listitem").filter({ hasText: /Netflix 12,99\s€\/kk/ }).getByRole("button", { name: "Käytössä: Netflix" }).click();
    expect((await answered).postDataJSON()).toMatchObject({ subject: expect.stringMatching(/^series:out:[^:]+:Netflix#1299$/), mark: "in_use" });
    await expect(alerts.getByText(/Netflix 12,99\s€\/kk/)).toHaveCount(0);
    await expect(alerts.getByText(/Netflix 7,99\s€\/kk/)).toBeVisible();
    await page.goto("/#/bills");
    await expect(row("12,99").locator(".badge", { hasText: "Käytössä" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Lopetettu: Netflix 7,99\s€$/ })).toBeVisible();

    expect(seen.problems).toEqual([]);
  } finally {
    await context.close();
    await admin.request.delete(`/api/users/${user.id}`, { headers: FETCH });
    await admin.close();
  }
});
