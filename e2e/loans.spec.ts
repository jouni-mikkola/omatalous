import { type Browser, type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// Raportit > Varat ja velat, where the loans are kept: a loan typed into the form of Lisää laina in the head of Saldot,
// saved, edited in its row of Lainat and removed. Every lender, figure and date here is made up.
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

/** The days of a made-up loan: owed on the first of this month, ends in twenty years. */
function typed(day: string): { balanceDate: string; endDate: string } {
  return { balanceDate: `${day.slice(0, 8)}01`, endDate: `${Number(day.slice(0, 4)) + 20}${day.slice(4)}` };
}

/** The same day a year later; the days used here are firsts of a month, which every month has. */
const nextYear = (day: string): string => `${Number(day.slice(0, 4)) + 1}${day.slice(4)}`;

/**
 * The rate the server stores for a 12 month euribor whose last review day is `on`: the demo's fixing of that day or the
 * one before it and the margin, in hundredths of a percent, a half up. A fixing under zero counts as zero.
 */
function rateOn(fixings: Record<string, [string, number][]>, on: string, marginBp: number): number {
  const fixing = (fixings.euribor_12 ?? []).filter(([from]) => from <= on).at(-1);
  expect(fixing, "the made-up fixings of the demo reach the day").toBeDefined();
  return Math.round((Math.max(0, fixing![1]) + marginBp * 10) / 10);
}

/** A rate as the page writes it, "2,96 %", any space before the sign. */
const percentText = (bp: number): string => `${Math.floor(bp / 100)},${String(bp % 100).padStart(2, "0")}\\s%`;

const HOME = "/#/reports?q=saldot";
const saldot = (page: Page) => page.locator("#saldot");
const lainat = (page: Page) => page.locator("#lainat");
/** The line under the head of Saldot that tells what a change of a loan did (More.tsx). */
const said = (page: Page, text: string) => expect(saldot(page).getByRole("status").filter({ hasText: text })).toHaveText(text);
/** A loan's row in Lainat. */
const rowOf = (page: Page, name: string) => lainat(page).getByRole("row").filter({ hasText: name });
/** No saved loan of that name: Lainat has no row of it. */
const noRow = (page: Page, name: string) => expect(rowOf(page, name)).toHaveCount(0);
/** Opens the drill of a saved loan's row, where Muokkaa and Poista laina are; a drill the address keeps open stays open. */
async function openLoan(page: Page, name: string): Promise<void> {
  const button = lainat(page).getByRole("button", { name, exact: true });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
}
/** Opens a saved loan's editor from its row in Lainat. */
async function editLoan(page: Page, name: string): Promise<Locator> {
  await openLoan(page, name);
  await lainat(page).getByRole("button", { name: `Muokkaa lainaa ${name}` }).click();
  return page.getByRole("dialog", { name: "Muokkaa lainaa" });
}
/** The figures of a saved loan as its editor holds them: the row of Lainat shows the report's figures, not the typed ones. */
async function expectSaved(page: Page, name: string, fields: Record<string, string>): Promise<void> {
  const dialog = await editLoan(page, name);
  for (const [label, value] of Object.entries(fields)) await expect(dialog.getByLabel(label, { exact: true })).toHaveValue(value);
  await dialog.getByRole("button", { name: "Peruuta" }).click();
  await expect(dialog).toHaveCount(0);
}
const loanWrites = (page: Page): string[] => {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && new URL(r.url()).pathname.startsWith("/api/loans")) seen.push(r.method());
  });
  return seen;
};

// A request of the test's own (context.request) after seconds of clicking reuses a kept-alive connection the server is
// closing just then (Node drops one idle for about 6 s), and a loaded machine sends it late enough to meet the close: read
// ECONNRESET. The server never read that request, so a read or a delete sends it once more; a POST is never resent.
const RESEND = { maxRetries: 1 };

/** Removes every loan of the signed-in user, so each test starts from an empty list. */
async function clearLoans(context: BrowserContext): Promise<void> {
  const { loans } = await (await context.request.get("/api/loans", RESEND)).json();
  for (const loan of loans) expect((await context.request.delete(`/api/loans/${loan.id}`, { headers: FETCH, ...RESEND })).status()).toBe(200);
}

test("a loan is typed into the form, a missing kind holds Tallenna back, and the saved loan is listed", async ({ browser }) => {
  const context = await administrator(browser);
  await clearLoans(context);
  const page = await context.newPage();
  const seen = watch(page);
  const writes = loanWrites(page);
  const loan = typed(await today(context));
  await page.goto(HOME);
  const card = saldot(page);
  await noRow(page, "Asuntolaina, Esimerkkipankki Oyj");
  // the box that reads pasted text or a PDF is part of the new-loan form only
  await expect(card.locator("textarea, input[type=file]")).toHaveCount(0);

  await card.getByRole("button", { name: "Lisää laina" }).click();
  const form = card.getByRole("region", { name: "Uusi laina" });
  await expect(form.getByLabel("Lainan tiedot")).toBeVisible();
  await expect(form.getByLabel("Saldon päivä", { exact: true })).toHaveValue(await today(context));
  await form.getByLabel("Lainanantaja", { exact: true }).fill("Esimerkkipankki Oyj");
  await form.getByLabel("Lainaa jäljellä (€)").fill("120 000,00");
  await form.getByLabel("Saldon päivä", { exact: true }).fill(loan.balanceDate);
  await form.getByLabel("Lainan määrä (€)").fill("150 000,00");
  await form.getByLabel("Korko (%)").fill("3,39");
  await form.getByLabel("Viitekorko", { exact: true }).selectOption("euribor_12");
  await form.getByLabel("Marginaali (%)").fill("0,65");
  // a euribor with no review day keeps the typed rate: the fixing in force is not known without it
  await expect(form.getByLabel("Korko (%)")).toHaveValue("3,39");
  await expect(form.locator(".loan-rate-now")).toHaveCount(0);
  await form.getByLabel("Miten erä muuttuu", { exact: true }).selectOption("annuity");
  await form.getByLabel("Lyhennysväli", { exact: true }).selectOption("1");
  await form.getByLabel("Kuukausierä (€)").fill("689,20");
  await form.getByLabel("Viimeinen eräpäivä", { exact: true }).fill(loan.endDate);
  // the labels speak for themselves: no line of help under a field
  await expect(form.locator(".field-help")).toHaveCount(0);
  // a typed form has no marks of a reading
  await expect(form.locator(".badge")).toHaveCount(0);

  // no kind: nothing is sent
  await form.getByRole("button", { name: "Tallenna" }).click();
  await expect(form.getByRole("alert")).toHaveText("Korjaa merkityt kentät.");
  await expect(form.getByText("Valitse laji.")).toBeVisible();
  // the reason is tied to its field, and focus is on the field
  await expect(form.getByLabel("Laji")).toBeFocused();
  await expect(form.getByLabel("Laji")).toHaveAccessibleDescription("Valitse laji.");
  expect(writes).toEqual([]);
  await form.getByLabel("Laji").selectOption("mortgage");
  // a mortgage has no credit limit
  await expect(form.getByLabel("Luottoraja (€)")).toHaveCount(0);
  await form.getByRole("button", { name: "Tallenna" }).click();

  await said(page, "Laina tallennettu");
  expect(writes).toEqual(["POST"]);
  await expect(form).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Lisää laina" })).toBeVisible();
  await expect(rowOf(page, "Asuntolaina, Esimerkkipankki Oyj")).toContainText("Esimerkkipankki Oyj");
  // what the row of Lainat shows: the balance in whole euros and the rate
  await expect(rowOf(page, "Asuntolaina, Esimerkkipankki Oyj")).toContainText(/120\s000\s€/);
  await expect(rowOf(page, "Asuntolaina, Esimerkkipankki Oyj")).toContainText(new RegExp(percentText(339)));
  const typedFigures = { Lainanantaja: "Esimerkkipankki Oyj", "Lainaa jäljellä (€)": "120 000,00", "Korko (%)": "3,39", "Kuukausierä (€)": "689,20", "Viimeinen eräpäivä": loan.endDate };
  await expectSaved(page, "Asuntolaina, Esimerkkipankki Oyj", typedFigures);

  // it is in the database, not only on the page
  await page.reload();
  await expectSaved(page, "Asuntolaina, Esimerkkipankki Oyj", typedFigures);

  // Peruuta closes the form and saves nothing
  await saldot(page).getByRole("button", { name: "Lisää laina" }).click();
  await saldot(page).getByRole("region", { name: "Uusi laina" }).getByRole("button", { name: "Peruuta" }).click();
  await expect(saldot(page).getByRole("region", { name: "Uusi laina" })).toHaveCount(0);
  expect(writes).toEqual(["POST"]);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a saved loan is edited in a dialog and removed after a question", async ({ browser }) => {
  const context = await administrator(browser);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto(HOME);
  const card = lainat(page);
  const dialog = await editLoan(page, "Asuntolaina, Esimerkkipankki Oyj");
  await expect(dialog.getByLabel("Nimi")).toHaveValue("Asuntolaina, Esimerkkipankki Oyj");
  await expect(dialog.getByLabel("Lainaa jäljellä (€)")).toHaveValue("120 000,00");
  await dialog.getByLabel("Nimi").fill("Kodin laina");
  await dialog.getByLabel("Lainaa jäljellä (€)").fill("119 500");
  // a payment under the interval's interest: told before saving, with the way out
  await dialog.getByLabel("Kuukausierä (€)").fill("300");
  await expect(dialog.getByText(/Kuukausierä on pienempi kuin korko \(337,59\s€\)/)).toBeVisible();
  await dialog.getByRole("button", { name: "Tallenna" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Kuukausierä on pienempi kuin korko.");
  await dialog.getByRole("button", { name: "Tyhjennä kuukausierä" }).click();
  await expect(dialog.getByLabel("Kuukausierä (€)")).toHaveValue("");
  // with its review day the euribor's rate is counted from the fixing of the last review day and the margin
  const { fixings } = (await (await context.request.get("/api/loans", RESEND)).json()) as { fixings: Record<string, [string, number][]> };
  const balanceDate = `${(await today(context)).slice(0, 8)}01`;
  const rateBp = rateOn(fixings, balanceDate, 65);
  await expect(dialog.getByLabel("Korko (%)")).toBeVisible();
  await dialog.getByLabel("Koron tarkistuspäivä", { exact: true }).fill(nextYear(balanceDate));
  await expect(dialog.getByLabel("Korko (%)")).toHaveCount(0);
  await expect(dialog.locator(".loan-rate-now")).toHaveText(new RegExp(`^Korko nyt ${percentText(rateBp)}$`));
  await dialog.getByRole("button", { name: "Tallenna" }).click();
  await expect(dialog).toHaveCount(0);
  await said(page, "Muutokset tallennettu");
  const row = rowOf(page, "Kodin laina");
  await expect(row).toBeVisible();
  await editLoan(page, "Kodin laina");
  await expect(dialog.getByLabel("Lainaa jäljellä (€)")).toHaveValue("119 500,00");
  await expect(dialog.locator(".loan-rate-now")).toHaveText(new RegExp(`^Korko nyt ${percentText(rateBp)}$`));
  await dialog.getByRole("button", { name: "Peruuta" }).click();
  // the fields the form did not touch went back as they were, and the rate is the one counted
  const { loans } = await (await context.request.get("/api/loans", RESEND)).json();
  expect(loans).toHaveLength(1);
  expect(loans[0]).toMatchObject({ name: "Kodin laina", kind: "mortgage", lender: "Esimerkkipankki Oyj", balanceCents: 11_950_000, grantedCents: 15_000_000, rateBp, reference: "euribor_12", marginBp: 65, rateReviewDate: nextYear(balanceDate), repayment: "annuity", intervalMonths: 1, paymentCents: null, limitCents: null, seriesKey: null });

  await openLoan(page, "Kodin laina");
  await card.getByRole("button", { name: "Poista laina Kodin laina" }).click();
  const question = page.getByRole("dialog", { name: "Poista Kodin laina?" });
  await question.getByRole("button", { name: "Peruuta" }).click();
  await expect(row).toBeVisible();
  await card.getByRole("button", { name: "Poista laina Kodin laina" }).click();
  await question.getByRole("button", { name: "Poista laina" }).click();
  await said(page, "Laina poistettu");
  await noRow(page, "Kodin laina");
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the day the rate is reviewed is typed in the form and kept, a fixed rate has no such field, and the form fits a phone", async ({ browser }) => {
  const context = await administrator(browser);
  await clearLoans(context);
  const page = await context.newPage();
  const seen = watch(page);
  const loans = async () => (await (await context.request.get("/api/loans", RESEND)).json()).loans as { name: string; reference: string | null; rateReviewDate?: string | null }[];
  await page.goto(HOME);
  await saldot(page).getByRole("button", { name: "Lisää laina" }).click();
  const form = saldot(page).getByRole("region", { name: "Uusi laina" });
  await form.getByLabel("Laji").selectOption("mortgage");
  await form.getByLabel("Nimi").fill("Kotilaina");
  await form.getByLabel("Lainaa jäljellä (€)").fill("120 000");
  await form.getByLabel("Korko (%)").fill("3,39");
  await form.getByLabel("Marginaali (%)").fill("0,65");
  const day = form.getByLabel("Koron tarkistuspäivä", { exact: true });
  // no reference rate named yet: the field is there, right after the margin
  await expect(day).toBeVisible();
  await expect(day).toHaveAttribute("type", "date");
  await expect(day).not.toHaveAttribute("required", "");
  const labels = await form.locator("label.field-label").allInnerTexts();
  expect(labels.indexOf("Koron tarkistuspäivä")).toBe(labels.indexOf("Marginaali (%)") + 1);

  // a fixed rate has no review day, and what was typed comes back with the reference rate
  await form.getByLabel("Viitekorko", { exact: true }).selectOption("euribor_12");
  await day.fill("2027-03-14");
  await form.getByLabel("Viitekorko", { exact: true }).selectOption("fixed");
  await expect(day).toHaveCount(0);
  await form.getByLabel("Viitekorko", { exact: true }).selectOption("euribor_12");
  await expect(day).toHaveValue("2027-03-14");
  await form.getByRole("button", { name: "Tallenna" }).click();
  await said(page, "Laina tallennettu");
  expect(await loans()).toMatchObject([{ name: "Kotilaina", reference: "euribor_12", rateReviewDate: "2027-03-14" }]);

  // the day is kept: it is in the editor after a reload
  await page.reload();
  const dialog = await editLoan(page, "Kotilaina");
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
  await said(page, "Muutokset tallennettu");
  expect(await loans()).toMatchObject([{ name: "Kotilaina", reference: "fixed" }]);
  expect((await loans())[0]!.rateReviewDate ?? null).toBeNull();
  // and its editor has no field either
  await editLoan(page, "Kotilaina");
  await expect(dialog.getByLabel("Koron tarkistuspäivä", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Peruuta" }).click();
  expect(seen.problems).toEqual([]);
  await clearLoans(context);
  await context.close();
});

test("on a phone a loan on a euribor is typed with its margin alone, the form shows the rate now, and its editor shows the saved rate", async ({ browser }) => {
  const context = await administrator(browser);
  await clearLoans(context);
  const day = await today(context);
  const { fixings } = (await (await context.request.get("/api/loans", RESEND)).json()) as { fixings: Record<string, [string, number][]> };
  // the next review a year from the first of this month: the fixing of that first day is the one in force
  const reviewDay = nextYear(`${day.slice(0, 8)}01`);
  const rateBp = rateOn(fixings, `${day.slice(0, 8)}01`, 65);
  const rate = new RegExp(percentText(rateBp));
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  const seen = watch(page);
  await page.goto(HOME);
  await saldot(page).getByRole("button", { name: "Lisää laina" }).click();
  const form = saldot(page).getByRole("region", { name: "Uusi laina" });
  await form.getByLabel("Laji").selectOption("mortgage");
  await form.getByLabel("Nimi").fill("Marginaalilaina");
  await form.getByLabel("Lainaa jäljellä (€)").fill("80 000");

  // the dates are the browser's own date fields, whole on a phone
  const balanceDay = form.getByLabel("Saldon päivä", { exact: true });
  await expect(balanceDay).toHaveAttribute("type", "date");
  await expect(balanceDay).toHaveValue(day);
  expect(await balanceDay.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);

  // a euribor with its review day and a stored fixing asks the margin, and the rate is counted from them
  await form.getByLabel("Viitekorko", { exact: true }).selectOption("euribor_12");
  const review = form.getByLabel("Koron tarkistuspäivä", { exact: true });
  await expect(review).toHaveAttribute("type", "date");
  await review.fill(reviewDay);
  expect(await review.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await expect(form.getByLabel("Korko (%)")).toHaveCount(0);
  const margin = form.getByLabel("Marginaali (%)");
  await margin.fill("0,65");
  await expect(form.locator(".loan-rate-now")).toHaveText(new RegExp(`^Korko nyt ${rate.source}$`));
  await expect(margin).toHaveAccessibleDescription(new RegExp(`Korko nyt ${rate.source}`));
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  await form.getByRole("button", { name: "Tallenna" }).click();
  await said(page, "Laina tallennettu");
  const { loans } = await (await context.request.get("/api/loans", RESEND)).json();
  expect(loans).toMatchObject([{ name: "Marginaalilaina", reference: "euribor_12", marginBp: 65, rateReviewDate: reviewDay, rateBp, balanceDate: day }]);
  // the saved rate is the figure the form showed, with the balance day
  const saved = await editLoan(page, "Marginaalilaina");
  await expect(saved.locator(".loan-rate-now")).toHaveText(new RegExp(`^Korko nyt ${rate.source}$`));
  await expect(saved.getByLabel("Saldon päivä", { exact: true })).toHaveValue(day);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  await saved.getByRole("button", { name: "Peruuta" }).click();
  expect(seen.problems).toEqual([]);
  await clearLoans(context);
  await context.close();
});

test("a member sees and changes only their own loans, and the page fits a phone", async ({ browser }) => {
  const admin = await administrator(browser);
  const created = await admin.request.post("/api/users", { headers: FETCH, data: { username: "lainaaja", displayName: "Lainaaja" } });
  expect(created.ok(), await created.text()).toBe(true);
  const { user, temporaryPassword } = await created.json();
  // a card of the administrator's own, which the member must not see
  await clearLoans(admin);
  const card = { name: "Luottokortti, Mallirahoitus Bank AB", kind: "card", lender: "Mallirahoitus Bank AB", grantedCents: null, balanceCents: 123_456, balanceDate: await today(admin), rateBp: 1890, reference: null, marginBp: null, rateReviewDate: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: 300_000, seriesKey: null };
  expect((await admin.request.post("/api/loans", { headers: FETCH, data: card })).status()).toBe(200);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    expect((await context.request.post("/api/auth/login", { headers: FETCH, data: { username: "lainaaja", password: temporaryPassword } })).status()).toBe(200);
    expect((await context.request.post("/api/auth/first-password", { headers: FETCH, data: { next: PASSWORD } })).status()).toBe(200);
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto(HOME);
    // the administrator's card is not the member's: the member has no loan, so no Lainat
    await expect(saldot(page).getByRole("button", { name: "Lisää laina" })).toBeVisible();
    await expect(lainat(page)).toHaveCount(0);
    await expect(page.getByText("Mallirahoitus")).toHaveCount(0);

    // a loan typed in by hand, on a phone
    await saldot(page).getByRole("button", { name: "Lisää laina" }).click();
    const form = saldot(page).getByRole("region", { name: "Uusi laina" });
    await form.getByLabel("Laji").selectOption("car");
    await form.getByLabel("Nimi").fill("Auton laina");
    await form.getByLabel("Lainaa jäljellä (€)").fill("9 800,50");
    await form.getByLabel("Korko (%)").fill("5,25");
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await form.getByRole("button", { name: "Tallenna" }).click();
    await said(page, "Laina tallennettu");
    await expect(rowOf(page, "Auton laina")).toBeVisible();
    await expect(rowOf(page, "Auton laina")).toContainText(/9\s801\s€/);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    // the phone shows the balance and the rate in the loan's editor
    const dialog = await editLoan(page, "Auton laina");
    await expect(dialog.getByLabel("Lainaa jäljellä (€)")).toHaveValue("9 800,50");
    await expect(dialog.getByLabel("Korko (%)")).toHaveValue("5,25");
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await dialog.getByRole("button", { name: "Peruuta" }).click();

    // the administrator's list has the card and not the member's car loan
    const adminPage = await admin.newPage();
    await adminPage.goto(HOME);
    await expect(rowOf(adminPage, "Luottokortti, Mallirahoitus Bank AB")).toBeVisible();
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
/** The debt total of the Lainat report in whole euros: the demo's loan nobody saved makes it the known total. */
const owed = async (section: Locator) => Number(/(\d[\d\s]*?)\s*€/.exec(await section.locator("table.rt tfoot tr").filter({ hasText: /Velat yhteensä/ }).innerText())![1]!.replace(/\D/g, ""));

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
  const sentence = report.locator('li.notice[data-tone="warning"]').filter({ hasText: "Sama velka voi olla summassa kahdesti" });
  await expect(sentence).toContainText("tallennettu laina Esimerkkikortti ja yhdistetty tili Nordea Gold (esimerkki)");
  const before = await owed(report);
  await sentence.getByRole("link", { name: "Liitä Esimerkkikortti tiliin Nordea Gold (esimerkki)" }).click();

  // the editor of that loan opens with the account chosen, and the address no longer holds the request
  const dialog = page.getByRole("dialog", { name: "Muokkaa lainaa" });
  await expect(dialog.getByLabel("Nimi")).toHaveValue("Esimerkkikortti");
  await expect(dialog.getByLabel("Sama velka pankin tilillä")).toHaveValue(account!.id);
  // the loan's row is open in Varat ja velat, and the address forgets the link, so a reload does not open the editor again
  await expect(page).toHaveURL(/#\/reports\?q=saldot&drill=[^#]*#lainat$/);
  await expect(page).not.toHaveURL(/linkLoan|linkAccount/);
  await dialog.getByRole("button", { name: "Tallenna" }).click();
  await expect(dialog).toHaveCount(0);
  await said(page, "Muutokset tallennettu");
  // the editor keeps the account it is linked to
  const linked = await editLoan(page, "Esimerkkikortti");
  await expect(linked.getByLabel("Sama velka pankin tilillä")).toHaveValue(account!.id);
  await linked.getByRole("button", { name: "Peruuta" }).click();

  // on the same report, with no reload by hand: the sentence is gone and the total fell by the typed balance
  await expect(report.getByText("Esimerkkikortti").first()).toBeVisible();
  await expect(report.locator('li.notice[data-tone="warning"]').filter({ hasText: "Sama velka voi olla summassa kahdesti" })).toHaveCount(0);
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
  await page.goto(HOME);
  const dialog = await editLoan(page, "Esimerkkikortti B");
  await dialog.getByLabel("Sama velka pankin tilillä").selectOption(account!.id);

  // meanwhile the card is linked to the other loan: the form still offers it, and the server says no
  const { loans } = await (await context.request.get("/api/loans", RESEND)).json();
  const { id, ...other } = loans.find((l: { name: string }) => l.name === "Esimerkkikortti A");
  expect((await context.request.put(`/api/loans/${id}`, { headers: FETCH, data: { ...other, accountId: account!.id } })).status()).toBe(200);
  await dialog.getByRole("button", { name: "Tallenna" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Tähän tiliin on jo liitetty laina Esimerkkikortti A. Poista liitos siitä ensin.");
  await expect(dialog).toBeVisible();

  // with the list read again, the form does not offer the card the other loan holds, and the select is not there at all
  await dialog.getByRole("button", { name: "Peruuta" }).click();
  await page.reload();
  await editLoan(page, "Esimerkkikortti B");
  await expect(page.getByRole("dialog", { name: "Muokkaa lainaa" }).getByLabel("Sama velka pankin tilillä")).toHaveCount(0);
  // the refusal is the one 400 of the page
  expect(seen.problems.filter((p) => !/HTTP 400: PUT .*\/api\/loans\//.test(p) && !/Failed to load resource.*400/.test(p))).toEqual([]);
  await clearLoans(context);
  await context.close();
});
