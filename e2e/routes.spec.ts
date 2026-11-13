import { expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { unfold, watch } from "./helpers.ts";

// The routes (apps/web/src/router.tsx): every address from before the router opens the page it always opened, the
// period and the order of a table are kept in the address and come back with a reload, and the header asks for the
// count of open questions alone: the whole queue is read by Tarkistettavat only.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

const hash = (page: Page) => () => new URL(page.url()).hash;

test("every address of the app opens its page, and an old address is rewritten to where the page lives now", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  // the pages with an address of their own stay where they were
  for (const [address, title] of [
    ["overview", /^Yhteenveto/],
    ["bills", /^Laskut/],
    ["transactions", /^Tapahtumat/],
    ["reports", /^Raportit/],
    ["review", /^Tarkistettavat/],
    ["settings/banks", /^Asetukset/],
    ["settings/household", /^Asetukset/],
  ] as const) {
    await page.goto(`/#/${address}`);
    await expect(page).toHaveTitle(title);
    expect(hash(page)(), `#/${address} stays`).toBe(`#/${address}`);
  }
  // Asetukset with no target opens the first one
  await page.goto("/#/settings");
  await expect.poll(hash(page), "#/settings opens Pankit ja tilit").toBe("#/settings/banks");
  // no page in the address, a page that does not exist
  for (const empty of ["/", "/#/", "/#/nowhere"]) {
    await page.goto(empty);
    await expect(page).toHaveTitle(/^Yhteenveto/);
    await expect.poll(hash(page), `${empty} opens Yhteenveto`).toBe("#/overview");
  }
  // an address from before the pages were merged, with the parameters and the anchor it carried
  for (const [old, now, title] of [
    ["more", "#/overview", /^Yhteenveto/],
    ["recurring", "#/bills", /^Laskut/],
    ["recurring#kuukaudet", "#/bills#kuukaudet", /^Laskut/],
    ["categories", "#/transactions?view=merchants", /^Tapahtumat/],
    ["categories?tab=rules", "#/transactions?view=merchants#saannot", /^Tapahtumat/],
    ["rules", "#/transactions?view=merchants#saannot", /^Tapahtumat/],
    ["settings?section=security", "#/settings/security#turvallisuusloki", /^Asetukset/],
    ["overview?period=12m", "#/reports?period=12m", /^Raportit/],
  ] as const) {
    await page.goto("/#/reports");
    await page.goto(`/#/${old}`);
    await expect.poll(hash(page), `${old} is rewritten`).toBe(now);
    await expect(page).toHaveTitle(title);
    await page.goBack();
    expect(page.url(), `Back from ${old} skips the old address`).toMatch(/#\/reports$/);
  }
  // addresses of views that are gone open the page that holds their work now
  for (const [old, title, target] of [
    ["reports?tab=havainnot", /^Raportit/, /^#\/reports/],
    ["reports#havainnot", /^Raportit/, /^#\/reports/],
    ["settings#palvelutunnukset", /^Asetukset/, /^#\/settings\/security/],
    ["settings#tilien-jakaminen", /^Asetukset/, /^#\/settings\/banks/],
    ["settings#jasenet-ilman-tunnusta", /^Asetukset/, /^#\/settings\/members/],
  ] as const) {
    await page.goto(`/#/${old}`);
    await expect(page).toHaveTitle(title);
    await expect.poll(hash(page), `${old} lands on its page`).toMatch(target);
  }
  // a filter of Tapahtumat is a parameter of the address and narrows the list after a reload
  await page.goto("/#/transactions?kind=income");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await page.reload();
  expect(hash(page)()).toBe("#/transactions?kind=income");
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the period of Raportit and the order of a table are in the address and stay after a reload", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  const pressed = page.getByRole("toolbar", { name: "Aikaväli" }).locator("button[aria-pressed=true]");
  await page.goto("/#/reports?period=6m&q=menot");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await expect(pressed).toHaveText("6 kk");
  await unfold(page, "kategoriat");

  // a press of a head puts the order in the address, in place: Back does not step through the presses
  const head = page.getByRole("columnheader", { name: /^Yhteensä/ }).first();
  await head.getByRole("button").click();
  await expect(head).toHaveAttribute("aria-sort", "descending");
  await expect.poll(() => new URLSearchParams(hash(page)().split("?")[1]).get("sort")).toMatch(/:desc\.\w+/);
  await head.getByRole("button").click();
  await expect(head).toHaveAttribute("aria-sort", "ascending");
  const address = hash(page)();
  expect(address).toContain("period=6m");

  await page.reload();
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  expect(hash(page)(), "the address is the same").toBe(address);
  await expect(pressed).toHaveText("6 kk");
  await unfold(page, "kategoriat");
  await expect(page.getByRole("columnheader", { name: /^Yhteensä/ }).first()).toHaveAttribute("aria-sort", "ascending");

  // a third press gives back the server's order and takes the parameter away
  await page.getByRole("columnheader", { name: /^Yhteensä/ }).first().getByRole("button").click();
  await expect(page.getByRole("columnheader", { name: /^Yhteensä/ }).first()).toHaveAttribute("aria-sort", "none");
  await expect.poll(() => new URLSearchParams(hash(page)().split("?")[1]).has("sort")).toBe(false);

  // a period chosen on the page is the address too
  await page.getByRole("toolbar", { name: "Aikaväli" }).getByRole("button", { name: "3 kk" }).click();
  await expect.poll(hash(page)).toContain("period=3m");
  await page.reload();
  await expect(pressed).toHaveText("3 kk");
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("every page reads the count and none but Tarkistettavat the queue; the mark says what the title of Tarkistettavat says", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const called: string[] = [];
  page.on("request", (r) => {
    const { pathname } = new URL(r.url());
    if (pathname.startsWith("/api/review")) called.push(pathname);
  });

  // what the server holds: the count is the length of the queue
  const queue = ((await (await context.request.get("/api/review")).json()) as { items: unknown[] }).items;
  expect(await (await context.request.get("/api/review/count")).json()).toEqual({ count: queue.length });
  called.length = 0;

  await page.goto("/#/overview");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("region", { name: "Kuukausi", exact: true })).toBeVisible({ timeout: 15_000 });
  expect(called, "Yhteenveto reads the count").toContain("/api/review/count");
  await page.waitForLoadState("networkidle");
  for (const address of ["bills", "transactions", "reports", "settings"]) {
    await page.goto(`/#/${address}`);
    await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  }
  expect(called, "no other page reads the queue").not.toContain("/api/review");

  // the page's count is the mark's
  const mark = page.locator(".review-link .nav-count");
  if (queue.length > 0) await expect(mark).toHaveText(`${queue.length} avoinna`);
  else await expect(mark).toHaveCount(0);
  await page.getByRole("link", { name: /^Tarkistettavat/ }).click();
  await expect(page).toHaveTitle(/^Tarkistettavat/);
  await context.close();
});

test("with questions open the mark in the header and the number on Tarkistettavat are the same one", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const items = [1, 2, 3].map((n) => ({ kind: "payee_out", id: `payee_out:Esimerkki ${n}`, cents: 10_000 * n, merchant: `Esimerkki ${n}`, count: 2, lastDate: "2026-09-20", picks: ["groceries"], rows: [], rowCount: 2 }));
  const called: string[] = [];
  await page.route(/\/api\/review$/, (route) => (called.push("queue"), route.fulfill({ json: { items } })));
  await page.route(/\/api\/review\/count$/, (route) => (called.push("count"), route.fulfill({ json: { count: items.length } })));
  await page.goto("/#/overview");
  const mark = page.locator(".review-link .nav-count");
  await expect(mark).toHaveText("3 avoinna");
  // the first page reads the count for the mark, and no question stands on it
  await expect.poll(() => [...new Set(called)].sort()).toEqual(["count"]);
  await page.getByRole("link", { name: /^Tarkistettavat/ }).click();
  await expect(mark).toHaveText("3 avoinna");
  // the heading and the tab title say the same number: badge, title, heading and queue are one count
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tarkistettavat: 3 avoinna");
  await expect(page).toHaveTitle(/^Tarkistettavat: 3 avoinna/);
  await context.close();
});
