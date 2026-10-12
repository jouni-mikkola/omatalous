import { type Browser, type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// Asetukset > Lainat: a loan from pasted text, a picture or a PDF, confirmed field by field and saved. Every lender,
// figure and date here is made up. The pictures and the PDF are drawn by the test's own browser from made-up text.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };
const PASSWORD = "laina-testin-salasana-1";

test.describe.configure({ mode: "serial" });

/**
 * The administrator: signed in by e2e/run.mjs. On a server that has none one is set up here through the API, the first-run wizard is
 * closed, and the session is kept for the tests after the first.
 */
async function administrator(browser: Browser): Promise<BrowserContext> {
  if (existsSync(STATE)) return browser.newContext({ storageState: STATE, viewport: { width: 1366, height: 900 } });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const setup = await context.request.post("/api/auth/setup", { headers: FETCH, data: { code: process.env.E2E_SETUP_CODE, username: "laina-admin", displayName: "Laina", password: PASSWORD, confirm: PASSWORD } });
  expect(setup.status(), await setup.text()).toBe(200);
  expect((await context.request.post("/api/admin/instance/complete", { headers: FETCH })).status()).toBe(200);
  await context.storageState({ path: STATE });
  return context;
}

const today = async (context: BrowserContext): Promise<string> => (await (await context.request.get("/api/meta")).json()).today;

/** A made-up loan in the shape of the credit register's listing: owed on the first of this month, ends in twenty years. */
function listing(day: string): { text: string; balanceDate: string; end: string } {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const end = `${d}.${m}.${y + 20}`;
  const text = [
    "Esimerkkipankki Oyj",
    "Myönnetty määrä: 150 000,00 €",
    `Luoton saldo: 120 000,00 € (1.${m}.${y})`,
    "Kokonaiskorko: 3,39 %",
    "Viitekorko: 12 kk Euribor 2,74 %",
    "Marginaali: 0,65 %",
    "Lyhennystapa: Annuiteetti",
    "Lyhennysväli: 1 kk",
    "Kuukausierä: 689,20 €",
    `Viimeinen eräpäivä: ${end}`,
  ].join("\n");
  return { text, balanceDate: `${day.slice(0, 8)}01`, end };
}

/** A paste as the browser gives it to the page: text, or a file such as a copied screenshot. */
async function paste(target: Locator, data: { text?: string; file?: { name: string; type: string; bytes: Buffer } }): Promise<void> {
  await target.evaluate((el, d) => {
    const transfer = new DataTransfer();
    if (d.text !== undefined) transfer.setData("text/plain", d.text);
    if (d.file) transfer.items.add(new File([Uint8Array.from(atob(d.file.base64), (c) => c.charCodeAt(0))], d.file.name, { type: d.file.type }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, { text: data.text, file: data.file && { name: data.file.name, type: data.file.type, base64: data.file.bytes.toString("base64") } });
}

/** The first bytes of a PNG that says it is width x height pixels: enough for the app to judge the size, no picture to decode. */
const pngHeader = (width: number, height: number): Buffer => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};

/** The requests that left the app's own origin. Nothing the reader does may be one. */
const elsewhere = (requests: string[], origin: string) => requests.filter((url) => new URL(url).origin !== origin && !url.startsWith("blob:") && !url.startsWith("data:"));

/** A page of large, clear, made-up loan lines, for a screenshot or a PDF. */
async function paper(context: BrowserContext, lines: string[]): Promise<Page> {
  const page = await context.newPage();
  await page.setContent(`<main style="width:760px;padding:36px;background:#fff;color:#111;font:28px/1.8 Arial,Helvetica,sans-serif">${lines.map((l) => `<div>${l}</div>`).join("")}</main>`);
  return page;
}

const lainat = (page: Page) => page.locator("#lainat");
/** The message line of the card (Loans.tsx). The intake has a status line of its own, so the role alone is not enough. */
const said = (card: Locator, text: string) => expect(card.getByRole("status").filter({ hasText: text })).toHaveText(text);
/** The intake's status line: mounted all the time, and says what the reader is doing and what it found. */
const reader = (card: Locator) => card.locator(".loan-status");
const field = (scope: Locator, label: string) => scope.locator(".loan-field", { has: scope.page().getByLabel(label, { exact: true }) });
const loanWrites = (page: Page): string[] => {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && new URL(r.url()).pathname.startsWith("/api/loans")) seen.push(r.method());
  });
  return seen;
};

/** Removes every loan of the signed-in user, so each test starts from an empty list. */
async function clearLoans(context: BrowserContext): Promise<void> {
  const { loans } = await (await context.request.get("/api/loans")).json();
  for (const loan of loans) expect((await context.request.delete(`/api/loans/${loan.id}`, { headers: FETCH })).status()).toBe(200);
}

test("pasted text fills the form with each figure's source line, a field to check holds Tallenna back, and the saved loan is listed", async ({ browser }) => {
  const context = await administrator(browser);
  await clearLoans(context);
  const page = await context.newPage();
  const seen = watch(page);
  const writes = loanWrites(page);
  const loan = listing(await today(context));
  await page.goto("/#/settings");
  const card = lainat(page);
  await expect(card.getByText("Ei lainoja.")).toBeVisible();
  await expect(card.getByText("Kuvakaappaus positiivisesta luottotietorekisteristä tuo kaikki lainat kerralla.")).toBeVisible();

  // the keyboard reaches the box and its buttons
  const box = card.getByLabel("Liitä kuva tai teksti lainasta");
  await box.focus();
  await page.keyboard.press("Tab");
  await expect(card.getByRole("button", { name: "Valitse kuva tai PDF" })).toBeFocused();

  // the status line is there before anything is read, and empty
  await expect(reader(card)).toHaveCount(1);
  await expect(reader(card)).toHaveText("");
  await paste(box, { text: loan.text });
  const draft = card.getByRole("region", { name: "Luettu laina" });
  // a read ends with a sentence in the status line, and focus is on the first form's heading
  await expect(reader(card)).toHaveText("Löytyi 1 laina.");
  await expect(draft.getByRole("heading", { name: "Luettu laina" })).toBeFocused();
  await expect(draft.getByLabel("Lainaa jäljellä (€)")).toHaveValue("120 000,00");
  await expect(draft.getByLabel("Myönnetty määrä (€)")).toHaveValue("150 000,00");
  await expect(draft.getByLabel("Kokonaiskorko (%)")).toHaveValue("3,39");
  await expect(draft.getByLabel("Marginaali (%)")).toHaveValue("0,65");
  await expect(draft.getByLabel("Viitekorko", { exact: true })).toHaveValue("euribor_12");
  await expect(draft.getByLabel("Lyhennystapa", { exact: true })).toHaveValue("annuity");
  await expect(draft.getByLabel("Lyhennysväli", { exact: true })).toHaveValue("1");
  await expect(draft.getByLabel("Maksuerä (€)")).toHaveValue("689,20");
  await expect(draft.getByLabel("Jäljellä olevan summan päivä", { exact: true })).toHaveValue(loan.balanceDate);
  // each figure tells where it came from and how sure the reading is
  await expect(field(draft, "Kokonaiskorko (%)")).toContainText("Tekstissä: Kokonaiskorko: 3,39 %");
  await expect(field(draft, "Kokonaiskorko (%)").locator(".badge")).toHaveText("Varma");
  await expect(field(draft, "Lainanantaja").locator(".badge")).toHaveText("Tarkista");
  await expect(field(draft, "Luottoraja (€)").locator(".badge")).toHaveText("Ei löytynyt");
  await expect(field(draft, "Maksuerä (€)")).toContainText("Koko erä, korko mukana.");

  // no kind: nothing is sent
  await draft.getByRole("button", { name: "Tallenna" }).click();
  await expect(draft.getByRole("alert")).toHaveText("Korjaa merkityt kentät.");
  await expect(draft.getByText("Valitse laji.")).toBeVisible();
  // the reason is tied to its field, and focus is on the field
  await expect(draft.getByLabel("Laji")).toBeFocused();
  await expect(draft.getByLabel("Laji")).toHaveAccessibleDescription("Valitse laji.");
  await draft.getByLabel("Laji").selectOption("mortgage");
  // a mortgage has no credit limit
  await expect(draft.getByLabel("Luottoraja (€)")).toHaveCount(0);

  // two fields are to check: Tallenna names them, moves to the first and sends nothing
  await draft.getByRole("button", { name: "Tallenna" }).click();
  await expect(draft.getByRole("alert")).toContainText("Tarkista vielä: Lainanantaja, Jäljellä olevan summan päivä.");
  await expect(draft.getByLabel("Lainanantaja", { exact: true })).toBeFocused();
  expect(writes).toEqual([]);
  // one is ticked as right, the other is changed: both count
  await draft.getByLabel("Lainanantaja on oikein").check();
  await expect(field(draft, "Lainanantaja").locator(".badge")).toHaveText("Tarkistettu");
  await draft.getByLabel("Jäljellä olevan summan päivä", { exact: true }).fill(loan.balanceDate);
  await draft.getByRole("button", { name: "Tallenna" }).click();
  await expect(draft.getByRole("alert")).toContainText("Tarkista vielä: Jäljellä olevan summan päivä.");
  await draft.getByLabel("Jäljellä olevan summan päivä on oikein").check();
  await draft.getByRole("button", { name: "Tallenna" }).click();

  await said(card, "Asuntolaina, Esimerkkipankki Oyj tallennettu.");
  expect(writes).toEqual(["POST"]);
  await expect(draft).toHaveCount(0);
  await expect(box).toHaveValue("");
  // the form had the focus and is gone: the box has it, and the old sentence is gone
  await expect(box).toBeFocused();
  await expect(reader(card)).toHaveText("");
  const row = card.getByRole("row").filter({ hasText: "Asuntolaina, Esimerkkipankki Oyj" });
  for (const text of ["Esimerkkipankki Oyj", /120\s000,00\s€/, "3,39 %", /689,20\s€/, loan.end]) await expect(row).toContainText(text);

  // it is in the database, not only on the page
  await page.reload();
  await expect(lainat(page).getByRole("row").filter({ hasText: "Asuntolaina, Esimerkkipankki Oyj" })).toContainText(/120\s000,00\s€/);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a saved loan is edited in a dialog and removed after a question", async ({ browser }) => {
  const context = await administrator(browser);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/settings");
  const card = lainat(page);
  await card.getByRole("button", { name: "Muokkaa lainaa Asuntolaina, Esimerkkipankki Oyj" }).click();
  const dialog = page.getByRole("dialog", { name: "Muokkaa lainaa" });
  // a saved loan has no marks: the household confirmed it already
  await expect(dialog.locator(".badge")).toHaveCount(0);
  await expect(dialog.getByLabel("Nimi")).toHaveValue("Asuntolaina, Esimerkkipankki Oyj");
  await expect(dialog.getByLabel("Lainaa jäljellä (€)")).toHaveValue("120 000,00");
  await dialog.getByLabel("Nimi").fill("Kodin laina");
  await dialog.getByLabel("Lainaa jäljellä (€)").fill("119 500");
  // a payment under the interval's interest: told before saving, with the way out
  await dialog.getByLabel("Maksuerä (€)").fill("300");
  await expect(dialog.getByText(/Maksuerä on pienempi kuin lyhennysvälin korko \(337,59\s€\)/)).toBeVisible();
  await dialog.getByRole("button", { name: "Tallenna" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Maksuerä on pienempi kuin korko.");
  await dialog.getByRole("button", { name: "Tyhjennä maksuerä" }).click();
  await expect(dialog.getByLabel("Maksuerä (€)")).toHaveValue("");
  await dialog.getByRole("button", { name: "Tallenna" }).click();
  await expect(dialog).toHaveCount(0);
  await said(card, "Muutokset tallennettu.");
  const row = card.getByRole("row").filter({ hasText: "Kodin laina" });
  await expect(row).toContainText(/119\s500,00\s€/);
  // the fields the form did not touch went back as they were
  const { loans } = await (await context.request.get("/api/loans")).json();
  expect(loans).toHaveLength(1);
  expect(loans[0]).toMatchObject({ name: "Kodin laina", kind: "mortgage", lender: "Esimerkkipankki Oyj", balanceCents: 11_950_000, grantedCents: 15_000_000, rateBp: 339, reference: "euribor_12", marginBp: 65, repayment: "annuity", intervalMonths: 1, paymentCents: null, limitCents: null, seriesKey: null });

  await card.getByRole("button", { name: "Poista laina Kodin laina" }).click();
  const question = page.getByRole("dialog", { name: "Poistetaanko laina?" });
  await question.getByRole("button", { name: "Peruuta" }).click();
  await expect(row).toBeVisible();
  await card.getByRole("button", { name: "Poista laina Kodin laina" }).click();
  await question.getByRole("button", { name: "Poista" }).click();
  await said(card, "Laina poistettu.");
  await expect(card.getByText("Ei lainoja.")).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the day the rate is reviewed is typed in the form and kept, a fixed rate has no such field, and the form fits a phone", async ({ browser }) => {
  const context = await administrator(browser);
  await clearLoans(context);
  const page = await context.newPage();
  const seen = watch(page);
  const loans = async () => (await (await context.request.get("/api/loans")).json()).loans as { name: string; reference: string | null; rateReviewDate?: string | null }[];
  await page.goto("/#/settings");
  const card = lainat(page);
  await card.getByRole("button", { name: "Lisää käsin" }).click();
  const form = card.getByRole("region", { name: "Uusi laina" });
  await form.getByLabel("Laji").selectOption("mortgage");
  await form.getByLabel("Nimi").fill("Kotilaina");
  await form.getByLabel("Lainaa jäljellä (€)").fill("120 000");
  await form.getByLabel("Kokonaiskorko (%)").fill("3,39");
  await form.getByLabel("Marginaali (%)").fill("0,65");
  const day = form.getByLabel("Koron tarkistuspäivä", { exact: true });
  // no reference rate named yet: the field is there, with its hint, right after the margin
  await expect(day).toBeVisible();
  await expect(day).toHaveAttribute("type", "date");
  await expect(day).not.toHaveAttribute("required", "");
  await expect(field(form, "Koron tarkistuspäivä")).toContainText("Päivä, jona pankki seuraavan kerran tarkistaa viitekoron. Näkyy lainasopimuksessa ja verkkopankissa.");
  const labels = await form.locator("label.field-label").allInnerTexts();
  expect(labels.indexOf("Koron tarkistuspäivä")).toBe(labels.indexOf("Marginaali (%)") + 1);

  // a fixed rate has no review day, and what was typed comes back with the reference rate
  await form.getByLabel("Viitekorko", { exact: true }).selectOption("euribor_12");
  await day.fill("2027-03-14");
  await form.getByLabel("Viitekorko", { exact: true }).selectOption("fixed");
  await expect(day).toHaveCount(0);
  await expect(form.getByText("Päivä, jona pankki seuraavan kerran tarkistaa viitekoron.")).toHaveCount(0);
  await form.getByLabel("Viitekorko", { exact: true }).selectOption("euribor_12");
  await expect(day).toHaveValue("2027-03-14");
  await form.getByRole("button", { name: "Tallenna" }).click();
  await said(card, "Kotilaina tallennettu.");
  expect(await loans()).toMatchObject([{ name: "Kotilaina", reference: "euribor_12", rateReviewDate: "2027-03-14" }]);

  // the day is kept: it is in the editor after a reload
  await page.reload();
  await card.getByRole("button", { name: "Muokkaa lainaa Kotilaina" }).click();
  const dialog = page.getByRole("dialog", { name: "Muokkaa lainaa" });
  await expect(dialog.getByLabel("Koron tarkistuspäivä", { exact: true })).toHaveValue("2027-03-14");
  // on a phone neither the page nor the form scrolls sideways
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await expect(dialog.getByLabel("Koron tarkistuspäivä", { exact: true })).toBeVisible();

  // a fixed rate saves no day, whatever the editor held
  await dialog.getByLabel("Viitekorko", { exact: true }).selectOption("fixed");
  await expect(dialog.getByLabel("Koron tarkistuspäivä", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Tallenna" }).click();
  await said(card, "Muutokset tallennettu.");
  expect(await loans()).toMatchObject([{ name: "Kotilaina", reference: "fixed" }]);
  expect((await loans())[0]!.rateReviewDate ?? null).toBeNull();
  // and its editor has no field either
  await card.getByRole("button", { name: "Muokkaa lainaa Kotilaina" }).click();
  await expect(dialog.getByLabel("Koron tarkistuspäivä", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Peruuta" }).click();
  expect(seen.problems).toEqual([]);
  await clearLoans(context);
  await context.close();
});

test("a pasted picture is read in the browser from the app's own files, every field of it is to check, and it saves", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await administrator(browser);
  await clearLoans(context);
  const sheet = await paper(context, ["Mallirahoitus Oy", "Luoton saldo: 8 450,00 €", "Kokonaiskorko: 7,90 %", "Lyhennystapa: Annuiteetti", "Lyhennysväli: 1 kk", "Kuukausierä: 265,00 €"]);
  const png = await sheet.locator("main").screenshot();
  await sheet.close();

  const page = await context.newPage();
  const seen = watch(page);
  const writes = loanWrites(page);
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/#/settings");
  const card = lainat(page);
  await paste(card.getByLabel("Liitä kuva tai teksti lainasta"), { file: { name: "kuvakaappaus.png", type: "image/png", bytes: png } });
  await expect(card.getByRole("progressbar")).toBeVisible();
  await expect(reader(card)).toContainText(/Ladataan kuvanlukijaa|Luetaan kuvaa/);
  const draft = card.getByRole("region", { name: "Luettu laina" });
  await expect(draft.getByLabel("Lainaa jäljellä (€)")).toHaveValue("8 450,00", { timeout: 150_000 });
  await expect(card.getByRole("progressbar")).toHaveCount(0);
  await expect(reader(card)).toHaveText("Löytyi 1 laina.");
  await expect(draft.getByRole("heading", { name: "Luettu laina" })).toBeFocused();
  await expect(draft.getByLabel("Kokonaiskorko (%)")).toHaveValue("7,90");
  await expect(draft.getByLabel("Maksuerä (€)")).toHaveValue("265,00");
  await expect(draft.getByLabel("Lyhennystapa", { exact: true })).toHaveValue("annuity");
  // the reader and its language data came from this app, and nothing was fetched from anywhere else
  expect(elsewhere(requests, origin)).toEqual([]);
  for (const file of ["worker.min.js", "fin.traineddata.gz", "eng.traineddata.gz"]) expect(requests.some((url) => new RegExp(`/assets/ocr-[0-9a-f]{8}/${file}$`).test(url)), file).toBe(true);
  // the core with SIMD, named by the app: the build carries no relaxed-SIMD core for the browser to ask for
  expect(requests.some((url) => /\/assets\/ocr-[0-9a-f]{8}\/tesseract-core-simd-lstm\.wasm\.js$/.test(url))).toBe(true);
  expect(requests.filter((url) => /relaxedsimd/.test(url))).toEqual([]);

  // a comma lost by the reader leaves a well-formed number, so nothing read from a picture is taken as sure
  await expect(draft.locator(".badge", { hasText: "Varma" })).toHaveCount(0);
  await draft.getByLabel("Laji").selectOption("consumer");
  await draft.getByRole("button", { name: "Tallenna" }).click();
  await expect(draft.getByRole("alert")).toContainText("Tarkista vielä:");
  expect(writes).toEqual([]);
  for (const tick of await draft.getByRole("checkbox").all()) await tick.check();
  await draft.getByLabel("Nimi").fill("Remonttilaina");
  await draft.getByRole("button", { name: "Tallenna" }).click();
  await said(card, "Remonttilaina tallennettu.");
  await expect(card.getByRole("row").filter({ hasText: "Remonttilaina" })).toContainText(/8\s450,00\s€/);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a PDF's text is read, two loans in it become two forms, and a discarded one is not saved", async ({ browser }) => {
  const context = await administrator(browser);
  await clearLoans(context);
  const sheet = await paper(context, [
    "Esimerkkipankki Oyj", "Luoton saldo: 21 300,00 €", "Kokonaiskorko: 4,10 %", "",
    "Mallirahoitus Bank AB", "Luottoraja: 2 000,00 €", "Luoton saldo: 1 250,50 €", "Kokonaiskorko: 14,90 %",
  ]);
  const pdf = await sheet.pdf();
  await sheet.close();

  const page = await context.newPage();
  const seen = watch(page);
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/#/settings");
  const card = lainat(page);
  await card.getByLabel("Kuva tai PDF lainasta").setInputFiles({ name: "lainat.pdf", mimeType: "application/pdf", buffer: pdf });
  const first = card.getByRole("region", { name: "Laina 1" });
  const second = card.getByRole("region", { name: "Laina 2" });
  await expect(reader(card)).toHaveText("Löytyi 2 lainaa.");
  await expect(first.getByRole("heading", { name: "Laina 1" })).toBeFocused();
  await expect(first.getByLabel("Lainaa jäljellä (€)")).toHaveValue("21 300,00");
  await expect(second.getByLabel("Lainaa jäljellä (€)")).toHaveValue("1 250,50");
  await expect(second.getByLabel("Luottoraja (€)")).toHaveValue("2 000,00");
  // a text layer is read as printed: a labelled figure is sure
  await expect(field(first, "Lainaa jäljellä (€)").locator(".badge")).toHaveText("Varma");

  await first.getByRole("button", { name: "Hylkää" }).click();
  await expect(first).toHaveCount(0);
  // the form with the focus is gone: the next loan that was read has it
  await expect(second.getByRole("heading", { name: "Laina 2" })).toBeFocused();
  await second.getByLabel("Laji").selectOption("card");
  // a card has a limit and no repayment plan
  await expect(second.getByLabel("Lyhennystapa", { exact: true })).toHaveCount(0);
  await second.getByLabel("Lainanantaja on oikein").check();
  await second.getByRole("button", { name: "Tallenna" }).click();
  await said(card, "Luottokortti, Mallirahoitus Bank AB tallennettu.");
  await expect(card.getByLabel("Liitä kuva tai teksti lainasta")).toBeFocused();
  // pdf.js and its worker came from this app too
  expect(elsewhere(requests, origin)).toEqual([]);
  const { loans } = await (await context.request.get("/api/loans")).json();
  expect(loans.map((l: { name: string; kind: string; limitCents: number; balanceCents: number; rateBp: number }) => [l.name, l.kind, l.limitCents, l.balanceCents, l.rateBp])).toEqual([["Luottokortti, Mallirahoitus Bank AB", "card", 200_000, 125_050, 1490]]);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("typed text is read with Lue tiedot, a field's reason is tied to it, and a discarded form gives the focus to the box", async ({ browser }) => {
  const context = await administrator(browser);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/settings");
  const card = lainat(page);
  const box = card.getByLabel("Liitä kuva tai teksti lainasta");
  const read =card.getByRole("button", { name: "Lue tiedot" });
  await expect(read).toBeDisabled();
  await box.fill(listing(await today(context)).text);
  await read.click();
  const draft = card.getByRole("region", { name: "Luettu laina" });
  await expect(reader(card)).toHaveText("Löytyi 1 laina.");
  await expect(draft.getByRole("heading", { name: "Luettu laina" })).toBeFocused();
  await expect(draft.getByLabel("Kokonaiskorko (%)")).toHaveValue("3,39");

  // a rate that is no number: the reason is read with the field, and focus goes to the field
  await draft.getByLabel("Laji").selectOption("mortgage");
  const rate = draft.getByLabel("Kokonaiskorko (%)");
  await rate.fill("abc");
  await draft.getByRole("button", { name: "Tallenna" }).click();
  const reason = await field(draft, "Kokonaiskorko (%)").locator(".field-error").innerText();
  expect(reason).not.toBe("");
  await expect(rate).toHaveAttribute("aria-invalid", "true");
  await expect(rate).toHaveAccessibleDescription(new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await expect(rate).toBeFocused();

  await draft.getByRole("button", { name: "Hylkää" }).click();
  await expect(draft).toHaveCount(0);
  await expect(box).toBeFocused();
  await expect(reader(card)).toHaveText("");
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a file of the wrong type, one too large and one with too many pixels are refused with a sentence, before any reader is loaded", async ({ browser }) => {
  const context = await administrator(browser);
  const page = await context.newPage();
  const seen = watch(page);
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/#/settings");
  const card = lainat(page);
  const pick = card.getByLabel("Kuva tai PDF lainasta");
  const refused = (text: string) => expect(card.getByRole("alert")).toHaveText(text);
  await pick.setInputFiles({ name: "muistio.zip", mimeType: "application/zip", buffer: Buffer.from("PK") });
  await refused("Tiedosto ei ole kuva, PDF eikä teksti.");
  await pick.setInputFiles({ name: "iso.png", mimeType: "image/png", buffer: Buffer.alloc(26 * 1024 * 1024) });
  await refused("Tiedosto on liian suuri. Ota lainan tiedoista kuvakaappaus.");
  // 20 000 x 20 000 pixels would be 1.6 GB decoded: the header alone is enough to refuse it
  await pick.setInputFiles({ name: "valtava.png", mimeType: "image/png", buffer: pngHeader(20_000, 20_000) });
  await refused("Kuva on liian suuri, yli 40 miljoonaa pikseliä. Ota lainan tiedoista kuvakaappaus.");
  await pick.setInputFiles({ name: "teksti.png", mimeType: "image/png", buffer: Buffer.from("tämä ei ole kuva") });
  await refused("Kuvan muotoa ei tunnistettu. Ota lainan tiedoista kuvakaappaus (PNG tai JPEG).");
  await expect(card.getByRole("progressbar")).toHaveCount(0);
  await expect(card.getByRole("region")).toHaveCount(0);
  expect(requests.filter((url) => url.includes("/assets/ocr-"))).toEqual([]);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a clipboard that holds a picture and text is read as the text", async ({ browser }) => {
  const context = await administrator(browser);
  const page = await context.newPage();
  const seen = watch(page);
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/#/settings");
  const card = lainat(page);
  await paste(card.getByLabel("Liitä kuva tai teksti lainasta"), { text: listing(await today(context)).text, file: { name: "image.png", type: "image/png", bytes: pngHeader(800, 600) } });
  const draft = card.getByRole("region", { name: "Luettu laina" });
  await expect(draft.getByLabel("Lainaa jäljellä (€)")).toHaveValue("120 000,00");
  // exact text is sure; a picture would have made every field one to check
  await expect(field(draft, "Kokonaiskorko (%)").locator(".badge")).toHaveText("Varma");
  expect(requests.filter((url) => url.includes("/assets/ocr-"))).toEqual([]);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("text dropped on the box and text taken with Liitä leikepöydältä are read", async ({ browser }) => {
  const context = await administrator(browser);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/settings");
  await page.bringToFront();
  const card = lainat(page);
  const loan = listing(await today(context));
  // a drop, as the browser gives it to the page
  await card.getByLabel("Liitä kuva tai teksti lainasta").evaluate((el, text) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", text);
    el.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, loan.text);
  const draft = card.getByRole("region", { name: "Luettu laina" });
  await expect(draft.getByLabel("Lainaa jäljellä (€)")).toHaveValue("120 000,00");
  await expect(reader(card)).toHaveText("Löytyi 1 laina.");
  await draft.getByRole("button", { name: "Hylkää" }).click();
  await expect(draft).toHaveCount(0);

  // the button reads the real clipboard
  await page.evaluate((text) => navigator.clipboard.writeText(text), loan.text);
  await card.getByRole("button", { name: "Liitä leikepöydältä" }).click();
  await expect(draft.getByLabel("Lainaa jäljellä (€)")).toHaveValue("120 000,00");
  await expect(draft.getByRole("heading", { name: "Luettu laina" })).toBeFocused();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a new paste and Keskeytä end the read that is running, and the worker with it", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await administrator(browser);
  const sheet = await paper(context, ["Mallirahoitus Oy", "Luoton saldo: 8 450,00 €"]);
  const png = await sheet.locator("main").screenshot();
  await sheet.close();

  const page = await context.newPage();
  const seen = watch(page);
  // count the Workers the page starts and ends
  await page.addInitScript(() => {
    const made: Worker[] = [];
    const ended = new Set<Worker>();
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(...args: ConstructorParameters<typeof Native>) {
        super(...args);
        made.push(this);
      }
      override terminate() {
        ended.add(this);
        super.terminate();
      }
    };
    Object.assign(window, { __workers: { made, ended } });
  });
  const workers = () =>
    page.evaluate(() => {
      const { made, ended } = (window as unknown as { __workers: { made: Worker[]; ended: Set<Worker> } }).__workers;
      return { made: made.length, ended: ended.size };
    });
  await page.goto("/#/settings");
  const card = lainat(page);
  const box = card.getByLabel("Liitä kuva tai teksti lainasta");
  const picture = { name: "kuvakaappaus.png", type: "image/png", bytes: png };

  // Keskeytä ends the read, says so, and leaves the focus in the box
  await paste(box, { file: picture });
  await expect.poll(async () => (await workers()).made).toBe(1);
  await card.getByRole("button", { name: "Keskeytä" }).click();
  await expect(reader(card)).toHaveText("Lukeminen keskeytettiin.");
  await expect(card.getByRole("progressbar")).toHaveCount(0);
  await expect(box).toBeFocused();
  await expect.poll(async () => (await workers()).ended).toBe(1);

  // a text pasted while a picture is read replaces it
  await paste(box, { file: picture });
  await expect.poll(async () => (await workers()).made).toBe(2);
  await paste(box, { text: listing(await today(context)).text });
  await expect(reader(card)).toHaveText("Löytyi 1 laina.");
  await expect(card.getByRole("progressbar")).toHaveCount(0);
  await expect.poll(async () => (await workers()).ended).toBe(2);
  await expect(card.getByRole("region", { name: "Luettu laina" }).getByLabel("Lainaa jäljellä (€)")).toHaveValue("120 000,00");
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the build carries the licences of the software that reads a picture or a PDF", async ({ browser }) => {
  const context = await administrator(browser);
  const response = await context.request.get("/THIRD-PARTY-LICENSES.txt");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/plain");
  const text = await response.text();
  for (const name of ["pdfjs-dist", "tesseract.js", "tesseract.js-core", "@tesseract.js-data/fin", "@tesseract.js-data/eng", "wasm-feature-detect", "idb-keyval", "bmp-js", "zlibjs", "is-url", "regenerator-runtime", "Leptonica"]) expect(text, name).toContain(name);
  expect(text).toContain("Apache License");
  expect(text).toContain("Permission is hereby granted");
  await context.close();
});

test("a member sees and changes only their own loans, and the page fits a phone", async ({ browser }) => {
  const admin = await administrator(browser);
  const created = await admin.request.post("/api/users", { headers: FETCH, data: { username: "lainaaja", displayName: "Lainaaja" } });
  expect(created.ok(), await created.text()).toBe(true);
  const { user, temporaryPassword } = await created.json();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    expect((await context.request.post("/api/auth/login", { headers: FETCH, data: { username: "lainaaja", password: temporaryPassword } })).status()).toBe(200);
    expect((await context.request.post("/api/auth/password", { headers: FETCH, data: { current: temporaryPassword, next: PASSWORD } })).status()).toBe(200);
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/settings");
    const card = lainat(page);
    // the administrator's card of the last test is not the member's
    await expect(card.getByText("Ei lainoja.")).toBeVisible();
    await expect(card.getByText("Mallirahoitus")).toHaveCount(0);

    // a loan typed in by hand, on a phone
    await card.getByRole("button", { name: "Lisää käsin" }).click();
    const form = card.getByRole("region", { name: "Uusi laina" });
    await form.getByLabel("Laji").selectOption("car");
    await form.getByLabel("Nimi").fill("Auton laina");
    await form.getByLabel("Lainaa jäljellä (€)").fill("9 800,50");
    await form.getByLabel("Kokonaiskorko (%)").fill("5,25");
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await form.getByRole("button", { name: "Tallenna" }).click();
    await said(card, "Auton laina tallennettu.");
    await expect(card.getByRole("row").filter({ hasText: "Auton laina" })).toContainText(/9\s800,50\s€/);
    // the phone shows the rate under the name
    await expect(card.getByRole("row").filter({ hasText: "Auton laina" }).locator(".loan-phone")).toContainText("5,25 %");
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    // a read loan with its marks and source lines fits too
    await paste(card.getByLabel("Liitä kuva tai teksti lainasta"), { text: listing(await today(context)).text });
    await expect(card.getByRole("region", { name: "Luettu laina" }).getByLabel("Lainaa jäljellä (€)")).toHaveValue("120 000,00");
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    // the administrator's list has the card and not the member's car loan
    const adminPage = await admin.newPage();
    await adminPage.goto("/#/settings");
    await expect(lainat(adminPage).getByRole("row").filter({ hasText: "Luottokortti, Mallirahoitus Bank AB" })).toBeVisible();
    await expect(lainat(adminPage).getByText("Auton laina")).toHaveCount(0);
    expect(seen.problems).toEqual([]);
  } finally {
    await context.close();
    await admin.request.delete(`/api/users/${user.id}`, { headers: FETCH });
    await clearLoans(admin);
    await admin.close();
  }
});

// A saved card loan and the demo household's card are one debt: the household says so once. Both tests need the demo
// household that e2e/run.mjs loads (its card "Nordea Gold (esimerkki)"), so they skip on a server without it.
const demoCard = async (context: BrowserContext) => ((await (await context.request.get("/api/meta")).json()).accounts as { id: string; name: string; type: string }[]).find((a) => a.type === "credit_card");
const cardLoan = (name: string, day: string) => ({ name, kind: "card", lender: "ESIMERKKIRAHOITUS OY", grantedCents: null, balanceCents: 100_000, balanceDate: day, rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: 300_000, seriesKey: null });
/** The debt total of the Lainat report in whole euros. */
const owed = async (section: Locator) => Number((await section.locator(".kv > div").filter({ hasText: "Velkaa yhteensä" }).locator(".v").innerText()).replace(/\D/g, ""));

test("the Lainat report offers to link a saved card to the card account, and the saved link takes the sentence and the typed balance out of the total", async ({ browser }) => {
  const context = await administrator(browser);
  const account = await demoCard(context);
  test.skip(!account, "needs the demo household");
  await clearLoans(context);
  const day = await today(context);
  const made = await context.request.post("/api/loans", { headers: FETCH, data: cardLoan("Esimerkkikortti", `${day.slice(0, 8)}01`) });
  expect(made.status(), await made.text()).toBe(200);
  const page = await context.newPage();
  const seen = watch(page);

  // both are in the total: the report names the pair and ends the sentence with the link
  await page.goto("/#/reports#lainat");
  const report = page.locator("#lainat");
  const sentence = report.locator("li.warn").filter({ hasText: "Sama velka voi olla summassa kahdesti" });
  await expect(sentence).toContainText("tallennettu laina Esimerkkikortti ja yhdistetty tili Nordea Gold (esimerkki)");
  const before = await owed(report);
  await sentence.getByRole("link", { name: "Liitä Esimerkkikortti tiliin Nordea Gold (esimerkki)" }).click();

  // the editor of that loan opens with the account chosen, and the address no longer holds the request
  const dialog = page.getByRole("dialog", { name: "Muokkaa lainaa" });
  await expect(dialog.getByLabel("Nimi")).toHaveValue("Esimerkkikortti");
  await expect(dialog.getByLabel("Sama velka pankin tilillä")).toHaveValue(account!.id);
  await expect(dialog.getByText("Velkana käytetään pankin saldoa aina, kun pankki ilmoittaa sen.")).toBeVisible();
  await expect(page).toHaveURL(/#\/settings#lainat$/);
  await dialog.getByRole("button", { name: "Tallenna" }).click();
  await expect(dialog).toHaveCount(0);
  const card = lainat(page);
  await said(card, "Muutokset tallennettu.");
  // the row says which account it is linked to
  await expect(card.getByRole("row").filter({ hasText: "Esimerkkikortti" })).toContainText("Liitetty tiliin Nordea Gold (esimerkki)");

  // back at the report, with no reload by hand: the sentence is gone and the total fell by the typed balance
  await page.goBack();
  await expect(report.getByText("Esimerkkikortti").first()).toBeVisible();
  await expect(report.locator("li.warn").filter({ hasText: "Sama velka voi olla summassa kahdesti" })).toHaveCount(0);
  expect(before - (await owed(report))).toBe(1000);

  expect(seen.problems).toEqual([]);
  await clearLoans(context);
  await context.close();
});

test("a refusal of the server stands in the form where its other errors are, and an account another loan holds is not offered", async ({ browser }) => {
  const context = await administrator(browser);
  const account = await demoCard(context);
  test.skip(!account, "needs the demo household");
  await clearLoans(context);
  const day = `${(await today(context)).slice(0, 8)}01`;
  for (const name of ["Esimerkkikortti A", "Esimerkkikortti B"]) expect((await context.request.post("/api/loans", { headers: FETCH, data: cardLoan(name, day) })).status()).toBe(200);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/settings");
  const card = lainat(page);
  await card.getByRole("button", { name: "Muokkaa lainaa Esimerkkikortti B" }).click();
  const dialog = page.getByRole("dialog", { name: "Muokkaa lainaa" });
  await dialog.getByLabel("Sama velka pankin tilillä").selectOption(account!.id);

  // meanwhile the card is linked to the other loan: the form still offers it, and the server says no
  const { loans } = await (await context.request.get("/api/loans")).json();
  const { id, ...other } = loans.find((l: { name: string }) => l.name === "Esimerkkikortti A");
  expect((await context.request.put(`/api/loans/${id}`, { headers: FETCH, data: { ...other, accountId: account!.id } })).status()).toBe(200);
  await dialog.getByRole("button", { name: "Tallenna" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Tähän tiliin on jo liitetty laina Esimerkkikortti A. Poista liitos siitä ensin.");
  await expect(dialog).toBeVisible();

  // with the list read again, the form does not offer the card the other loan holds, and the select is not there at all
  await dialog.getByRole("button", { name: "Peruuta" }).click();
  await page.reload();
  await card.getByRole("button", { name: "Muokkaa lainaa Esimerkkikortti B" }).click();
  await expect(page.getByRole("dialog", { name: "Muokkaa lainaa" }).getByLabel("Sama velka pankin tilillä")).toHaveCount(0);
  // the refusal is the one 400 of the page
  expect(seen.problems.filter((p) => !/HTTP 400: PUT .*\/api\/loans\//.test(p) && !/Failed to load resource.*400/.test(p))).toEqual([]);
  await clearLoans(context);
  await context.close();
});
