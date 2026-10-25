import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { makeMember, overflow, removeMember, watch } from "./helpers.ts";

// Ilmoitukset, the one card at the foot of Yhteenveto: what the user must act on, one line a row, four rows at most. The
// demo household has alerts but no warning about its data, so the page is given one in the answer of the dashboard (the
// field core fills when a signal is a warning); every other row, button and answer is the server's. The spec that answers
// a question of the demo is marks.spec.ts.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };
const WARNING = { id: "stale", tone: "warning", title: "Esimerkkitilin tiedot ovat vanhoja", detail: "Esimerkkitili on haettu viimeksi viikko sitten." };
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";
/** An alert as core gives it, for a page that wants more of them than the demo has. */
const alertOf = (n: number, detail = "Selitys") => ({ id: `extra:${n}`, kind: "spike", tone: "info", title: `Esimerkkihälytys ${n}`, detail });

/** The dashboard as the server answers it, with a warning about the data in it and, when given, other alerts in place of the demo's. */
async function withWarning(page: Page, alerts?: object[]): Promise<void> {
  await page.route("**/api/dashboard**", async (route) => {
    const answer = await route.fetch();
    await route.fulfill({ response: answer, json: { ...(await answer.json()), dataNotice: WARNING, connectNotice: null, ...(alerts ? { alerts } : {}) } });
  });
}

async function open(context: BrowserContext, width = 1280, alerts?: object[]): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 900 });
  await withWarning(page, alerts);
  await page.goto("/#/overview?period=month");
  await expect(page.getByRole("heading", { name: "Tulot ja menot", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  return page;
}

const cardOf = (page: Page) => page.getByRole("region", { name: "Ilmoitukset" });


test("Ilmoitukset is one card, the last of the page: the warning first and linked to Tietojen laatu, Kuittaa takes an alert away for good", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "ilmoitus");
  const context = await browser.newContext({ storageState: state });
  try {
    expect((await context.request.post("/api/demo", { headers: FETCH })).status()).toBe(200);
    const page = await open(context);
    const seen = watch(page);
    const card = cardOf(page);

    // one heading, the last card of the page, and no line about the data under it
    await expect(page.getByRole("heading", { name: "Ilmoitukset", exact: true })).toHaveCount(1);
    await expect(page.locator(".card").last()).toContainText("Ilmoitukset");
    await expect(page.locator(".data-scope")).toHaveCount(0);

    // the warning stands first and is read as one; the demo's questions and alerts follow it
    const rows = card.getByRole("listitem");
    await expect(rows.first()).toContainText("Huomio: Esimerkkitilin tiedot ovat vanhoja");
    await expect(rows.first().getByRole("button")).toHaveCount(0);
    expect(await rows.count()).toBeGreaterThan(1);

    // Kuittaa: while the answer is on its way no button of the list can be pressed, then the alert is gone
    const dismiss = card.getByRole("button", { name: /^Kuittaa: / }).first();
    const name = (await dismiss.getAttribute("aria-label"))!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/marks", async (route) => {
      await gate;
      await route.continue();
    });
    await dismiss.click();
    await expect(card.locator("button:enabled")).toHaveCount(0);
    release();
    await expect(card.getByRole("button", { name, exact: true })).toHaveCount(0);
    await expect(card.locator("button:enabled").first()).toBeVisible();

    // and it stays away after a reload, with the warning still first
    await page.reload();
    await expect(page.getByRole("heading", { name: "Tulot ja menot", exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(cardOf(page).getByRole("button", { name, exact: true }), "the dismissed alert is back after a reload").toHaveCount(0);
    await expect(cardOf(page).getByRole("listitem").first()).toContainText("Esimerkkitilin tiedot ovat vanhoja");

    // the warning leads to Asetukset > Tietojen laatu, a card while the data has a note: the answer is given the note of the warning
    await page.route("**/api/reports?**", async (route) => {
      const answer = await route.fetch();
      await route.fulfill({ response: answer, json: { ...(await answer.json()), dataQuality: { signals: [{ ...WARNING, tone: "warning" }] } } });
    });
    await cardOf(page).getByRole("link", { name: /Esimerkkitilin tiedot ovat vanhoja/ }).click();
    await expect(page).toHaveURL(/#\/settings\?section=technical#laatu$/);
    await expect(page.getByRole("heading", { name: "Tietojen laatu" })).toBeVisible();
    expect(seen.problems).toEqual([]);
  } finally {
    await context.close();
    await removeMember(browser, id);
  }
});

test("a failed answer shows the server's sentence under the list, the row stays and can be answered again", async ({ browser }) => {
  // nothing is stored: the server's answer is made here, so the administrator's demo stays as it was
  const context = await browser.newContext({ storageState: STATE });
  try {
    const page = await open(context);
    const card = cardOf(page);
    await page.route("**/api/marks", (route) => route.fulfill({ status: 500, json: { error: "Tallennus ei onnistunut. Yritä uudelleen." } }));
    const rows = card.getByRole("listitem");
    const before = await rows.count();
    const dismiss = card.getByRole("button", { name: /^Kuittaa: / }).first();
    const name = (await dismiss.getAttribute("aria-label"))!;
    await dismiss.click();

    const error = card.getByRole("alert");
    await expect(error).toHaveText("Tallennus ei onnistunut. Yritä uudelleen.");
    expect((await error.boundingBox())!.y, "the sentence is under the list").toBeGreaterThan((await rows.last().boundingBox())!.y);
    await expect(rows).toHaveCount(before);
    await expect(card.getByRole("button", { name, exact: true })).toBeEnabled();
  } finally {
    await context.close();
  }
});

test("a row is one line with its Kuittaa at the right, a text that does not fit is cut and told whole in the title, and nothing scrolls sideways on a phone", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE });
  try {
    const long = "Hyvin pitkä selitys, joka ei mahdu yhdelle riville. ".repeat(6).trim();
    const page = await open(context, 1280, [alertOf(1), alertOf(2, long)]);
    const rows = cardOf(page).getByRole("listitem");
    await expect(rows).toHaveCount(3);
    // every row is one line, the long one too, and the rows are of one height with or without a button
    const heights = await Promise.all((await rows.all()).map(async (row) => (await row.boundingBox())!.height));
    for (const h of heights) expect(h, "a row is one line").toBeLessThanOrEqual(41);
    expect(Math.max(...heights) - Math.min(...heights), "the rows are of one height").toBeLessThanOrEqual(1);
    const longRow = rows.filter({ hasText: "Esimerkkihälytys 2" });
    const text = longRow.locator(".notice-text");
    expect(await text.evaluate((el) => el.scrollWidth > el.clientWidth), "the long text is cut, not wrapped").toBe(true);
    await expect(text).toHaveAttribute("title", `Esimerkkihälytys 2. ${long}`);
    // the title and its detail are in one size and the detail is in the second text colour
    const [title, detail] = await Promise.all(["notice-title", "notice-detail"].map((c) => longRow.locator(`.${c}`).evaluate((el) => getComputedStyle(el).fontSize)));
    expect(detail).toBe(title);
    // the button is at the right of the text, on the row's one line
    const [box, button] = await Promise.all([text.boundingBox(), longRow.getByRole("button", { name: /^Kuittaa: / }).boundingBox()]);
    expect(button!.x, "at 1280 px the button is beside the text").toBeGreaterThanOrEqual(box!.x + box!.width - 1);
    expect(button!.y).toBeLessThan(box!.y + box!.height);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(longRow).toBeVisible();
    for (const row of await rows.all()) {
      const cell = (await row.locator(".notice-text").boundingBox())!;
      const card = (await cardOf(page).boundingBox())!;
      expect(cell.x + cell.width, "a row stays inside the card on a phone").toBeLessThanOrEqual(card.x + card.width);
    }
    expect(await overflow(page), "Yhteenveto with Ilmoitukset scrolls sideways at 390px").toBeLessThanOrEqual(1);
  } finally {
    await context.close();
  }
});

test("a payment without a category is one line with Luokittele beside Kuittaa, and the link opens that payment in Tapahtumat, where it gets the category Auton osto", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "luokittelu");
  const context = await browser.newContext({ storageState: state });
  try {
    expect((await context.request.post("/api/demo", { headers: FETCH })).status()).toBe(200);
    // a payment of the demo stands for the one core finds: the row is the server's, the alert about it is made here
    const list = await context.request.get("/api/transactions?limit=200", { headers: FETCH });
    const { items } = (await list.json()) as { items: { merchant: string; bookingDate: string; amountCents: number; category: string }[] };
    const paid = items.find((t) => t.amountCents < 0 && t.category === "groceries")!;
    const day = `${Number(paid.bookingDate.slice(8))}.${Number(paid.bookingDate.slice(5, 7))}.`;
    const detail = `${paid.merchant} ${day} ${(-paid.amountCents / 100).toFixed(2).replace(".", ",")} €`;
    const alert = { id: "uncategorised:e2e", kind: "uncategorised", tone: "info", title: "Luokittelematon maksu", detail, row: { merchant: paid.merchant, date: paid.bookingDate } };
    const page = await open(context, 1280, [alert, alertOf(1)]);
    const seen = watch(page);

    const row = cardOf(page).getByRole("listitem").filter({ hasText: "Luokittelematon maksu" });
    await expect(row).toContainText(`Tiedoksi: Luokittelematon maksu. ${detail}`);
    expect((await row.boundingBox())!.height, "the row is one line").toBeLessThanOrEqual(41);
    // one link, the words that say what to do, at the left of Kuittaa on the row's line
    await expect(row.getByRole("link")).toHaveCount(1);
    const link = row.getByRole("link", { name: `Luokittele: ${detail}`, exact: true });
    await expect(link).toHaveText("Luokittele");
    const [words, button] = await Promise.all([link.boundingBox(), row.getByRole("button", { name: `Kuittaa: Luokittelematon maksu ${detail}`, exact: true }).boundingBox()]);
    expect(words!.x + words!.width, "Luokittele is at the left of Kuittaa").toBeLessThanOrEqual(button!.x);
    expect(words!.y, "and on its line").toBeLessThan(button!.y + button!.height);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(link).toBeVisible();
    const card = (await cardOf(page).boundingBox())!;
    const narrow = (await row.getByRole("button", { name: /^Kuittaa: / }).boundingBox())!;
    expect(narrow.x + narrow.width, "the answers stay inside the card on a phone").toBeLessThanOrEqual(card.x + card.width);
    expect(await overflow(page), "Yhteenveto with the row scrolls sideways at 390px").toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1280, height: 900 });

    // the link opens Tapahtumat with that payee on that day
    await link.click();
    await expect(page).toHaveURL(/#\/transactions\?/);
    const filters = new URLSearchParams(page.url().split("?")[1]);
    expect(Object.fromEntries(filters)).toEqual({ merchant: paid.merchant, from: paid.bookingDate, to: paid.bookingDate });
    // and there the payment gets its category from the opened row: Auton osto can be picked for any row
    await page.getByRole("button", { name: `Avaa ${paid.merchant}: 12 kuukautta` }).first().click();
    await page.getByRole("button", { name: `Kategoria: ${paid.merchant}, nyt Ruokakauppa` }).first().click();
    await page.getByRole("dialog", { name: `Kategoria: ${paid.merchant}` }).getByRole("option", { name: "Auton osto" }).click();
    await expect(page.getByRole("status").filter({ hasText: /siirrettiin kategoriaan/ })).toBeVisible();
    await expect(page.getByRole("button", { name: `Kategoria: ${paid.merchant}, nyt Auton osto` }).first()).toBeVisible();
    expect(seen.problems).toEqual([]);
  } finally {
    await context.close();
    await removeMember(browser, id);
  }
});

test("Ilmoitukset shows four rows at most, and its head leads to Säästövinkit with the count of all of them", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE });
  try {
    // the warning and six alerts are seven rows; four are shown, the warning first
    const page = await open(context, 1280, [1, 2, 3, 4, 5, 6].map((n) => alertOf(n)));
    const card = cardOf(page);
    await expect(card.getByRole("listitem")).toHaveCount(4);
    await expect(card.getByRole("listitem").first()).toContainText("Esimerkkitilin tiedot ovat vanhoja");
    const all = card.locator(".card-head").getByRole("link", { name: "Kaikki (7)" });
    await expect(all).toHaveAttribute("href", "#/optimise");
    await all.click();
    await expect(page).toHaveURL(/#\/optimise$/);

    // four rows or fewer: no link
    const few = await open(context, 1280, [1, 2].map((n) => alertOf(n)));
    await expect(cardOf(few).getByRole("listitem")).toHaveCount(3);
    await expect(cardOf(few).getByRole("link", { name: /^Kaikki/ })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("a sign-in from a new device is the first row, leading to Asetukset, and Kuittaa takes it away for good", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "kirjaus");
  const context = await browser.newContext({ storageState: state });
  const other = await browser.newContext({ userAgent: FIREFOX });
  try {
    expect((await context.request.post("/api/demo", { headers: FETCH })).status()).toBe(200);
    const login = await other.request.post("/api/auth/login", { headers: FETCH, data: { username: "kirjaus", password: "kirjaus-123456" } });
    expect(login.ok(), `POST /api/auth/login answered ${login.status()}`).toBe(true);
    const page = await open(context);
    const seen = watch(page);
    const card = cardOf(page);
    // not a banner above the page, but a row of the list, before the warning about the data
    await expect(page.locator(".notice")).toHaveCount(0);
    const first = card.getByRole("listitem").first();
    await expect(first).toContainText(/Uusi kirjautuminen \d{1,2}\.\d{1,2}\. klo \d{1,2}\.\d{2} \(Firefox, Linux\)/);
    await expect(first.getByRole("link")).toHaveAttribute("href", "#/settings#kirjautuminen");
    await expect(card.getByRole("listitem").nth(1)).toContainText("Esimerkkitilin tiedot ovat vanhoja");

    // Kuittaa reads the notice, and it stays read after a reload
    await first.getByRole("button", { name: /^Kuittaa: Uusi kirjautuminen/ }).click();
    await expect(card.getByText(/Uusi kirjautuminen/)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Tulot ja menot", exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(cardOf(page).getByText(/Uusi kirjautuminen/)).toHaveCount(0);
    await expect(cardOf(page).getByRole("listitem").first()).toContainText("Esimerkkitilin tiedot ovat vanhoja");
    expect(seen.problems).toEqual([]);
  } finally {
    await other.close();
    await context.close();
    await removeMember(browser, id);
  }
});

test("one page load of Yhteenveto asks /api/meta once", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE });
  const page = await context.newPage();
  let asked = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/meta") asked++;
  });
  await page.goto("/#/overview?period=month");
  await expect(page.getByRole("heading", { name: "Tulot ja menot", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(asked).toBe(1);
  await context.close();
});
