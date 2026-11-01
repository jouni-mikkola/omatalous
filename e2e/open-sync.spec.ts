import { expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { fakeBank, linkFakeBank, makeMember, overflow, removeMember, waitForSync, watch } from "./helpers.ts";

// The page asks the server to fetch rows when it is opened (POST /api/sync/open) and says how fresh they are. The route is
// answered here, one answer after another, so the page is tested whatever the bank state of the server; the last case uses the real route.
// What it says sits in the foot of the page. Only a failed fetch rises to the top, in a Notice.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

type Answer = { state: string; lastAt: string | null; inserted: number; nextAt: string | null };
/** The browser shows times in the zone of the config (`timezoneId`), so "today at h.mm" is that zone's, whatever the runner's own zone is. */
const ZONE = "Europe/Helsinki";
const today = (h: number, m: number) => {
  const [y, mo, d] = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date()).split("-").map(Number);
  const guess = Date.UTC(y!, mo! - 1, d!, h, m);
  const p: Record<string, number> = {};
  for (const x of new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(guess)) p[x.type] = Number(x.value);
  // the zone's clock at `guess` is ahead of UTC by its offset; the instant it reads h.mm is that much earlier
  return new Date(guess - (Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!) - guess)).toISOString();
};
const failed: Answer = { state: "failed", lastAt: today(6, 2), inserted: 0, nextAt: null };
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

test("running twice and then fresh with new rows: the foot follows and the open page asks its data again", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE });
  const page = await context.newPage();
  const seen = watch(page);
  const asked = await mockOpen(page, [running, running, fresh(2)]);
  const data = countDashboard(page);
  await page.goto("/#/overview");
  const line = page.locator(".sheet-foot");
  await expect(line).toContainText("Haetaan tapahtumia pankista…");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  const first = data.n;
  await expect(line).toContainText(/Päivitetty \d{1,2}\.\d{1,2}\. klo 18\.42/, { timeout: 15_000 });
  await expect(page.locator(".notice", { hasText: "ei saatu haettua" })).toHaveCount(0);
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
  // the page is drawn before its loading line can be gone: an app that has not started yet shows neither
  await expect(page.locator(".sheet")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => {
    const field = document.createElement("input");
    field.id = "typed";
    document.querySelector(".sheet")!.appendChild(field);
    field.focus();
  });
  const before = data.n;
  release();
  const notice = page.locator(".notice", { hasText: "2 uutta tapahtumaa." });
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

test("the bank's limit: the foot has both times and the page asks once", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE });
  const page = await context.newPage();
  const asked = await mockOpen(page, [limited]);
  await page.goto("/#/overview");
  await expect(page.locator(".sheet-foot")).toContainText(/Päivitetty \d{1,2}\.\d{1,2}\. klo 6\.02\. Pankki sallii seuraavan haun \d{1,2}\.\d{1,2}\. klo 18\.00/);
  await expect(page.locator(".notice", { hasText: "ei saatu haettua" })).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(asked.n).toBe(1);
  await context.close();
});

test("a failed fetch is the one thing that rises to the top: a Notice, and the foot says nothing of it", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE });
  const page = await context.newPage();
  await mockOpen(page, [failed]);
  await page.goto("/#/overview");
  const notice = page.locator('.notice[data-tone="warning"]', { hasText: "Emme saaneet tapahtumia pankista." });
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice).toContainText(/Edellinen haku \d{1,2}\.\d{1,2}\. klo 6\.02\./);
  await expect(page.locator(".sheet-foot")).not.toContainText("Päivitetty");
  await context.close();
});

test("an older server answers 404: no foot sentence, no error, one request", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE });
  const page = await context.newPage();
  const asked = await mockOpen(page, 404);
  await page.goto("/#/overview");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".sheet-foot")).not.toContainText("Päivitetty");
  await expect(page.locator('.notice[data-tone="warning"]')).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(asked.n).toBe(1);
  await context.close();
});

test("on a phone the limit sentence in the foot wraps and the page does not scroll sideways", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 800 } });
  const page = await context.newPage();
  await mockOpen(page, [limited]);
  await page.goto("/#/overview");
  await expect(page.locator(".sheet-foot")).toContainText("Pankki sallii seuraavan haun");
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await context.close();
});

test("on the real route a member with a fresh link sees when the rows were fetched, a member with no connection sees none", async ({ browser }) => {
  const linked = await makeMember(browser, "avaus-yhdistetty");
  const bare = await makeMember(browser, "avaus-yhdistamaton");
  try {
    const context = await browser.newContext({ storageState: linked.state });
    const page = await context.newPage();
    await linkFakeBank(page);
    await waitForSync(context);
    await page.goto("/#/overview");
    await page.reload();
    await expect(page.locator(".sheet-foot")).toContainText(/Päivitetty \d{1,2}\.\d{1,2}\. klo \d{1,2}\.\d{2}/, { timeout: 15_000 });
    await context.close();

    const other = await browser.newContext({ storageState: bare.state });
    const empty = await other.newPage();
    await empty.goto("/#/overview");
    await expect(empty.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    await empty.waitForLoadState("networkidle");
    await expect(empty.locator(".sheet-foot")).not.toContainText("Päivitetty");
    await other.close();
  } finally {
    await removeMember(browser, linked.id);
    await removeMember(browser, bare.id);
  }
});

test("opening and reloading with rows fresher than the sync hours allow makes no call to the bank", async ({ browser }) => {
  const member = await makeMember(browser, "avaus-ei-hae");
  try {
    const context = await browser.newContext({ storageState: member.state });
    const page = await context.newPage();
    await linkFakeBank(page);
    await waitForSync(context);
    const runs = async () => ((await (await context.request.get("/api/sync/runs")).json()).runs as unknown[]).length;
    const balanceCalls = async () => ((await (await fetch(`${fakeBank().url}/fake/balance-calls`)).json()) as { calls: number }).calls;
    const before = { calls: await balanceCalls(), runs: await runs() };

    await page.goto("/#/overview");
    for (let i = 0; i < 3; i++) await page.reload();
    // the stored figures and the age of the rows are on the page without waiting for the bank
    await expect(page.locator(".sheet-foot")).toContainText(/Päivitetty \d{1,2}\.\d{1,2}\. klo \d{1,2}\.\d{2}/, { timeout: 15_000 });
    await expect(page.getByText("Haetaan tapahtumia pankista…")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect({ calls: await balanceCalls(), runs: await runs() }).toEqual(before);
    await context.close();
  } finally {
    await removeMember(browser, member.id);
  }
});
