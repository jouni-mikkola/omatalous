import { type Browser, type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// Asetukset > Lainat: the box of a new loan reads a picture in the browser. The picture is drawn here, by the test's own
// browser, from lines of made-up text in a plain layout of the test's own: no bank's page. The loans this spec saves
// are removed again.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };
const PASSWORD = "laina-testin-salasana-1";
/** The most the first reading may take on a busy machine: the reader's files are fetched and the language data parsed. */
const READING_MS = 240_000;

test.describe.configure({ mode: "serial", timeout: READING_MS + 60_000 });

/** The administrator, as loan-paste-pdf.spec.ts has it: signed in by e2e/run.mjs, set up here only on a server that has none. */
async function administrator(browser: Browser): Promise<BrowserContext> {
  if (existsSync(STATE)) return browser.newContext({ storageState: STATE, viewport: { width: 1366, height: 900 } });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const setup = await context.request.post("/api/auth/setup", { headers: FETCH, data: { code: process.env.E2E_SETUP_CODE, username: "laina-admin", displayName: "Laina", password: PASSWORD, confirm: PASSWORD } });
  expect(setup.status(), await setup.text()).toBe(200);
  expect((await context.request.post("/api/admin/instance/complete", { headers: FETCH })).status()).toBe(200);
  await context.storageState({ path: STATE });
  return context;
}

const loansOf = async (context: BrowserContext) => (await (await context.request.get("/api/loans", { maxRetries: 1 })).json()).loans as Record<string, unknown>[];

/** The lines a made-up loan view lists, one to a line, as a plain page prints them. */
const VIEW = ["Esimerkkipankki Oyj", "Myönnetty määrä: 150 000,00 €", "Luoton saldo: 120 000,00 € (30.9.2026)", "Kokonaiskorko: 3,39 %", "Lyhennystapa: Annuiteetti", "Lyhennysväli: 1 kk", "Kuukausierä: 689,20 €", "Viimeinen eräpäivä: 31.10.2046"];

/** A PNG of black text on white, large and at device scale 2, which is what a phone's screenshot of a page is like. */
async function draw(browser: Browser, lines: string[]): Promise<Buffer> {
  const context = await browser.newContext({ viewport: { width: 900, height: 120 + lines.length * 56 }, deviceScaleFactor: 2 });
  try {
    const page = await context.newPage();
    await page.setContent("<body></body>");
    await page.evaluate((text) => {
      document.body.style.cssText = "margin:0;padding:24px 32px;background:#fff;color:#000;font:34px/56px sans-serif";
      for (const line of text) {
        const row = document.createElement("div");
        row.textContent = line;
        document.body.append(row);
      }
    }, lines);
    return await page.screenshot();
  } finally {
    await context.close();
  }
}

async function openNewLoan(page: Page): Promise<Locator> {
  await page.goto("/#/settings/household");
  const card = page.locator("#lainat");
  await card.getByRole("button", { name: "Lisää laina" }).click();
  const form = card.getByRole("region", { name: "Uusi laina" });
  await expect(form.getByLabel("Lainan tiedot")).toBeVisible();
  return form;
}

/** A PNG header that says 20 000 x 20 000 pixels, from a file of a few bytes: decoded it would take 1.6 GB. */
const HUGE = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]), Buffer.from([0, 0, 0x4e, 0x20, 0, 0, 0x4e, 0x20, 8, 6, 0, 0, 0])]);

test("a picture is read in the browser, marks every field it read to check, and is sent nowhere", async ({ browser }) => {
  const context = await administrator(browser);
  for (const loan of await loansOf(context)) expect((await context.request.delete(`/api/loans/${loan.id}`, { headers: FETCH, maxRetries: 1 })).status()).toBe(200);
  const png = await draw(browser, VIEW);
  const page = await context.newPage();
  const seen = watch(page);
  const requests: string[] = [];
  const writes: string[] = [];
  const bodies: Buffer[] = [];
  page.on("request", (r) => {
    requests.push(new URL(r.url()).pathname);
    if (r.method() !== "GET") {
      writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
      const body = r.postDataBuffer();
      if (body) bodies.push(body);
    }
  });
  const form = await openNewLoan(page);
  // the first page and the box carry no part of the reader
  expect(requests.filter((path) => /\/assets\/ocr-/.test(path))).toEqual([]);

  await form.getByLabel("Valitse kuva tai PDF").setInputFiles({ name: "kuvakaappaus.png", mimeType: "image/png", buffer: png });
  await expect(form.getByLabel("Lainaa jäljellä (€)")).toHaveValue("120 000,00", { timeout: READING_MS });
  await expect(form.getByLabel("Kuukausierä (€)")).toHaveValue("689,20");
  await expect(form.getByLabel("Lainan määrä (€)")).toHaveValue("150 000,00");

  // each field the picture gave is marked to check, with the Tarkista badge, and none is shown as sure
  for (const label of ["Lainaa jäljellä (€)", "Kuukausierä (€)", "Lainan määrä (€)"]) {
    const field = form.locator(".loan-field").filter({ has: page.getByLabel(label, { exact: true }) });
    await expect(field, label).toHaveClass(/to-check/);
    await expect(field.getByText("Tarkista", { exact: true }), label).toBeVisible();
  }
  await expect(form.getByText("Varma")).toHaveCount(0);
  // nothing is saved before the household confirms
  await form.getByLabel("Laji").selectOption("mortgage");
  await form.getByRole("button", { name: "Tallenna" }).click();
  await expect(form.getByRole("alert")).toContainText("Tarkista vielä:");
  expect(await loansOf(context)).toHaveLength(0);

  // the reader came from the app's own address, from one folder of hashed files
  const folders = new Set(requests.map((path) => /^\/assets\/(ocr-[0-9a-f]{8})\//.exec(path)?.[1]).filter(Boolean));
  expect(folders.size).toBe(1);
  expect(requests.some((path) => /\/worker\.min\.js$/.test(path))).toBe(true);
  expect(requests.some((path) => /\/fin\.traineddata\.gz$/.test(path))).toBe(true);
  // the picture itself went nowhere: no request but the app's own housekeeping writes, and none of them holds the file
  expect(writes.filter((w) => w !== "POST /api/sync/open")).toEqual([]);
  expect(bodies.filter((body) => body.includes(png.subarray(0, 64)) || body.length >= png.length)).toEqual([]);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a picture with no loan in it, and a picture too large to open, are told so and leave the form to type in", async ({ browser }) => {
  const context = await administrator(browser);
  const png = await draw(browser, ["Hyvää päivää", "Tässä on kuva ilman mitään lainaa", "Kiitos käynnistä"]);
  const page = await context.newPage();
  const seen = watch(page);
  const form = await openNewLoan(page);
  const pick = form.getByLabel("Valitse kuva tai PDF");

  await pick.setInputFiles({ name: "tyhja.png", mimeType: "image/png", buffer: png });
  await expect(form.getByRole("alert")).toHaveText("Emme löytäneet kuvasta lainan tietoja. Kokeile tarkempaa kuvaa tai liitä lainan tiedot tekstinä.", { timeout: READING_MS });
  await pick.setInputFiles({ name: "valtava.png", mimeType: "image/png", buffer: HUGE });
  await expect(form.getByRole("alert")).toHaveText("Kuva on liian suuri, yli 40 miljoonaa pikseliä. Ota lainan tiedoista kuvakaappaus.");
  await expect(form.getByLabel("Lainaa jäljellä (€)")).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});
