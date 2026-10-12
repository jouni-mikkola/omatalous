import { type Browser, type BrowserContext, type Page, expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// The bridge of the demo household: last month on the overview and the twelve months of Raportit. The demo spends
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

test("Viime kuu of the demo household: the bridge tells where the pay went, and Raportit prints the same figures for the month", async ({ browser }) => {
  const context = await browser.newContext({ storageState: MEMBER, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview?period=last-month");
  const bridge = page.locator(".bridge");
  await expect(bridge.getByRole("heading", { name: "Mihin tulot menivät" })).toBeVisible();

  // income, where it went, then what stayed, or for a month that ran short of the pay how the gap was covered (from the
  // accounts or a card: the demo has no loan drawn): in that order, without opening anything
  const legend = await texts(page, ".bridge-legend > div");
  const labels = legend.map((l) => l.replace(/ -?\d[\d ]* €.*$/, ""));
  const short = (await page.locator(".bridge-gap").count()) > 0;
  expect(labels).toEqual(["Tulot", "Kulutus", "Velanhoito", "Säästöön", short ? "Tileiltä tai kortilta" : "Yli jäi"]);
  expect(legend[1]).toMatch(/ \d+ % tuloista$/);
  await expect(page.locator(".bridge-from")).toHaveCount(short ? 1 : 0);
  await expect(page.locator(".bridge-drawn")).toHaveCount(0);
  if (short) {
    await expect(page.locator(".bridge-gap")).toContainText("enemmän kuin tuloja tuli");
    // one axis: the strip of where the money came from is as wide as the bar
    const box = async (selector: string) => (await page.locator(selector).boundingBox())!;
    const [from, bar] = [await box(".bridge-from"), await box(".bridge-bar")];
    expect(Math.abs(from.x - bar.x) + Math.abs(from.width - bar.width)).toBeLessThan(1);
  } else {
    await expect(page.getByText("enemmän kuin tuloja tuli")).toHaveCount(0);
  }
  const [income, spent, debt, saved] = legend.slice(0, 4).map(euros);

  // the table is the same sum: what came in less what went out is Yli jäi, up to the euro each figure is rounded to
  await bridge.getByRole("button", { name: "Taulukko" }).click();
  const rows = await texts(page, ".bridge-table tbody tr");
  expect(rows.map((r) => r.replace(/ -?\d[\d ]* €.*$/, ""))).toEqual(["Tulot", "Kulutus", "Velanhoito", "Säästöön", "Yli jäi"]);
  const stayed = euros(rows[4]!);
  expect(rows.slice(0, 4).map(euros)).toEqual([income, spent, debt, saved]);
  expect(Math.abs(income! - spent! - debt! - saved! - stayed)).toBeLessThanOrEqual(3);
  expect(stayed < 0, "Yli jäi is below zero when the month ran short").toBe(short);

  // Raportit prints the same figures for the month; the column of credit drawn is there only when some month drew
  await page.goto("/#/reports");
  const cashflow = page.locator("#kassavirta");
  await cashflow.locator(".card-head").first().getByRole("button", { name: "Taulukko" }).click();
  const last = month(1);
  const row = cashflow.locator("table:not(.bridge-table) tbody tr").filter({ hasText: `${MONTHS[last.month - 1]} ${last.year}` });
  expect(await cashflow.locator("table:not(.bridge-table) thead th").allInnerTexts()).toEqual(["Kuukausi", "Tulot", "Kulutus", "Velanhoito", "Säästöön", "Yli jäi", "Säästöaste"]);
  const cells = (await row.locator("td").allInnerTexts()).map(plain);
  expect(cells.slice(1, 6).map(euros)).toEqual([income, spent, debt, saved, stayed]);

  // the twelve months in the bridge under it: the same parts, and no credit drawn
  const year = cashflow.locator(".bridge");
  await expect(year.getByRole("heading", { name: "Mihin tulot menivät" })).toBeVisible();
  const yearLabels = (await texts(page, "#kassavirta .bridge-legend > div")).map((l) => l.replace(/ -?\d[\d ]* €.*$/, ""));
  expect(yearLabels.slice(0, 4)).toEqual(["Tulot", "Kulutus", "Velanhoito", "Säästöön"]);
  await expect(year.locator(".bridge-drawn")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("390 px: the bridge of last month and the one of the year fit the phone", async ({ browser }) => {
  const context = await browser.newContext({ storageState: MEMBER, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview?period=last-month");
  await expect(page.locator(".bridge-legend")).toBeVisible();
  expect(await overflow(page), "sideways scroll").toBeLessThanOrEqual(1);
  await page.locator(".bridge").getByRole("button", { name: "Taulukko" }).click();
  await expect(page.locator(".bridge-table")).toBeVisible();
  expect(await overflow(page), "sideways scroll with the table open").toBeLessThanOrEqual(1);

  await page.goto("/#/reports");
  await expect(page.locator("#kassavirta .bridge-legend")).toBeVisible();
  expect(await overflow(page), "sideways scroll with the bridge of the year").toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});
