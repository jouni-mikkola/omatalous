import { type Browser, type BrowserContext, type Page, expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// The bridge of a household that bought a car with credit, from made-up rows: pay 3 000, a credit of 20 000 drawn,
// a car for 11 800 and a loan payment of 1 200. The rows belong to a member of their own, so the demo household of
// the administrator that the other specs read stays as it is. The member is removed at the end, and one a broken run
// left behind is removed first, so the spec passes again against a server that was kept. Run alone, the spec creates
// the administrator itself.
const DIR = process.env.E2E_DIR ?? ".";
const STATE = join(DIR, "admin-state.json");
const MEMBER = join(DIR, "bridge-state.json");
const BASE = process.env.E2E_BASE_URL ?? "";
const MONTHS = ["tammikuu", "helmikuu", "maaliskuu", "huhtikuu", "toukokuu", "kesäkuu", "heinäkuu", "elokuu", "syyskuu", "lokakuu", "marraskuu", "joulukuu"];

const USERNAME = "e2e-autokauppa";
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
const day = (back: number, d: number) => `${month(back).year}/${String(month(back).month).padStart(2, "0")}/${String(d).padStart(2, "0")}`;

/** The rows, dated from the server's day. */
const csv = () =>
  [
    "Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viitenumero;Valuutta",
    `${day(1, 15)};-1200,00;;;RAHOITUS ESIMERKKI OY;KULUTUSLUOTTO LYHENNYS;;EUR`,
    `${day(1, 12)};-11800,00;;;AUTOTALO ESIMERKKI;AUTOKAUPPA;;EUR`,
    `${day(1, 10)};20000,00;;;RAHOITUS ESIMERKKI OY;LUOTON NOSTO;;EUR`,
    `${day(1, 3)};3000,00;;;ESIMERKKI OY;PALKKA;;EUR`,
    // a row before the month, so that the history covers the month from its first day
    `${day(2, 25)};-40,00;;;K-MARKET ESIMERKKI;;;EUR`,
  ].join("\n");

async function post(context: BrowserContext, path: string, data: object): Promise<Record<string, unknown>> {
  const r = await context.request.post(`${BASE}${path}`, { data, headers: FETCH });
  expect(r.ok(), `POST ${path} answered ${r.status()}`).toBe(true);
  return (await r.json()) as Record<string, unknown>;
}

/** A member with the rows above, signed in. */
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
  const { user, temporaryPassword } = (await post(admin, "/api/users", { username: USERNAME, displayName: "E2E Autokauppa", role: "member" })) as { user: { id: string }; temporaryPassword: string };
  memberId = user.id;
  await admin.close();
  const member = await browser.newContext();
  await post(member, "/api/auth/login", { username: USERNAME, password: temporaryPassword });
  await post(member, "/api/auth/password", { current: temporaryPassword, next: "e2e-autokauppa-123456" });
  today = ((await (await member.request.get(`${BASE}/api/meta`, { headers: FETCH })).json()) as { today: string }).today;
  expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await post(member, "/api/import/csv", { content: csv(), accountName: "Käyttötili", accountType: "checking" });
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

test("Viime kuu of a household that bought a car with credit: the gap is told as covered with credit, and Yli jäi is what stayed", async ({ browser }) => {
  const context = await browser.newContext({ storageState: MEMBER, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview?period=last-month");
  const bridge = page.locator(".bridge");
  await expect(bridge.getByRole("heading", { name: "Mihin tulot menivät" })).toBeVisible();

  // income, where it went, how the gap was covered, what stayed: in that order, without opening anything
  expect(await texts(page, ".bridge-legend > div")).toEqual([
    "Tulot 3 000 €",
    "Kulutus 11 800 € 393 % tuloista",
    "Velanhoito 1 200 € 40 % tuloista",
    "Säästöön 0 € 0 % tuloista",
    "Katettu luotolla 10 000 €",
    "Yli jäi 10 000 €",
  ]);
  expect(await texts(page, ".bridge-gap")).toEqual(["Menoihin meni 10 000 € enemmän kuin tuloja tuli. Ero katettiin luotolla."]);
  // the debt service stands under the word of its tile, and with debt paid nothing is said of where the credit is
  expect(await texts(page, ".bridge-drawn")).toEqual(["Luottoa nostettiin 20 000 €, velanhoitoon meni 1 200 €."]);
  // the page never says more was spent than earned and leaves it there, and the income is the pay alone
  await expect(page.getByText("Menoja", { exact: false }).filter({ hasText: "enemmän kuin tuloja" })).toHaveCount(0);

  // one axis: the strip of where the money came from is as wide as the bar, and the credit that paid for nothing
  // starts where Yli jäi starts
  const box = async (selector: string) => (await page.locator(selector).boundingBox())!;
  const [from, bar] = [await box(".bridge-from"), await box(".bridge-bar")];
  expect(Math.abs(from.x - bar.x) + Math.abs(from.width - bar.width)).toBeLessThan(1);
  const [rest, left] = [await box('.bridge-from .bridge-seg[title^="Luotosta jäi tilille"]'), await box('.bridge-bar .bridge-seg[title^="Yli jäi"]')];
  expect(Math.abs(rest.x - left.x)).toBeLessThan(1);
  expect(Math.abs(rest.width - left.width)).toBeLessThan(1);

  // the table is the same sum: what came in less what went out is Yli jäi
  await bridge.getByRole("button", { name: "Taulukko" }).click();
  const rows = await texts(page, ".bridge-table tbody tr");
  expect(rows).toEqual(["Tulot 3 000 € 100 %", "Luottoa nostettu 20 000 € –", "Kulutus 11 800 € 393 %", "Velanhoito 1 200 € 40 %", "Säästöön 0 € 0 %", "Yli jäi 10 000 € –"]);
  const [income, credit, spent, debt, saved, stayed] = rows.map(euros);
  expect(income! + credit! - spent! - debt! - saved!).toBe(stayed);
  await expect(page.locator(".bridge-gap")).toBeVisible();
  await expect(page.locator(".bridge-drawn")).toBeVisible();

  // Raportit prints the same Yli jäi for the month, with the credit in a column of its own
  await page.goto("/#/reports");
  const cashflow = page.locator("#kassavirta");
  await cashflow.locator(".card-head").first().getByRole("button", { name: "Taulukko" }).click();
  const last = month(1);
  const row = cashflow.locator("table:not(.bridge-table) tbody tr").filter({ hasText: `${MONTHS[last.month - 1]} ${last.year}` });
  expect(await cashflow.locator("table:not(.bridge-table) thead th").allInnerTexts()).toEqual(["Kuukausi", "Tulot", "Kulutus", "Velanhoito", "Säästöön", "Luotonnostot", "Yli jäi", "Säästöaste"]);
  expect((await row.locator("td").allInnerTexts()).map(plain).slice(1, 7)).toEqual(["3 000 €", "11 800 €", "1 200 €", "0 €", "20 000 €", "10 000 €"]);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("390 px: the bridge with its strip, sentence and credit line fits the phone", async ({ browser }) => {
  const context = await browser.newContext({ storageState: MEMBER, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview?period=last-month");
  await expect(page.locator(".bridge-from")).toBeVisible();
  await expect(page.locator(".bridge-gap")).toBeVisible();
  await expect(page.locator(".bridge-drawn")).toContainText("Luottoa nostettiin");
  expect(await overflow(page), "sideways scroll").toBeLessThanOrEqual(1);
  await page.locator(".bridge").getByRole("button", { name: "Taulukko" }).click();
  await expect(page.locator(".bridge-table")).toBeVisible();
  expect(await overflow(page), "sideways scroll with the table open").toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});
