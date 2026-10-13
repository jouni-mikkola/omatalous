import { expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { linkFakeBank, makeMember, overflow, removeMember, waitForSync, watch } from "./helpers.ts";

// The page asks the server to fetch rows when it is opened (POST /api/sync/open) and says how fresh they are. The route is
// answered here, one answer after another, so the page is tested whatever the bank state of the server; the last case uses the real route.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

type Answer = { state: string; lastAt: string | null; inserted: number; nextAt: string | null };
const today = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const running: Answer = { state: "running", lastAt: null, inserted: 0, nextAt: null };
const limited: Answer = { state: "limited", lastAt: today(6, 2), inserted: 0, nextAt: today(18, 0) };
const fresh = (inserted: number): Answer => ({ state: "fresh", lastAt: today(18, 42), inserted, nextAt: null });

/** Answers the route with the given answers in turn (the last one repeats), or with 404; `asked.n` counts the calls. */
async function mockOpen(page: Page, answers: Answer[] | 404) {
  const asked = { n: 0 };
  await page.route("**/api/sync/open", async (route) => {
    const i = asked.n++;
    if (answers === 404) return route.fulfill({ status: 404, json: { error: "not found" } });
    await route.fulfill({ json: answers[Math.min(i, answers.length - 1)] });
  });
  return asked;
}

/** The requests of one data route of the open page (Yhteenveto). */
function countDashboard(page: Page) {
  const seen = { n: 0 };
  page.on("request", (r) => {
    if (/\/api\/dashboard/.test(r.url())) seen.n++;
  });
  return seen;
}

test("running twice and then fresh with new rows: the line follows and the open page asks its data again", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE });
  const page = await context.newPage();
  const seen = watch(page);
  const asked = await mockOpen(page, [running, running, fresh(2)]);
  const data = countDashboard(page);
  await page.goto("/#/overview");
  const line = page.locator(".sync-line");
  await expect(line).toHaveText("Haetaan tapahtumia pankista…");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  const first = data.n;
  await expect(line).toHaveText("Tapahtumat päivitetty klo 18.42", { timeout: 15_000 });
  expect(asked.n).toBe(3);
  expect(first).toBeGreaterThan(0);
  await expect.poll(() => data.n, { timeout: 10_000 }).toBeGreaterThan(first);
  await expect(page.locator(".notice", { hasText: "Uusia tapahtumia" })).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("with the focus in a form field the page is not drawn again: a notice offers it", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE });
  const page = await context.newPage();
  const asked = await mockOpen(page, [running, fresh(2)]);
  const data = countDashboard(page);
  // the first call is held until a field has the focus, so the new rows arrive under the user's hands
  let release: () => void = () => {};
  const held = new Promise<void>((done) => (release = done));
  await page.route("**/api/sync/open", async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto("/#/overview");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => {
    const field = document.createElement("input");
    field.id = "typed";
    document.querySelector(".sheet")!.appendChild(field);
    field.focus();
  });
  const before = data.n;
  release();
  const notice = page.locator(".notice", { hasText: "Uusia tapahtumia: 2." });
  await expect(notice).toBeVisible({ timeout: 15_000 });
  expect(asked.n).toBe(2);
  await expect(page.locator("#typed")).toBeFocused();
  expect(data.n).toBe(before);
  await notice.getByRole("button", { name: "Näytä" }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.locator("#typed")).toHaveCount(0);
  await expect.poll(() => data.n).toBeGreaterThan(before);
  await context.close();
});

test("the bank's limit: the line has both times and the page asks once", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE });
  const page = await context.newPage();
  const asked = await mockOpen(page, [limited]);
  await page.goto("/#/overview");
  await expect(page.locator(".sync-line")).toHaveText("Tapahtumat päivitetty klo 6.02. Pankki rajoittaa hakukertoja, seuraava haku klo 18.00.");
  await page.waitForTimeout(500);
  expect(asked.n).toBe(1);
  await context.close();
});

test("an older server answers 404: no line, no error, one request", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE });
  const page = await context.newPage();
  const asked = await mockOpen(page, 404);
  await page.goto("/#/overview");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".sync-line")).toHaveText("");
  await expect(page.locator(".notice.warning")).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(asked.n).toBe(1);
  await context.close();
});

test("on a phone the limit line wraps and the page does not scroll sideways", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  await mockOpen(page, [limited]);
  await page.goto("/#/overview");
  await expect(page.locator(".sync-line")).toContainText("Pankki rajoittaa hakukertoja");
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await context.close();
});

test("on the real route a member with a fresh link sees when the rows were fetched, a member with no connection sees no line", async ({ browser }) => {
  const linked = await makeMember(browser, "avaus-yhdistetty");
  const bare = await makeMember(browser, "avaus-yhdistamaton");
  try {
    const context = await browser.newContext({ storageState: linked.state });
    const page = await context.newPage();
    await linkFakeBank(page);
    await waitForSync(context);
    await page.goto("/#/overview");
    await page.reload();
    await expect(page.locator(".sync-line")).toHaveText(/^Tapahtumat päivitetty klo \d{1,2}\.\d{2}/, { timeout: 15_000 });
    await context.close();

    const other = await browser.newContext({ storageState: bare.state });
    const empty = await other.newPage();
    await empty.goto("/#/overview");
    await expect(empty.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    await empty.waitForTimeout(500);
    await expect(empty.locator(".sync-line")).toHaveText("");
    await other.close();
  } finally {
    await removeMember(browser, linked.id);
    await removeMember(browser, bare.id);
  }
});
