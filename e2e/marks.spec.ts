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
 * The administrator: signed in by e2e/run.mjs, and set up here through the API only on a server that has none.
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

test("a mark is on one subscription: of a merchant's two, Merkitse lopetetuksi takes one out and the other stays, and an old mark on the merchant still covers both", async ({ browser }) => {
  const admin = await administrator(browser);
  const created = await admin.request.post("/api/users", { headers: FETCH, data: { username: "merkki", displayName: "Merkki" } });
  expect(created.ok(), await created.text()).toBe(true);
  const { user, temporaryPassword } = await created.json();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    expect((await context.request.post("/api/auth/login", { headers: FETCH, data: { username: "merkki", password: temporaryPassword } })).status()).toBe(200);
    expect((await context.request.post("/api/auth/first-password", { headers: FETCH, data: { next: PASSWORD } })).status()).toBe(200);
    expect((await context.request.post("/api/demo", { headers: FETCH })).status()).toBe(200);

    const page = await context.newPage();
    const seen = watch(page);

    // the dearer one is a small service paid for a year, and Tarkistettavat asks about it; the 0,99 is too small to ask about
    const asked = async () => {
      const { items } = (await (await context.request.get("/api/review")).json()) as { items: { kind: string; merchant?: string; monthlyCents?: number; subject?: string }[] };
      return items.filter((i) => i.kind === "subscription" && i.merchant === "Apple");
    };
    expect((await asked()).map((i) => i.monthlyCents)).toEqual([1299]);

    // Laskut: one merchant, two rows, each with its price in its name; a row's one action is in its drill
    await page.goto("/#/bills");
    const subs = page.locator("#laskut-taulukko");
    const drill = (price: string) => page.getByRole("button", { name: new RegExp(`^Tiedot: Apple ${price}\\s€$`) });
    const row = (price: string) => subs.locator("tr", { has: drill(price) });
    // the rows of the table that carry a drill door and the badge; the open drill has the badge too but no door
    const stopped = subs.locator("tbody tr").filter({ has: page.locator("button.rt-drill") }).filter({ hasText: "Merkitty lopetetuksi" });
    // a stopped subscription waits in the folded Päättyneet
    const unfold = () => subs.locator("details.sub-ended").evaluate((d: HTMLDetailsElement) => (d.open = true));
    const total = async () => euros(await subs.locator(".card-head .card-datum").innerText());
    await expect(drill("0,99")).toHaveCount(1);
    await expect(drill("12,99")).toHaveCount(1);
    const before = await total();
    expect(before).toBeGreaterThan(100);

    // Merkitse lopetetuksi on the dearer one stores a mark on that series, not on the merchant
    await drill("12,99").click();
    const sent = page.waitForRequest((r) => r.url().endsWith("/api/marks") && r.method() === "PUT");
    await page.getByRole("button", { name: /^Merkitse lopetetuksi: Apple 12,99\s€$/ }).click();
    expect((await sent).postDataJSON()).toMatchObject({ subject: expect.stringMatching(/^series:out:[^:]+:Apple#1299$/), mark: "cancelled" });
    await expect(page.getByRole("button", { name: /^Kumoa: Apple 12,99\s€$/ })).toBeVisible();
    // it stands under Merkitty lopetetuksi; the other one is still a subscription, and the only Apple in the total
    await expect(stopped.filter({ has: drill("12,99") })).toHaveCount(1);
    await expect(stopped.filter({ has: drill("0,99") })).toHaveCount(0);
    await expect.poll(async () => before - (await total())).toBeGreaterThanOrEqual(12);
    expect(before - (await total())).toBeLessThanOrEqual(13);

    // after a reload the same, and Tarkistettavat no longer asks about the one that was answered
    await page.reload();
    await unfold();
    await expect(stopped.filter({ has: drill("12,99") })).toHaveCount(1);
    expect(await asked()).toEqual([]);

    // the rows and an open drill fit a phone
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/bills");
    await drill("12,99").click();
    await expect(page.getByRole("button", { name: /^Kumoa: Apple 12,99\s€$/ })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await overflow(page), "Laskut with two subscriptions of one merchant scrolls sideways at 390px").toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Kumoa takes the mark away: the sum is as it was
    await page.getByRole("button", { name: /^Kumoa: Apple 12,99\s€$/ }).click();
    await expect(page.getByRole("button", { name: /^Merkitse lopetetuksi: Apple 12,99\s€$/ })).toBeVisible();
    await expect.poll(total).toBe(before);

    // a mark stored before marks named a series is on the merchant: it covers both rows, says so, and Kumoa on one takes it from both
    expect((await context.request.put("/api/marks", { headers: FETCH, data: { subject: "merchant:Apple", mark: "cancelled" } })).status()).toBe(200);
    await page.reload();
    await unfold();
    await expect(stopped.filter({ has: drill("12,99") })).toHaveCount(1);
    await expect(stopped.filter({ has: drill("0,99") })).toHaveCount(1);
    await drill("0,99").click();
    await expect(subs.getByText("Koskee kaikkia kauppiaan tilauksia.")).toHaveCount(1);
    // both Apple prices leave the sum: 13,98 a month
    await expect.poll(async () => before - (await total())).toBeGreaterThanOrEqual(13);
    expect(before - (await total())).toBeLessThanOrEqual(14);
    await page.getByRole("button", { name: "Kumoa: Apple", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Merkitse lopetetuksi: Apple 0,99\s€$/ })).toBeVisible();
    await expect(stopped).toHaveCount(0);
    await expect.poll(total).toBe(before);

    // the question in Tarkistettavat is answered for the one series it names; Laskut asks nothing of it
    const [question] = await asked();
    expect(question?.subject).toMatch(/^series:out:[^:]+:Apple#1299$/);
    expect((await context.request.put("/api/marks", { headers: FETCH, data: { subject: question!.subject, mark: "in_use" } })).status()).toBe(200);
    expect(await asked()).toEqual([]);
    await page.goto("/#/bills");
    await expect(row("12,99")).toHaveCount(1);
    await expect(subs.getByRole("button", { name: /^Käytössä/ })).toHaveCount(0);
    await expect(stopped).toHaveCount(0);

    expect(seen.problems).toEqual([]);
  } finally {
    await context.close();
    await admin.request.delete(`/api/users/${user.id}`, { headers: FETCH });
    await admin.close();
  }
});
