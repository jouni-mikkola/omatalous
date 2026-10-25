import { type Browser, expect, test } from "@playwright/test";
import { join } from "node:path";
import { makeMember, removeMember, watch } from "./helpers.ts";

// Asetukset > Tiedot > "Tuo tiedot": the file of "Vie kaikki tiedot" comes back in, checked first. The administrator's
// demo household is the data; a fresh member imports the same file under their own name.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };

test.describe.configure({ mode: "serial" });

let member: { state: string; id: string };
let file: string;
let raw: string;
test.beforeAll(async ({ browser }) => {
  member = await makeMember(browser, "e2e-tuonti");
  const admin = await browser.newContext({ storageState: STATE });
  const res = await admin.request.post("/api/data/export", { headers: FETCH });
  expect(res.ok()).toBe(true);
  const parsed = (await res.json()) as { transactions: { owner_username: string }[] };
  const adminName = parsed.transactions[0]!.owner_username;
  // the same data shape under the member's name: a row is the importer's own when its owner is the importer
  raw = await res.text();
  file = raw.split(`"${adminName}"`).join(`"e2e-tuonti"`);
  await admin.close();
  expect(JSON.parse(file).transactions.length).toBeGreaterThan(0);
});
test.afterAll(async ({ browser }) => removeMember(browser, member.id));

async function open(browser: Browser, width = 1280) {
  const context = await browser.newContext({ storageState: member.state, viewport: { width, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/settings");
  const card = page.locator(".card", { has: page.getByRole("heading", { level: 2, name: "Tiedot", exact: true }) });
  return { context, page, seen, card };
}

const pick = (card: ReturnType<Awaited<ReturnType<typeof open>>["page"]["locator"]>, text: string) =>
  card.locator("input[type=file]").setInputFiles({ name: "omatalous.json", mimeType: "application/json", buffer: Buffer.from(text) });

async function exported(context: Awaited<ReturnType<typeof open>>["context"]): Promise<{ transactions: unknown[] }> {
  return (await (await context.request.post("/api/data/export", { headers: FETCH })).json()) as { transactions: unknown[] };
}

test("a broken file shows the server's sentence and ends there", async ({ browser }) => {
  const { context, card, seen } = await open(browser);
  await pick(card, JSON.stringify({ format: "omatalous-export", version: 2, appVersion: "0.1.0", exportedAt: "2026-10-09T10:00:00.000Z" }));
  await expect(card.locator(".error")).toContainText("Tiedoston versiota ei voi tuoda.");
  await expect(card.getByRole("button", { name: "Tuo", exact: true })).toHaveCount(0);
  await pick(card, "tämä ei ole json");
  await expect(card.locator(".error")).toHaveText("Tiedosto ei ole Omatalouden tietotiedosto.");
  const bad = JSON.parse(file) as { transactions: Record<string, unknown>[] };
  bad.transactions[0]!.amount_cents = 1.5;
  await pick(card, JSON.stringify(bad));
  await expect(card.locator(".error")).toContainText("Mitään ei tuotu.");
  await expect(card.getByRole("button", { name: "Tuo", exact: true })).toHaveCount(0);
  expect((await exported(context)).transactions).toEqual([]);
  expect(seen.problems.filter((p) => !p.includes("400"))).toEqual([]);
  await context.close();
});

test("the administrator's file is refused for a member, in one sentence", async ({ browser }) => {
  const { context, card } = await open(browser);
  await pick(card, raw);
  await expect(card.locator(".error")).toHaveText("Tiedosto on toisen käyttäjän. Tuo vain omat tietosi.");
  await expect(card.getByRole("button", { name: "Tuo", exact: true })).toHaveCount(0);
  expect((await exported(context)).transactions).toEqual([]);
  await context.close();
});

test("Peruuta leaves nothing behind", async ({ browser }) => {
  const { context, card } = await open(browser);
  await pick(card, file);
  await expect(card.getByRole("button", { name: "Tuo", exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Peruuta" }).click();
  await expect(card.getByRole("button", { name: "Tuo", exact: true })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Tuo tiedot" })).toBeEnabled();
  expect((await exported(context)).transactions).toEqual([]);
  await context.close();
});

test("the dry run counts, Tuo commits it, and a second dry run finds everything there", async ({ browser }) => {
  const { context, page, card, seen } = await open(browser);
  const row = (name: string) => card.locator(".data-import-plan > div", { has: page.locator("dt", { hasText: new RegExp(`^${name}$`) }) });
  await pick(card, file);
  await expect(row("Tapahtumat")).toContainText(/lisätään [1-9]\d*, jo olemassa 0, ohitetaan 0/);
  await expect(row("Tilit")).toContainText("lisätään");
  await expect(row("Käyttäjät")).toContainText("ei tuoda");
  // a picture only when asked for: a run without SHOTS_DIR must leave the tree clean
  if (process.env.SHOTS_DIR) await card.screenshot({ path: join(process.env.SHOTS_DIR, "lead-dry-run-1280.png") });
  await card.getByRole("button", { name: "Tuo", exact: true }).click();
  await expect(card.getByRole("status")).toContainText("Tiedot tuotu");
  await expect(card.getByRole("status")).toContainText(/lisätty [1-9]\d*, jo olemassa \d+, ohitettu \d+/);
  expect((await exported(context)).transactions.length).toBeGreaterThan(0);
  await pick(card, file);
  // a demo account of the file is another user's here (no identity): only rows matching by bank signature are found again
  await expect(row("Tapahtumat")).toContainText(/jo olemassa [1-9]\d*/);
  await card.getByRole("button", { name: "Peruuta" }).click();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the dry run fits a phone", async ({ browser }) => {
  const { context, page, card } = await open(browser, 390);
  await pick(card, file);
  await expect(card.getByRole("button", { name: "Tuo", exact: true })).toBeVisible();
  // a picture only when asked for: a run without SHOTS_DIR must leave the tree clean
  if (process.env.SHOTS_DIR) await card.screenshot({ path: join(process.env.SHOTS_DIR, "lead-dry-run-390.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await card.getByRole("button", { name: "Peruuta" }).click();
  await context.close();
});

test("the administrator's own file finds everything there and changes nothing", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/settings");
  const card = page.locator(".card", { has: page.getByRole("heading", { level: 2, name: "Tiedot", exact: true }) });
  const own = await (await context.request.post("/api/data/export", { headers: FETCH })).text();
  await pick(card, own);
  const rows = card.locator(".data-import-plan > div", { has: page.locator("dt", { hasText: /^Tapahtumat$/ }) });
  await expect(rows).toContainText(/lisätään 0, jo olemassa [1-9]\d*, ohitetaan 0/);
  await expect(card.locator(".data-import-plan > div", { has: page.locator("dt", { hasText: /^Yhteensä$/ }) })).toContainText("lisätään 0");
  await card.getByRole("button", { name: "Peruuta" }).click();
  expect(seen.problems).toEqual([]);
  await context.close();
});
