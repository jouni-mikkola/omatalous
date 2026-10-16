import { type Browser, expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeMember, removeMember, watch } from "./helpers.ts";

// Asetukset > Tiedot: "Vie kaikki tiedot" downloads one JSON file of what the signed-in user sees. The server has the
// administrator and the demo household already (e2e/run.mjs makes them).
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

let member: { state: string; id: string };
test.beforeAll(async ({ browser }) => {
  member = await makeMember(browser, "e2e-vienti");
});
test.afterAll(async ({ browser }) => removeMember(browser, member.id));

async function page(browser: Browser, state: string) {
  const context = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 800 } });
  const p = await context.newPage();
  return { context, page: p, seen: watch(p) };
}

/** Clicks the button of the Tiedot card and returns the file it downloads, as text. */
async function download(p: Awaited<ReturnType<typeof page>>["page"]): Promise<{ name: string; text: string }> {
  await p.goto("/#/settings");
  const card = p.locator(".card", { has: p.getByRole("heading", { level: 2, name: "Tiedot", exact: true }) });
  await expect(card.getByText("Tiedosto sisältää omat tietosi ja sinulle jaetut tiedot. Säilytä se turvallisesti.")).toBeVisible();
  const [file] = await Promise.all([p.waitForEvent("download"), card.getByRole("button", { name: "Vie kaikki tiedot" }).click()]);
  return { name: file.suggestedFilename(), text: await readFile(await file.path(), "utf8") };
}

test("the administrator downloads one file that parses, is version 1 and holds no secret", async ({ browser }) => {
  const { context, page: p, seen } = await page(browser, STATE);
  const { name, text } = await download(p);
  expect(name).toMatch(/^omatalous-\d{4}-\d{2}-\d{2}\.json$/);
  const file = JSON.parse(text);
  expect(file).toMatchObject({ format: "omatalous-export", version: 1 });
  expect(typeof file.appVersion).toBe("string");
  expect(Number.isNaN(Date.parse(file.exportedAt))).toBe(false);
  expect(file.users.length).toBeGreaterThan(0);
  expect(file.transactions.length).toBeGreaterThan(0);
  expect(text).not.toContain("password_hash");
  expect(text).not.toContain("pbkdf2");
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a member downloads their own file, with none of the administrator's rows, and an address opened as a link is refused", async ({ browser }) => {
  const { context, page: p, seen } = await page(browser, member.state);
  const { text } = await download(p);
  const file = JSON.parse(text);
  expect(file).toMatchObject({ format: "omatalous-export", version: 1 });
  expect(file.users).toEqual([expect.objectContaining({ id: member.id })]);
  expect(file.transactions).toEqual([]);
  expect(file.accounts).toEqual([]);
  expect(seen.problems).toEqual([]);
  // the file is a POST: opening the address as a link gives nothing
  expect((await context.request.get("/api/data/export")).status()).toBe(405);
  await context.close();
});
