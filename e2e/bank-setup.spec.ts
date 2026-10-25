import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { join } from "node:path";
import { fakeBank, watch } from "./helpers.ts";

// Asetukset > Palvelin > Enable Banking -sovellus and Pankkiyhteydet as the administrator sees them against the fake bank:
// the outside steps with their links, the redirect self-test, what the bank supports, and the line on an ended consent.
// The household's own application is saved and removed again by the test that needs it, so the other specs meet none.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };

test.describe.configure({ mode: "serial" });

async function admin(browser: Browser, width = 1280) {
  const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 } });
  const page = await context.newPage();
  return { context, page, seen: watch(page) };
}

async function setAnswer(mode: "ok" | "refuse-redirect" | "fail") {
  const answer = await fetch(`${fakeBank().url}/fake/auth-answer`, { method: "PUT", body: JSON.stringify({ mode }) });
  expect(answer.status).toBe(204);
}

/** What the app has seen of each bank so far. The server of a worker keeps these facts for good, so a spec that ran before
 *  in the same worker (one that linked the fake bank) leaves them behind: a test reads them and does not assume none. */
async function seenFacts(context: BrowserContext) {
  const answer = await context.request.get("/api/admin/bank-app/capabilities");
  expect(answer.ok()).toBe(true);
  return ((await answer.json()) as { banks: { bankId: string; cardAccounts: boolean; pending: boolean; balanceTypes: string[]; historyDays: number | null }[] }).banks;
}

async function saveApp(context: BrowserContext) {
  const bank = fakeBank();
  const saved = await context.request.put("/api/admin/bank-app", { data: { appId: bank.appId, privateKeyPem: bank.privateKeyPem }, headers: FETCH });
  expect(saved.ok(), `PUT /api/admin/bank-app answered ${saved.status()}`).toBe(true);
}

test.afterEach(async () => {
  await setAnswer("ok");
});

test("the four outside steps each have a link to Enable Banking and the done list has the linked accounts", async ({ browser }) => {
  const { context, page, seen } = await admin(browser);
  expect((await context.request.delete("/api/admin/bank-app", { headers: FETCH })).ok()).toBe(true);
  await page.goto("/#/settings?section=server");
  const steps = page.locator(".setup-steps > li");
  await expect(steps).toHaveCount(5);
  const href = (name: string) => page.getByRole("link", { name, exact: true });
  await expect(href("Avaa kirjautuminen")).toHaveAttribute("href", "https://enablebanking.com/sign-in/");
  await expect(href("Avaa Enable Banking")).toHaveAttribute("href", "https://enablebanking.com/cp/applications");
  await expect(href("Avaa Control Panel")).toHaveAttribute("href", "https://enablebanking.com/cp/applications");
  await expect(href("Avaa sovellusluettelo")).toHaveAttribute("href", "https://enablebanking.com/cp/applications");
  // one link in each of the outside steps, and the key step has none
  await expect(steps.filter({ has: page.locator("a[target=_blank]") })).toHaveCount(4);
  const checklist = page.getByLabel("Enable Banking -sovelluksen vaiheet");
  await expect(checklist.getByRole("listitem")).toHaveText(["Avain luotu", "Varmenne ladattu Enable Bankingiin", "Application ID toimii", "Tilit lisätty Enable Bankingiin"].map((t) => new RegExp(`^${t}`)));
  // done exactly when some bank has been seen: which it is depends on the specs this worker ran before, not on this one
  const linked = (await seenFacts(context)).some((b) => b.cardAccounts || b.pending || b.balanceTypes.length > 0 || b.historyDays !== null);
  const item = checklist.getByText("Tilit lisätty Enable Bankingiin");
  if (linked) await expect(item).toHaveClass(/done/);
  else await expect(item).not.toHaveClass(/done/);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Testaa paluuosoite: one line for a working address, for one the application lacks, and for a failure", async ({ browser }) => {
  const { context, page, seen } = await admin(browser);
  await saveApp(context);
  await page.goto("/#/settings?section=server");
  const test = page.getByRole("button", { name: "Testaa paluuosoite" });
  await test.click();
  await expect(page.getByText("Paluuosoite toimii.")).toBeVisible();

  await setAnswer("refuse-redirect");
  await test.click();
  const refused = page.getByText("Osoite puuttuu Redirect URLs -kohdasta:");
  await expect(refused).toBeVisible();
  await expect(page.getByText("Paluuosoite toimii.")).toBeHidden();
  // the address to add is the one the app gives Enable Banking, with its copy button
  await expect(refused.locator("code.copyable")).toHaveText(/^https?:\/\/\S+\/callback\/?$/);
  await expect(refused.getByRole("button", { name: "Kopioi paluuosoite" })).toBeVisible();

  await setAnswer("fail");
  await test.click();
  await expect(page.getByText("Testi epäonnistui.")).toBeVisible();
  await expect(refused).toBeHidden();
  expect(seen.problems.filter((p) => !/50[02]|422/.test(p))).toEqual([]);
  await context.close();
});

test("what each bank supports: a row for the bank the list named, a fact not seen reads ei vielä tiedossa", async ({ browser }) => {
  const { context, page, seen } = await admin(browser);
  await saveApp(context);
  // Testaa yhteys reads the bank list, which is what makes the record
  expect((await context.request.post("/api/admin/bank-app/test", { headers: FETCH })).ok()).toBe(true);
  await page.goto("/#/settings?section=server");
  const list = page.locator("h3", { hasText: "Nordea" }).locator("xpath=following-sibling::dl[1]");
  const cell = (label: string) => list.locator("div", { has: page.getByText(label, { exact: true }) }).locator("dd");
  await expect(cell("Suostumuksen pituus")).toHaveText("180 päivää");
  // a fact reads ei vielä tiedossa until a link or a fetch has seen it; an earlier spec of this worker may have seen it
  const facts = (await seenFacts(context)).find((b) => b.bankId === "nordea-fi")!;
  expect(facts, "the record of the bank the list named").toBeTruthy();
  await expect(cell("Korttitilit")).toHaveText(facts.cardAccounts ? "kyllä" : "ei vielä tiedossa");
  await expect(cell("Saldotyypit")).toHaveText(facts.balanceTypes.length ? facts.balanceTypes.join(", ") : "ei vielä tiedossa");
  await expect(cell("Historia")).toHaveText(facts.historyDays === null ? "ei vielä tiedossa" : /päiv/);
  // the outside steps are for the setup: once the application is saved they give way to the facts and the test
  await expect(page.getByLabel("Enable Banking -sovelluksen vaiheet")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a consent the bank ended says why on its row and offers Yhdistä uudelleen; an active one has no such line", async ({ browser }) => {
  const { context, page, seen } = await admin(browser);
  const consent = (id: string, state: string, needsRenewal: boolean) => ({
    id,
    institution: id === "a" ? "Nordea" : "OP",
    status: state === "active" ? "active" : "expired",
    state,
    history: false,
    replaced: false,
    validUntil: "2026-12-01T00:00:00Z",
    createdAt: "2026-06-01T00:00:00Z",
    lastSyncedAt: "2026-10-12T06:00:00Z",
    daysLeft: state === "active" ? 40 : null,
    needsRenewal,
  });
  await page.route("**/api/meta", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), connections: [consent("a", "lapsed", true), consent("b", "active", false)] } });
  });
  await page.goto("/#/settings");
  const row = (name: string) => page.locator("#pankkiyhteydet tbody tr").filter({ hasText: name });
  await expect(row("Nordea").getByText("Pankin yhteys päättyi.")).toBeVisible();
  await expect(row("Nordea").getByRole("button", { name: "Yhdistä uudelleen" })).toBeVisible();
  await expect(row("OP").getByRole("button", { name: "Yhdistä uudelleen" })).toBeVisible();
  await expect(row("OP").getByText("Pankin yhteys päättyi.")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test.afterAll(async ({ browser }) => {
  const { context } = await admin(browser);
  await context.request.delete("/api/admin/bank-app", { headers: FETCH });
  await context.close();
});
