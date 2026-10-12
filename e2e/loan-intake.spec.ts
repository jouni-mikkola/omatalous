import { type Browser, type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";
import { lockedPdf, scannedPdf, textPdf } from "./pdf-fixtures.ts";

// Asetukset > Lainat, the three ways of reading a loan that go wrong in a household's hands: a PDF that is only a
// picture, a PDF under a password, and the edit dialog of a saved loan on a phone. The PDFs are made by pdf-fixtures.ts
// from bytes, and every lender and figure here is made up. The loans this spec saves are removed again, so the specs
// after it find the loans list as the administrator left it.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };
const PASSWORD = "laina-lukijan-salasana-1";
/** Set by a run that wants pictures of the page: SHOTS_DIR=/tmp/loan-intake-shots pnpm e2e e2e/loan-intake.spec.ts */
const SHOTS = process.env.SHOTS_DIR;

test.describe.configure({ mode: "serial" });

const DESKTOP = { width: 1366, height: 900 };
const PHONE = { width: 390, height: 844 };

/** The administrator, as loans.spec.ts has it: signed in by app.spec.ts in a whole run, set up here through the API when this spec runs alone. */
async function administrator(browser: Browser, viewport = DESKTOP): Promise<BrowserContext> {
  const locale = { locale: "fi-FI", timezoneId: "Europe/Helsinki" };
  if (existsSync(STATE)) return browser.newContext({ storageState: STATE, viewport, ...locale });
  const context = await browser.newContext({ viewport, ...locale });
  const setup = await context.request.post("/api/auth/setup", { headers: FETCH, data: { code: process.env.E2E_SETUP_CODE, username: "lukija-admin", displayName: "Lukija", password: PASSWORD, confirm: PASSWORD } });
  expect(setup.status(), await setup.text()).toBe(200);
  expect((await context.request.post("/api/admin/instance/complete", { headers: FETCH })).status()).toBe(200);
  await context.storageState({ path: STATE });
  return context;
}

/** What a statement of one made-up loan says: a label and its figure in two columns, as a bank sets them. */
const STATEMENT = ["Esimerkkipankki Oyj", "Luoton saldo\t21 300,00 €", "Kokonaiskorko\t4,10 %"];

const lainat = (page: Page) => page.locator("#lainat");
/** The intake's status line: mounted all the time, and says what the reader is doing and what it found. */
const reader = (card: Locator) => card.locator(".loan-status");
/** The message line of the card (Loans.tsx). The intake has a status line of its own, so the role alone is not enough. */
const said = (card: Locator, text: string) => expect(card.getByRole("status").filter({ hasText: text })).toHaveText(text);

/** Nothing is being read any more: no bar, no Keskeytä, no status line, and the box takes the next file or text. */
async function readEnded(card: Locator): Promise<void> {
  await expect(card.getByRole("progressbar")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Keskeytä" })).toHaveCount(0);
  await expect(reader(card)).toHaveText("");
}

test("a PDF that is only a picture is told so, shows no form and no spinner, and the box reads the next file", async ({ browser }) => {
  const context = await administrator(browser);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/settings");
  const card = lainat(page);
  await card.getByLabel("Kuva tai PDF lainasta").setInputFiles({ name: "skannaus.pdf", mimeType: "application/pdf", buffer: scannedPdf() });

  // the page says what it found, and does not present an empty form as a read loan
  await expect(card.getByRole("alert")).toHaveText("PDF-tiedostossa on pelkkä kuva. Ota siitä kuvakaappaus ja liitä se.");
  await readEnded(card);
  await expect(card.getByRole("region")).toHaveCount(0);
  await expect(card.getByLabel("Liitä kuva tai teksti lainasta")).toHaveValue("");
  await expect(card.getByRole("button", { name: "Lue tiedot" })).toBeDisabled();

  // the way out the page keeps: the loan typed in by hand. Its form is not marked as read.
  await card.getByRole("button", { name: "Lisää käsin" }).click();
  const byHand = card.getByRole("region", { name: "Uusi laina" });
  await expect(byHand.getByLabel("Lainaa jäljellä (€)")).toHaveValue("");
  await expect(byHand.locator(".badge")).toHaveCount(0);
  await expect(byHand.getByText(/^Tekstissä:/)).toHaveCount(0);

  // the reader is not stuck: the next file is read, and the sentence and the empty form give way to it
  await card.getByLabel("Kuva tai PDF lainasta").setInputFiles({ name: "saldo.pdf", mimeType: "application/pdf", buffer: textPdf(STATEMENT) });
  await expect(reader(card)).toHaveText("Löytyi 1 laina.");
  await expect(card.getByRole("alert")).toHaveCount(0);
  await expect(card.getByRole("region", { name: "Uusi laina" })).toHaveCount(0);
  const read = card.getByRole("region", { name: "Luettu laina" });
  await expect(read.getByLabel("Lainaa jäljellä (€)")).toHaveValue("21 300,00");
  await expect(read.getByLabel("Lainanantaja", { exact: true })).toHaveValue("Esimerkkipankki Oyj");
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a PDF under a password is told to be protected, whatever was on the page before is gone, and pasted text is read after it", async ({ browser }) => {
  const context = await administrator(browser);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/settings");
  const card = lainat(page);
  const pick = card.getByLabel("Kuva tai PDF lainasta");

  // the same statement without a password reads: the fixture is a PDF, and the password is what differs
  await pick.setInputFiles({ name: "saldo.pdf", mimeType: "application/pdf", buffer: textPdf(STATEMENT) });
  await expect(reader(card)).toHaveText("Löytyi 1 laina.");
  await expect(card.getByRole("region", { name: "Luettu laina" }).getByLabel("Lainaa jäljellä (€)")).toHaveValue("21 300,00");

  await pick.setInputFiles({ name: "saldo-suojattu.pdf", mimeType: "application/pdf", buffer: lockedPdf(STATEMENT, "esimerkki-salasana") });
  await expect(card.getByRole("alert")).toHaveText("PDF on suojattu salasanalla. Liitä lainasta kuvakaappaus tai teksti.");
  await readEnded(card);
  // the loan of the file before is not left on the page beside the sentence about this one
  await expect(card.getByRole("region")).toHaveCount(0);

  // what the sentence asks for works: the text of the loan, pasted into the box
  const box = card.getByLabel("Liitä kuva tai teksti lainasta");
  await box.fill(STATEMENT.join("\n"));
  await card.getByRole("button", { name: "Lue tiedot" }).click();
  await expect(reader(card)).toHaveText("Löytyi 1 laina.");
  await expect(card.getByRole("alert")).toHaveCount(0);
  await expect(card.getByRole("region", { name: "Luettu laina" }).getByLabel("Lainaa jäljellä (€)")).toHaveValue("21 300,00");
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the edit dialog of a saved loan on a phone reaches every field, scrolls inside itself and not sideways, and saves", async ({ browser }) => {
  const context = await administrator(browser, PHONE);
  const { today } = await (await context.request.get("/api/meta")).json();
  const [year, month] = today.split("-").map(Number) as [number, number];
  const created = await context.request.post("/api/loans", {
    headers: FETCH,
    data: {
      name: "Esimerkkilaina puhelimella",
      lender: "Esimerkkipankki Oyj",
      kind: "mortgage",
      grantedCents: 15_000_000,
      balanceCents: 12_000_000,
      balanceDate: `${today.slice(0, 8)}01`,
      rateBp: 339,
      reference: "euribor_12",
      marginBp: 65,
      repayment: "annuity",
      intervalMonths: 1,
      paymentCents: 68_920,
      endDate: `${year + 20}-${String(month).padStart(2, "0")}-15`,
      limitCents: null,
      seriesKey: null,
    },
  });
  expect(created.status(), await created.text()).toBe(200);
  const id: string = (await created.json()).loan.id;
  try {
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/settings");
    const card = lainat(page);
    await card.getByRole("button", { name: "Muokkaa lainaa Esimerkkilaina puhelimella" }).click();
    const dialog = page.getByRole("dialog", { name: "Muokkaa lainaa" });
    await expect(dialog).toBeVisible();

    // the dialog is inside the phone, and it is the dialog that scrolls: the form is taller than the screen
    const frame = (await dialog.boundingBox())!;
    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.x + frame.width).toBeLessThanOrEqual(PHONE.width);
    expect(frame.y + frame.height).toBeLessThanOrEqual(PHONE.height);
    expect(await dialog.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
    const sideways = () => dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(await sideways()).toBeLessThanOrEqual(1);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    // so the viewport check below measures something: the last field is below the fold until the dialog is scrolled
    await expect(dialog.getByLabel("Viimeinen eräpäivä", { exact: true })).not.toBeInViewport();
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "pt1-edit-dialog-390-top.png") });

    // every field of a mortgage, in the order the form has them, is fully on the screen once scrolled to, inside the phone's width, and nothing covers it
    const labels = ["Nimi", "Laji", "Lainanantaja", "Lainaa jäljellä (€)", "Jäljellä olevan summan päivä", "Myönnetty määrä (€)", "Kokonaiskorko (%)", "Viitekorko", "Marginaali (%)", "Lyhennystapa", "Lyhennysväli", "Maksuerä (€)", "Viimeinen eräpäivä"];
    for (const label of labels) {
      const control = dialog.getByLabel(label, { exact: true });
      await control.scrollIntoViewIfNeeded();
      await expect(control, label).toBeInViewport({ ratio: 1 });
      await control.click({ trial: true });
      const box = (await control.boundingBox())!;
      expect(box.x, label).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, label).toBeLessThanOrEqual(PHONE.width);
    }
    // a card's limit is not a mortgage's field
    await expect(dialog.getByLabel("Luottoraja (€)", { exact: true })).toHaveCount(0);
    // both buttons are at the end of the form and can be pressed
    for (const name of ["Tallenna", "Peruuta"]) {
      const button = dialog.getByRole("button", { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      await expect(button, name).toBeInViewport({ ratio: 1 });
      await button.click({ trial: true });
    }
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "pt1-edit-dialog-390-bottom.png") });

    // the longest sentence of the form, a payment under the interval's interest, with the way out, fits the dialog
    await dialog.getByLabel("Maksuerä (€)", { exact: true }).fill("300");
    const notice = dialog.locator(".loan-interest");
    await expect(notice).toContainText("Maksuerä on pienempi kuin lyhennysvälin korko");
    await notice.scrollIntoViewIfNeeded();
    const warned = (await notice.boundingBox())!;
    expect(warned.x).toBeGreaterThanOrEqual(0);
    expect(warned.x + warned.width).toBeLessThanOrEqual(PHONE.width);
    await expect(notice.getByRole("button", { name: "Tyhjennä maksuerä" })).toBeInViewport({ ratio: 1 });
    await dialog.getByRole("button", { name: "Tallenna", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Maksuerä on pienempi kuin korko.");
    expect(await sideways()).toBeLessThanOrEqual(1);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, "pt1-edit-dialog-390-warning.png") });
    await notice.getByRole("button", { name: "Tyhjennä maksuerä" }).click();
    await expect(dialog.getByLabel("Maksuerä (€)", { exact: true })).toHaveValue("");

    // a changed name and balance are saved, and the fields the form did not touch go back as they were
    await dialog.getByLabel("Nimi", { exact: true }).fill("Esimerkkilaina muutettu");
    await dialog.getByLabel("Lainaa jäljellä (€)", { exact: true }).fill("119 500");
    await dialog.getByRole("button", { name: "Tallenna", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await said(card, "Muutokset tallennettu.");
    const row = card.getByRole("row").filter({ hasText: "Esimerkkilaina muutettu" });
    await expect(row).toContainText(/119\s500,00\s€/);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    const { loans } = await (await context.request.get("/api/loans")).json();
    expect(loans.find((l: { id: string }) => l.id === id)).toMatchObject({ name: "Esimerkkilaina muutettu", kind: "mortgage", lender: "Esimerkkipankki Oyj", balanceCents: 11_950_000, grantedCents: 15_000_000, rateBp: 339, reference: "euribor_12", marginBp: 65, repayment: "annuity", intervalMonths: 1, paymentCents: null });
    expect(seen.problems).toEqual([]);
  } finally {
    await context.request.delete(`/api/loans/${id}`, { headers: FETCH });
    await context.close();
  }
});
