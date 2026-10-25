import { expect, test } from "@playwright/test";
import { fakeBank, linkFakeBank, makeMember, removeMember, waitForSync, watch } from "./helpers.ts";

// Two banks whose consents are about to end are renewed in one round from Asetukset > Pankkiyhteydet: the page takes
// the member to the first bank, the bank sends them back, the page lists which bank is done and which is left, and the
// next press goes to the other. The fake bank (e2e/fake-bank/) ends its consents in five days until it is told
// otherwise (the day count reads 4 or 5, by the hour in the household's time zone), and the household's application is saved so that the bank list offers OP beside Nordea.
const FETCH = { "X-Requested-With": "fetch" };

// each test has a member of its own, since a round starts from the consents the member has
let member: { state: string; id: string };
let sequence = 0;
test.beforeEach(async ({ browser }) => {
  member = await makeMember(browser, `e2e-kierros-${++sequence}`);
});
test.afterEach(async ({ browser }) => {
  await removeMember(browser, member.id);
});
test.beforeAll(async ({ browser }) => {
  const admin = await browser.newContext({ storageState: `${process.env.E2E_DIR}/admin-state.json` });
  const bank = fakeBank();
  expect((await admin.request.put("/api/admin/bank-app", { data: { appId: bank.appId, privateKeyPem: bank.privateKeyPem }, headers: FETCH })).ok()).toBe(true);
  await admin.close();
});
test.afterAll(async ({ browser }) => {
  const admin = await browser.newContext({ storageState: `${process.env.E2E_DIR}/admin-state.json` });
  expect((await admin.request.delete("/api/admin/bank-app", { headers: FETCH })).ok()).toBe(true);
  await admin.close();
});

async function consentDays(days: number | null) {
  const answer = await fetch(`${fakeBank().url}/fake/valid-days`, { method: "PUT", body: JSON.stringify({ days }) });
  expect(answer.status).toBe(204);
}
test.afterEach(() => consentDays(null));

test("two banks whose consents end are renewed in one round: one press goes to the first bank, the next to the other", async ({ browser }) => {
  const context = await browser.newContext({ storageState: member.state, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  const started: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/connections/start")) started.push(r.postDataJSON().bank);
  });

  await consentDays(5);
  await linkFakeBank(page);
  await linkFakeBank(page, { bank: "OP" });
  await page.goto("/#/settings");
  await page.waitForLoadState("networkidle");
  await page.reload();
  const card = page.locator("#pankkiyhteydet");
  const table = card.getByRole("table");
  await expect(table.getByRole("row", { name: /Nordea/ })).toContainText(/vielä [45] päivää/);
  await expect(table.getByRole("row", { name: /OP/ })).toContainText(/vielä [45] päivää/);

  // both are due: the round is offered, and nothing is renewed yet
  await expect(card.getByText(/Yhteys päättyy tai on päättynyt: (Nordea, OP|OP, Nordea)\./)).toBeVisible();
  await consentDays(null);
  started.length = 0;
  await card.getByRole("button", { name: "Uusi kaikki yhteydet" }).click();

  // the first bank is renewed and the browser comes back: one done, one left, and the next press names the left one
  const progress = card.locator(".renewal");
  await expect(progress).toContainText("1 / 2 uusittu", { timeout: 30_000 });
  await expect(progress.getByRole("listitem")).toHaveCount(2);
  await expect(progress.locator(".badge.good")).toHaveCount(1);
  await expect(progress.locator(".badge.warn")).toHaveCount(1);
  expect(started).toHaveLength(1);
  const left = (await progress.getByRole("listitem").filter({ has: page.locator(".badge.warn") }).innerText()).startsWith("OP") ? "OP" : "Nordea";
  expect(started[0]).toBe(left === "OP" ? "nordea-fi" : "op-fi");
  await progress.getByRole("button", { name: `Uusi ${left}` }).click();

  await expect(progress).toContainText("Kaikki yhteydet on uusittu.", { timeout: 30_000 });
  await expect(progress.locator(".badge.good")).toHaveCount(2);
  expect([...started].sort()).toEqual(["nordea-fi", "op-fi"]);

  // both consents are long again, and the ended ones are gone from the list
  await expect(table.getByRole("row", { name: /Nordea/ })).toContainText("voimassa");
  await expect(table.getByRole("row", { name: /Nordea/ })).not.toContainText(/vielä [45] päivää/);
  await expect(table.getByRole("row", { name: /OP/ })).not.toContainText(/vielä [45] päivää/);
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(card.locator(".badge.warn")).toHaveCount(0);

  await progress.getByRole("button", { name: "Sulje" }).click();
  await expect(progress).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a bank with two consents is not done until both are renewed: Nordea gives one account per consent", async ({ browser }) => {
  const context = await browser.newContext({ storageState: member.state, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);

  // two Nordea consents with accounts of their own, and OP, all about to end
  await consentDays(5);
  // each link is waited for to the end: the bank's return (?connected=n in the address, since the notice of an earlier link
  // may still show) and the sync, which holds the server for a moment so that a callback sent meanwhile can be reset
  const link = async (options: Parameters<typeof linkFakeBank>[1]) => {
    await linkFakeBank(page, options);
    await expect(page).toHaveURL(/connected=\d/);
    await waitForSync(context);
  };
  await link({});
  await link({ own: true });
  await link({ bank: "OP" });
  await consentDays(null);

  // the member picks the accounts at the bank: the next Nordea consent brings the household's other accounts when `own` is set
  let own = false;
  const bank = fakeBank();
  await context.route(`https://${bank.consentHost}/**`, async (route) => {
    const answer = await route.fetch({ url: `${bank.url}${new URL(route.request().url()).pathname}${own ? "?own=1" : ""}`, maxRedirects: 0 });
    const back = new URL(answer.headers().location ?? "");
    await route.fulfill({ status: 302, headers: { location: `${process.env.E2E_BASE_URL}/api/connections/callback${back.search}` } });
  });

  await page.goto("/#/settings");
  await page.waitForLoadState("networkidle");
  await page.reload();
  const card = page.locator("#pankkiyhteydet");
  await card.getByRole("button", { name: "Uusi kaikki yhteydet" }).click();
  const progress = card.locator(".renewal");
  await expect(progress.getByRole("listitem")).toHaveCount(3, { timeout: 30_000 });

  // press the next left consent until none is left; an `own` consent is renewed with the `own` accounts
  const ownJoint = "FI12 1234 5600 0008 50";
  for (let step = 0; step < 6 && (await progress.locator(".badge.warn").count()) > 0; step++) {
    const left = await progress.getByRole("listitem").filter({ has: page.locator(".badge.warn") }).first().innerText();
    own = left.includes(ownJoint);
    const done = await progress.locator(".badge.good").count();
    await progress.getByRole("button", { name: /^Uusi / }).click();
    // a positive match: while the browser is at the bank the list is gone, and a count of the other number would pass
    await expect(progress).toContainText(new RegExp(`${done + 1} / 3 uusittu|Kaikki yhteydet on uusittu`), { timeout: 30_000 });
  }

  // finished only when every consent is done, and no expiring consent is left in the list
  await expect(progress).toContainText("Kaikki yhteydet on uusittu.");
  await expect(progress.locator(".badge.good")).toHaveCount(3);
  await expect(card.getByRole("table").getByText("vanhenee pian")).toHaveCount(0);
  await progress.getByRole("button", { name: "Sulje" }).click();
  expect(seen.problems).toEqual([]);
  await context.close();
});
