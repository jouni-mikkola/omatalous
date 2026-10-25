import { type Browser, type BrowserContext, type Page, expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// The bridge of the demo household: the twelve months of Raportit, and the month before as Yhteenveto tells it. The demo spends
// from day to day, so the figures differ from one day to the next and the spec reads them from the page instead of
// naming them; a month that ran short of the pay shows the gap and its strip, and the spec follows what the page says.
// The rows are the demo data of a member made here, so the demo household of the administrator that the other specs
// read stays as it is. The member is removed at the end, and one a broken run left behind is removed first, so the
// spec passes again against a server that was kept. Run alone, the spec creates the administrator itself.
const DIR = process.env.E2E_DIR ?? ".";
const STATE = join(DIR, "admin-state.json");
const MEMBER = join(DIR, "bridge-state.json");
const BASE = process.env.E2E_BASE_URL ?? "";
const MONTHS = ["tammikuu", "helmikuu", "maaliskuu", "huhtikuu", "toukokuu", "kesäkuu", "heinäkuu", "elokuu", "syyskuu", "lokakuu", "marraskuu", "joulukuu"];

const USERNAME = "e2e-silta";
const FETCH = { "X-Requested-With": "fetch" };

/** The server's own day (/api/meta), read once the member is signed in: the months are counted from it. */
let today = "";
/** The member made here, removed in the end. */
let memberId = "";

/** The month `back` months before the server's. */
function month(back: number): { year: number; month: number } {
  const [y, m] = today.split("-").map(Number);
  const at = new Date(Date.UTC(y!, m! - 1 - back, 1));
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1 };
}

async function post(context: BrowserContext, path: string, data: object): Promise<Record<string, unknown>> {
  const r = await context.request.post(`${BASE}${path}`, { data, headers: FETCH });
  expect(r.ok(), `POST ${path} answered ${r.status()}`).toBe(true);
  return (await r.json()) as Record<string, unknown>;
}

/** A member with the demo household, signed in. */
async function household(browser: Browser): Promise<void> {
  if (!existsSync(STATE)) {
    const setup = await browser.newContext();
    await post(setup, "/api/auth/setup", { code: process.env.E2E_SETUP_CODE ?? "", username: "e2e-admin", displayName: "E2E Admin", password: "e2e-salasana-123456" });
    await post(setup, "/api/admin/instance/complete", {});
    await post(setup, "/api/demo", {});
    await setup.storageState({ path: STATE });
    await setup.close();
  }
  const admin = await browser.newContext({ storageState: STATE });
  // a member left by a run that broke before its end
  const { users } = (await (await admin.request.get(`${BASE}/api/users`, { headers: FETCH })).json()) as { users: { id: string; username: string }[] };
  for (const u of users.filter((x) => x.username === USERNAME)) await admin.request.delete(`${BASE}/api/users/${u.id}`, { headers: FETCH });
  const { user, temporaryPassword } = (await post(admin, "/api/users", { username: USERNAME, displayName: "E2E Silta", role: "member" })) as { user: { id: string }; temporaryPassword: string };
  memberId = user.id;
  await admin.close();
  const member = await browser.newContext();
  await post(member, "/api/auth/login", { username: USERNAME, password: temporaryPassword });
  await post(member, "/api/auth/password", { current: temporaryPassword, next: "e2e-silta-123456" });
  today = ((await (await member.request.get(`${BASE}/api/meta`, { headers: FETCH })).json()) as { today: string }).today;
  expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await post(member, "/api/demo", {});
  await member.storageState({ path: MEMBER });
  await member.close();
}

/** The member and its rows go, so the instance is as the spec found it. */
async function remove(browser: Browser): Promise<void> {
  if (!memberId) return;
  const admin = await browser.newContext({ storageState: STATE });
  const gone = await admin.request.delete(`${BASE}/api/users/${memberId}`, { headers: FETCH });
  expect(gone.ok(), `DELETE /api/users answered ${gone.status()}`).toBe(true);
  await admin.close();
}

/** Sums as a reader sees them: plain spaces and a plain minus. */
const plain = (s: string) => s.replace(/\s+/g, " ").replace(/−/g, "-").trim();
const euros = (s: string) => Number(/(-?[\d ]+) €/.exec(plain(s))![1]!.replace(/ /g, ""));
const texts = async (page: Page, selector: string) => (await page.locator(selector).allInnerTexts()).map(plain);

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => household(browser));
test.afterAll(async ({ browser }) => remove(browser));

test("The demo household: Yhteenveto tells the month before by its savings rate, the bridge of Raportit tells where the pay went, and the month's row there has the same rate", async ({ browser }) => {
  const context = await browser.newContext({ storageState: MEMBER, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  // Yhteenveto is a statement: one figure of the month before, and no bridge
  await page.goto("/#/overview");
  const monthBlock = page.getByRole("region", { name: "Tulot ja menot", exact: true });
  const rateRow = monthBlock.locator(".month-more .st-row", { hasText: "Säästöaste" });
  await expect(rateRow).toBeVisible();
  const rate = plain(await rateRow.locator(".st-num").innerText());
  await expect(monthBlock.locator(".bridge")).toHaveCount(0);
  await page.goto("/#/reports");
  const cashflow = page.locator("#kassavirta");
  await expect(cashflow.getByRole("heading", { name: /^Mihin tulot menivät/ })).toBeVisible();

  // where the money went, as one sentence of the period's figures (Raportit's bridge is the month table's period row):
  // every term it names, credit drawn included, adds up to Tulos (the parts are rounded together, so to the euro)
  const answer = plain(await cashflow.locator(".qc-a").first().innerText());
  const euros = (sentence: string) => [...sentence.matchAll(/(-?)(\d[\d ]*) €/g)].map((m) => (m[1] ? -1 : 1) * Number(m[2]!.replace(/ /g, "")));
  // what each sentence adds to Tulos: what came in plus, what went out minus, a refund or a return the other way
  const adds: [RegExp, number][] = [[/^Tuloja tuli/, 1], [/^Tuloja peruttiin/, -1], [/^Luottoa nostettiin/, 1], [/^Luottoa maksettiin takaisin/, -1], [/^Kulutukseen meni/, -1], [/^Kulutuksesta palautui/, 1], [/^Velanhoitoon meni/, -1], [/^Velanhoidosta palautui/, 1], [/^Säästöön meni/, -1], [/^Säästöistä otettiin/, 1]];
  let sum = 0;
  let stayed = 0;
  for (const sentence of answer.split(/(?<=\.) /)) {
    const first = euros(sentence)[0] ?? 0;
    if (sentence.startsWith("Tulos")) stayed = first;
    else {
      const sign = adds.find(([re]) => re.test(sentence))?.[1];
      if (!sign) throw new Error(`a sentence the test does not know: ${sentence}`);
      sum += sign * first;
    }
  }
  expect(answer).toMatch(/^Tuloja tuli .+ Kulutukseen meni .+ Tulos .+ €\.$/);
  expect(sum, answer).toBe(stayed);

  // the month table has the month before with the rate Yhteenveto told
  const last = month(1);
  const row = cashflow.locator("table.use-table tbody tr").filter({ hasText: `${MONTHS[last.month - 1]} ${last.year}` });
  const cells = (await row.locator("td").allInnerTexts()).map(plain);
  expect(cells[cells.length - 1], "the savings rate of the month is one figure on both pages").toBe(rate);
  // the panel's one switch shows every flow of the months as figures
  await cashflow.locator(".card-head").getByRole("button", { name: "Taulukko" }).click();
  expect(await cashflow.locator("table.rt").first().locator("thead th").allInnerTexts()).toEqual(["Kuukausi", "Tulot", "Kulutus", "Maksettu velanhoito", "Säästöön", "Tulos", "Säästöaste"]);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("390 px: the month before on Yhteenveto and the bridge of the year fit the phone", async ({ browser }) => {
  const context = await browser.newContext({ storageState: MEMBER, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview?period=last-month");
  await expect(page.getByRole("region", { name: "Tulot ja menot", exact: true }).locator(".wf")).toBeVisible();
  expect(await overflow(page), "sideways scroll").toBeLessThanOrEqual(1);

  await page.goto("/#/reports");
  await expect(page.locator("#kassavirta table.use-table")).toBeVisible();
  expect(await overflow(page), "sideways scroll with the month table").toBeLessThanOrEqual(1);
  await page.locator("#kassavirta .card-head").getByRole("button", { name: "Taulukko" }).click();
  await expect(page.locator("#kassavirta table.rt").first()).toBeVisible();
  expect(await overflow(page), "sideways scroll with the table open").toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});
