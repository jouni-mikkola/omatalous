import { type Browser, type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { watch } from "./helpers.ts";
import { lockedPdf, scannedPdf, textPdf } from "./pdf-fixtures.ts";

// Asetukset > Lainat: the box of a new loan that reads pasted text or a PDF. The PDFs are made by pdf-fixtures.ts from
// bytes, and every lender and figure here is made up. The loans this spec saves are removed again.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };
const PASSWORD = "laina-testin-salasana-1";
const RESEND = { maxRetries: 1 };

test.describe.configure({ mode: "serial" });

/** The administrator, as loans.spec.ts has it: signed in by e2e/run.mjs, set up here through the API only on a server that has none. */
async function administrator(browser: Browser): Promise<BrowserContext> {
  if (existsSync(STATE)) return browser.newContext({ storageState: STATE, viewport: { width: 1366, height: 900 } });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const setup = await context.request.post("/api/auth/setup", { headers: FETCH, data: { code: process.env.E2E_SETUP_CODE, username: "laina-admin", displayName: "Laina", password: PASSWORD, confirm: PASSWORD } });
  expect(setup.status(), await setup.text()).toBe(200);
  expect((await context.request.post("/api/admin/instance/complete", { headers: FETCH })).status()).toBe(200);
  await context.storageState({ path: STATE });
  return context;
}

const loansOf = async (context: BrowserContext) => (await (await context.request.get("/api/loans", RESEND)).json()).loans as Record<string, unknown>[];

async function clearLoans(context: BrowserContext): Promise<void> {
  for (const loan of await loansOf(context)) expect((await context.request.delete(`/api/loans/${loan.id}`, { headers: FETCH, ...RESEND })).status()).toBe(200);
}

const lainat = (page: Page) => page.locator("#lainat");
const said = (card: Locator, text: string) => expect(card.getByRole("status").filter({ hasText: text })).toHaveText(text);

async function openNewLoan(page: Page): Promise<Locator> {
  await page.goto("/#/settings/household");
  const card = lainat(page);
  await card.getByRole("button", { name: "Lisää laina" }).click();
  const form = card.getByRole("region", { name: "Uusi laina" });
  await expect(form.getByLabel("Lainan tiedot")).toBeVisible();
  return form;
}

/** One made-up loan as a register or a bank page lists it. */
const ONE = ["Esimerkkipankki Oyj", "Myönnetty määrä: 150 000,00 €", "Luoton saldo: 120 000,00 € (30.9.2026)", "Kokonaiskorko: 3,39 %", "Lyhennystapa: Annuiteetti", "Lyhennysväli: 1 kk", "Kuukausierä: 689,20 €", "Viimeinen eräpäivä: 31.10.2046"];
/** A second loan of another lender: a credit line. */
const SECOND = ["Mallirahoitus Bank AB", "Luottoraja\t2 000,00 €", "Luoton saldo\t1 250,50 €", "Kokonaiskorko\t14,9 %"];
/** The same loan as a statement sets it: a label and its figure in two columns. */
const STATEMENT = ONE.map((line) => line.replace(": ", "\t"));

/** A paste of text into the box: the event a browser sends, with the text on its clipboard. */
async function pasteText(box: Locator, text: string): Promise<void> {
  await box.evaluate((el, plain) => {
    const data = new DataTransfer();
    data.setData("text/plain", plain);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

test("pasted text fills the form, marks what it read, holds the save until the fields to check are confirmed, and saves the read payment", async ({ browser }) => {
  const context = await administrator(browser);
  await clearLoans(context);
  const page = await context.newPage();
  const seen = watch(page);
  const form = await openNewLoan(page);
  await expect(form.getByRole("button", { name: "Lue tiedot" })).toBeDisabled();

  await pasteText(form.getByLabel("Lainan tiedot"), ONE.join("\n"));
  await expect(form.getByLabel("Lainaa jäljellä (€)")).toHaveValue("120 000,00");
  await expect(form.getByLabel("Maksuerä (€)")).toHaveValue("689,20");
  await expect(form.getByLabel("Myönnetty määrä (€)")).toHaveValue("150 000,00");
  await expect(form.getByLabel("Lainanantaja", { exact: true })).toHaveValue("Esimerkkipankki Oyj");
  // a field to check shows the line it came from; a value read with confidence carries no badge and no line; a field the text does not give is empty and says so
  await expect(form.getByText("Tekstissä: Esimerkkipankki Oyj")).toBeVisible();
  await expect(form.getByText("Tekstissä: Kuukausierä: 689,20 €")).toHaveCount(0);
  await expect(form.getByLabel("Marginaali (%)")).toHaveValue("");
  await expect(form.getByText("Ei löytynyt").first()).toBeVisible();
  await expect(form.getByText("Varma")).toHaveCount(0);
  await expect(form.getByText("Tarkista", { exact: true }).first()).toBeVisible();

  // the lender and the balance day are to check: nothing is sent before the household says they are right
  await form.getByLabel("Laji").selectOption("mortgage");
  await form.getByRole("button", { name: "Tallenna" }).click();
  await expect(form.getByRole("alert")).toContainText("Tarkista vielä:");
  expect(await loansOf(context)).toHaveLength(0);
  for (const box of await form.getByRole("checkbox").all()) await box.check();
  await form.getByRole("button", { name: "Tallenna" }).click();
  await said(lainat(page), "Asuntolaina, Esimerkkipankki Oyj tallennettu.");

  const [loan] = await loansOf(context);
  expect(loan).toMatchObject({ kind: "mortgage", lender: "Esimerkkipankki Oyj", grantedCents: 15_000_000, balanceCents: 12_000_000, balanceDate: "2026-09-30", rateBp: 339, repayment: "annuity", paymentCents: 68_920, endDate: "2046-10-31" });
  await clearLoans(context);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a PDF is read in the browser into the same form, and a PDF with a password or only a picture is told so", async ({ browser }) => {
  const context = await administrator(browser);
  await clearLoans(context);
  const page = await context.newPage();
  const seen = watch(page);
  const requests: string[] = [];
  const writes: string[] = [];
  page.on("request", (r) => {
    requests.push(new URL(r.url()).pathname);
    if (r.method() !== "GET") writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  const form = await openNewLoan(page);
  const pick = form.getByLabel("Valitse kuva tai PDF");

  await pick.setInputFiles({ name: "lainat.pdf", mimeType: "application/pdf", buffer: textPdf(STATEMENT) });
  await expect(form.getByLabel("Lainaa jäljellä (€)")).toHaveValue("120 000,00");
  await expect(form.getByLabel("Maksuerä (€)")).toHaveValue("689,20");
  await expect(form.getByLabel("Lyhennystapa", { exact: true })).toHaveValue("annuity");
  await expect(form.getByLabel("Lainanantaja", { exact: true })).toHaveValue("Esimerkkipankki Oyj");
  // the reader and its worker came from the app's own address, and the file itself went nowhere
  expect(requests.some((path) => /\/assets\/pdf\.worker\.min-[\w-]+\.mjs$/.test(path))).toBe(true);
  expect(writes.filter((w) => w !== "POST /api/sync/open")).toEqual([]);

  await pick.setInputFiles({ name: "salattu.pdf", mimeType: "application/pdf", buffer: lockedPdf(STATEMENT, "esimerkki-salasana") });
  await expect(form.getByRole("alert")).toHaveText("PDF-tiedosto on salasanalla suojattu. Avaa se ensin ja liitä sen teksti tähän.");
  await pick.setInputFiles({ name: "skannaus.pdf", mimeType: "application/pdf", buffer: scannedPdf() });
  await expect(form.getByRole("alert")).toHaveText("PDF-tiedostossa on pelkkä kuva. Kopioi sen teksti ja liitä se tähän.");
  // a file that is neither a picture, a PDF nor text
  await pick.setInputFiles({ name: "laina.zip", mimeType: "application/zip", buffer: Buffer.from("PK") });
  await expect(form.getByRole("alert")).toHaveText("Tiedosto ei ole kuva, PDF eikä teksti. Liitä lainan tiedot tekstinä.");
  // the form is still there to type in
  await expect(form.getByLabel("Lainaa jäljellä (€)")).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a text of several loans goes to a table, each loan is matched to a saved one or new, and one Tallenna saves them all", async ({ browser }) => {
  const context = await administrator(browser);
  await clearLoans(context);
  const created = await context.request.post("/api/loans", {
    headers: FETCH,
    data: { name: "Kodin laina", kind: "mortgage", lender: "Esimerkkipankki Oyj", grantedCents: 15_000_000, balanceCents: 11_000_000, balanceDate: "2026-08-31", rateBp: 300, reference: null, marginBp: null, rateReviewDate: null, repayment: "annuity", intervalMonths: 1, paymentCents: 60_000, endDate: "2046-10-31", limitCents: null, seriesKey: null, accountId: null },
  });
  expect(created.status(), await created.text()).toBe(200);
  const savedId = (await loansOf(context))[0]!.id as string;
  const page = await context.newPage();
  const seen = watch(page);
  const form = await openNewLoan(page);
  await form.getByLabel("Valitse kuva tai PDF").setInputFiles({ name: "lainat.pdf", mimeType: "application/pdf", buffer: textPdf([...STATEMENT, "", ...SECOND]) });

  const table = page.getByRole("table", { name: "Luetut lainat" });
  await expect(table.getByRole("row")).toHaveCount(3);
  // the loan of the same lender and amount is the saved one; the other is new
  await expect(table.getByLabel("Tallenna lainaksi, Esimerkkipankki Oyj")).toHaveValue(savedId);
  await expect(table.getByLabel("Tallenna lainaksi, Mallirahoitus Bank AB")).toHaveValue("");
  // nothing is saved while a loan has a field to check
  await page.getByRole("button", { name: "Tallenna 2 lainaa" }).click();
  await expect(page.getByRole("alert")).toHaveText("Tarkista jokainen merkitty laina ennen tallennusta.");
  expect((await loansOf(context))[0]).toMatchObject({ balanceCents: 11_000_000 });

  for (const [name, kind] of [["Esimerkkipankki Oyj", null], ["Mallirahoitus Bank AB", "credit_line"]] as const) {
    await page.getByRole("button", { name: `Tarkista laina ${name}` }).click();
    const dialog = page.getByRole("dialog");
    if (kind) await dialog.getByLabel("Laji").selectOption(kind);
    for (const box of await dialog.getByRole("checkbox").all()) await box.check();
    await dialog.getByRole("button", { name: "Valmis" }).click();
    await expect(dialog).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Tallenna 2 lainaa" }).click();
  await said(lainat(page), "Tallensimme 2 lainaa.");

  const loans = await loansOf(context);
  expect(loans).toHaveLength(2);
  // the saved loan keeps its name and takes the text's figures; the credit line is new
  expect(loans.find((l) => l.id === savedId)).toMatchObject({ name: "Kodin laina", balanceCents: 12_000_000, rateBp: 339, paymentCents: 68_920 });
  expect(loans.find((l) => l.id !== savedId)).toMatchObject({ kind: "credit_line", lender: "Mallirahoitus Bank AB", limitCents: 200_000, balanceCents: 125_050, rateBp: 1490 });
  await clearLoans(context);
  expect(seen.problems).toEqual([]);
  await context.close();
});
