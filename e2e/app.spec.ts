import { expect, type BrowserContext, type Page, test } from "@playwright/test";
import { join } from "node:path";

const SETUP_CODE = process.env.E2E_SETUP_CODE ?? "";
const ADMIN = { username: "e2e-admin", displayName: "E2E Admin", password: "e2e-salasana-123456" };
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

const PAGES = [
  ["overview", "Yleiskatsaus"],
  ["reports", "Raportit"],
  ["optimise", "Optimoi"],
  ["transactions", "Tapahtumat"],
  ["recurring", "Toistuvat"],
  ["categories", "Kategoriat"],
  ["settings", "Asetukset"],
] as const;

/** Everything a visitor would call "broken": console errors, uncaught errors, failed requests and any 4xx or 5xx. */
function watch(page: Page): { problems: string[] } {
  const seen = { problems: [] as string[] };
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "assert") seen.problems.push(`console ${m.type()}: ${m.text()} (${m.location().url})`);
  });
  page.on("pageerror", (e) => seen.problems.push(`page error: ${e.message}`));
  page.on("requestfailed", (r) => {
    // The app never aborts a request itself, so an aborted GET is one that a reload or navigation cut off.
    if (r.method() === "GET" && r.failure()?.errorText === "net::ERR_ABORTED") return;
    seen.problems.push(`request failed: ${r.method()} ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) seen.problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
  });
  return seen;
}

test.describe.configure({ mode: "serial" });

test("first run: the setup form creates the administrator, the wizard can be skipped", async ({ page }) => {
  const seen = watch(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ota sovellus käyttöön" })).toBeVisible();

  // a wrong code and a short password are explained next to the field, not as a crash
  await page.getByLabel("Asennuskoodi").fill("väärä-koodi");
  await page.getByLabel("Käyttäjätunnus").fill(ADMIN.username);
  await page.getByLabel("Nimi", { exact: true }).fill(ADMIN.displayName);
  await page.getByLabel("Salasana (vähintään 12 merkkiä)").fill("lyhyt");
  await page.getByLabel("Salasana uudelleen").fill("lyhyt");
  await page.getByRole("button", { name: "Luo ja kirjaudu" }).click();
  await expect(page.getByText("Vähintään 12 merkkiä.")).toBeVisible();

  await page.getByLabel("Asennuskoodi").fill("väärä-koodi");
  await page.getByLabel("Salasana (vähintään 12 merkkiä)").fill(ADMIN.password);
  await page.getByLabel("Salasana uudelleen").fill(ADMIN.password);
  await page.getByRole("button", { name: "Luo ja kirjaudu" }).click();
  await expect(page.locator(".error").first()).toBeVisible();

  await page.getByLabel("Asennuskoodi").fill(SETUP_CODE);
  await page.getByRole("button", { name: "Luo ja kirjaudu" }).click();
  await expect(page.getByRole("heading", { name: "Käyttöönotto" })).toBeVisible();

  // the wizard starts at Enable Banking: the address and schedule were saved with their defaults
  await expect(page.getByLabel("Vaiheet", { exact: true }).getByText("Osoite ja aikataulu")).toHaveCount(0);
  await expect(page.getByLabel("Vaiheet", { exact: true }).getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText("Pankki palauttaa selaimen tämän sivun kautta")).toBeVisible();
  const checklist = page.getByLabel("Enable Banking -sovelluksen vaiheet");
  await expect(checklist.locator("li.done")).toHaveCount(0);
  await page.getByRole("button", { name: "Luo avain" }).click();
  await expect(checklist.getByText("Avain luotu")).toHaveClass(/done/);
  // the .pem option is behind "Muut vaihtoehdot"; the copy button works on plain http too
  await expect(page.getByRole("button", { name: "Minulla on .pem-tiedosto" })).toBeHidden();
  await page.getByText("Muut vaihtoehdot").click();
  await expect(page.getByRole("button", { name: "Minulla on .pem-tiedosto" })).toBeVisible();
  await page.getByRole("button", { name: "Kopioi", exact: true }).click();
  await expect(page.getByRole("button", { name: "Kopioitu" })).toBeVisible();
  await page.getByRole("button", { name: "Ohita" }).click();
  await expect(page.getByText("Salausavain")).toBeVisible();
  await page.getByRole("button", { name: "Siirry sovellukseen" }).click();
  await expect(page.getByRole("navigation").getByText("Yleiskatsaus").first()).toBeVisible();
  await page.context().storageState({ path: STATE });
  // the only expected failures are the wrong setup code (400) and nothing else
  expect(seen.problems.filter((p) => !/HTTP 400: POST .*\/api\/auth\/setup/.test(p) && !/Failed to load resource.*400/.test(p))).toEqual([]);
});

test("empty account: the overview offers the demo data and the demo loads", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview");
  const demo = page.getByRole("button", { name: /esimerkki|demo/i }).first();
  await expect(demo).toBeVisible();
  await demo.click();
  await expect(page.getByText(/Ruoka|Asuminen|Palkka/).first()).toBeVisible({ timeout: 20_000 });
  expect(seen.problems).toEqual([]);
  await context.close();
});

async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

{
  for (const [device, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 375, height: 667 }]] as const) {
    test(`every page, ${device}`, async ({ browser }) => {
      const context: BrowserContext = await browser.newContext({ storageState: STATE, viewport, isMobile: device === "phone", hasTouch: device === "phone" });
      const page = await context.newPage();
      const seen = watch(page);
      for (const [id, title] of PAGES) {
        await page.goto(`/#/${id}`);
        await expect(page).toHaveTitle(new RegExp(`^${title}`));
        await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
        await expect(page.getByText(/Jokin meni vikaan|Palvelimeen ei saada yhteyttä/)).toHaveCount(0);
        await page.waitForLoadState("networkidle");
        // a page that rendered nothing but its frame is a failure too
        expect((await page.locator("main, .app").first().innerText()).length, `${id} is empty`).toBeGreaterThan(200);
        expect(await overflow(page), `${id} scrolls sideways at ${viewport.width}px`).toBeLessThanOrEqual(1);
        // no table is wider than the screen, also one that sits in a card that scrolls
        const wide = await page.evaluate(() => Array.from(document.querySelectorAll("table")).filter((t) => t.getBoundingClientRect().width > window.innerWidth + 1).length);
        expect(wide, `${id} has a table wider than the screen at ${viewport.width}px`).toBe(0);
        if (id === "overview") {
          // the month (forecast beside the explanation) comes first, then the next 30 days
          const month = page.getByRole("region", { name: "Kuukauden menot" });
          await expect(month.getByRole("heading", { name: "Ennuste kuun loppuun" })).toBeVisible();
          await expect(month.getByRole("heading", { name: "Menot kuukausittain" })).toBeVisible();
          const ahead = page.getByRole("heading", { name: "Seuraavat 30 päivää" });
          await expect(ahead).toBeVisible();
          const [monthBox, aheadBox] = [await month.boundingBox(), await ahead.boundingBox()];
          expect(monthBox!.y, "the month is above the next 30 days").toBeLessThan(aheadBox!.y);
          // on a desktop the forecast and the explanation share a row, on a phone they are stacked
          const [forecast, explanation] = [await month.getByRole("heading", { name: "Ennuste kuun loppuun" }).boundingBox(), await month.getByRole("heading", { name: "Menot kuukausittain" }).boundingBox()];
          if (device === "desktop") expect(Math.abs(forecast!.y - explanation!.y), "side by side").toBeLessThan(8);
          else expect(explanation!.y, "stacked").toBeGreaterThan(forecast!.y + 40);
        }
      }
      // the two report tabs and a filtered transaction list reach their data too
      await page.goto("/#/transactions?category=groceries");
      await page.waitForLoadState("networkidle");
      await page.goto("/#/settings?add=1");
      await page.waitForLoadState("networkidle");
      expect(seen.problems).toEqual([]);
      await context.close();
    });
  }
}

test("a merchant on the overview opens its transactions with a summary of its whole history", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview");
  const link = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Kauppiaat" }) }).locator("tbody a").first();
  await expect(link).toBeVisible();
  const merchant = (await link.innerText()).trim();
  await link.click();
  await expect(page).toHaveURL(/#\/transactions\?.*merchant=/);
  const summary = page.getByRole("region", { name: `Yhteenveto: ${merchant}` });
  await expect(summary).toBeVisible();
  await expect(summary.getByRole("heading", { name: merchant })).toBeVisible();
  for (const term of ["Maksuja", "Ensimmäinen", "Viimeisin"]) await expect(summary.getByText(term, { exact: true })).toBeVisible();
  // the list below is the same merchant
  await expect(page.locator("tbody tr").first()).toBeVisible();
  // without a merchant filter there is no summary
  await page.goto("/#/transactions");
  await expect(page.getByRole("region", { name: /^Yhteenveto:/ })).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a changed category is kept after a reload", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions");
  const rows = page.locator("tbody tr");
  await expect(rows.first()).toBeVisible();

  // pick a row that was categorised by rule so that "käsin" (by hand) is new after the change
  const row = rows.filter({ hasNot: page.locator(".badge", { hasText: "käsin" }) }).filter({ hasNotText: /Omat siirrot|Kortin lasku|Luotonnostot/ }).first();
  // the phone layout has a second, hidden picker in the same row
  const picker = row.locator("td.tx-category button.select-lite").first();
  const merchant = ((await picker.getAttribute("aria-label")) ?? "").replace(/^Kategoria: /, "").replace(/, nyt .*$/, "");
  const before = (await picker.innerText()).trim();
  await picker.click();
  // only one picker is open at a time; the row filter above would stop matching once its options exist
  const select = page.locator("td.tx-category select");
  const target = before === "Lemmikit" ? "Rahapelit" : "Lemmikit";
  await select.selectOption({ label: target });
  // "Tapahtuma siirrettiin" or "N tapahtumaa siirrettiin" confirms the save
  await expect(page.getByText(/siirrettiin kategoriaan/)).toBeVisible();

  await page.reload();
  const same = page.locator("tbody tr").filter({ has: page.getByRole("button", { name: new RegExp(`^Kategoria: ${merchant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, nyt ${target}`) }) });
  await expect(same.first()).toBeVisible();
  // the row has a phone and a desktop copy of its badge, one of them is hidden by CSS
  await expect(same.first().locator(".badge", { hasText: "käsin" }).first()).toBeAttached();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a subscription marked as in use stays marked after a reload, and the mark can be undone", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/recurring");
  const total = page.locator(".card", { has: page.getByRole("heading", { name: "Tilaukset" }) }).locator(".card-head strong");
  await expect(total).toBeVisible();
  // the tile and the card header are one figure
  const tile = page.locator(".card", { has: page.locator(".tile-label", { hasText: /^Tilaukset$/ }) }).locator(".tile-value");
  await expect(tile).toHaveText((await total.innerText()).trim());

  const answer = page.getByRole("button", { name: /^Käytössä: / }).first();
  await expect(answer).toBeVisible();
  const merchant = ((await answer.getAttribute("aria-label")) ?? "").replace(/^Käytössä: /, "");
  await answer.click();
  const undo = page.getByRole("button", { name: `Kumoa: ${merchant}` }).first();
  await expect(undo).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: `Kumoa: ${merchant}` }).first()).toBeVisible();
  await expect(page.locator("tr", { has: page.getByRole("link", { name: merchant, exact: true }) }).first().locator(".badge", { hasText: "Käytössä" })).toBeVisible();

  await page.getByRole("button", { name: `Kumoa: ${merchant}` }).first().click();
  await expect(page.getByRole("button", { name: `Käytössä: ${merchant}` }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: `Käytössä: ${merchant}` }).first()).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a dismissed alert stays away after a reload", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview");
  await expect(page.getByRole("heading", { name: "Menot kuukausittain" })).toBeVisible();
  const alerts = page.getByRole("list", { name: "Huomiot" });
  // a forgotten service is answered, not only dismissed (the buttons are looked at, not pressed: a mark would change the recurring page)
  await expect(alerts.getByRole("button", { name: /^Käytössä: / }).first()).toBeVisible();
  await expect(alerts.getByRole("button", { name: /^Lopetettu: / }).first()).toBeVisible();

  const dismiss = alerts.getByRole("button", { name: /^Kuittaa: / }).first();
  await expect(dismiss).toBeVisible();
  const name = (await dismiss.getAttribute("aria-label"))!;
  await dismiss.click();
  await expect(alerts.getByRole("button", { name, exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Menot kuukausittain" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(alerts.getByRole("button", { name, exact: true }), "the dismissed alert is back after a reload").toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the recurring tables fit a phone: the date of the next charge is inside the card at 390 px", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/recurring");
  await expect(page.getByRole("heading", { name: "Tilaukset" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  // a table wider than its card scrolls sideways inside the card and clips the last column
  const clipped = await page.evaluate(() => Array.from(document.querySelectorAll(".table-wrap")).filter((w) => w.scrollWidth > w.clientWidth + 1).length);
  expect(clipped, "tables that scroll sideways").toBe(0);
  const next = page.locator("th", { hasText: "Seuraava" }).first();
  await expect(next).toBeInViewport({ ratio: 1 });
  expect(seen.problems).toEqual([]);
  await context.close();
});

/** The page is no wider than the screen, and no table sticks out of it or scrolls sideways inside its card. */
async function fitsScreen(page: Page, what: string): Promise<void> {
  expect(await overflow(page), `${what} scrolls sideways`).toBeLessThanOrEqual(1);
  const wide = await page.evaluate(() => Array.from(document.querySelectorAll("table")).filter((t) => t.getBoundingClientRect().width > window.innerWidth + 1).length);
  expect(wide, `${what} has a table wider than the screen`).toBe(0);
  const clipped = await page.evaluate(() => Array.from(document.querySelectorAll(".table-wrap")).filter((w) => w.scrollWidth > w.clientWidth + 1).length);
  expect(clipped, `${what} has a table that scrolls sideways in its card`).toBe(0);
}

test("Optimoi at its default flag: a demo finding is listed, decisions survive a reload with their follow-up, and everything fits a phone", async ({ browser }) => {
  const desktop = await browser.newContext({ storageState: STATE, viewport: { width: 1366, height: 800 } });
  const page = await desktop.newPage();
  const seen = watch(page);
  // the module ships on; an admin can switch it off in Asetukset > Palvelin, and the end of the test does that through the same API
  const flag = (on: boolean) => desktop.request.put("/api/admin/features", { headers: { "X-Requested-With": "fetch" }, data: { optimise: on } });
  try {
    await page.goto("/#/optimise");
    await expect(page).toHaveTitle(/^Optimoi/);
    await expect(page.getByRole("navigation", { name: "Päävalikko" }).getByRole("link", { name: "Optimoi" })).toBeVisible();
    await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });

    // the header says what the numbers rest on, and the situation and its checks are there
    await expect(page.getByText(/^Tiedot \d+\.\d+\.\d{4} asti/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Tietojen laatu" })).toBeVisible();
    const situation = page.getByRole("region", { name: "Tilanne" });
    await expect(situation).toContainText(/Löydetty vuosivaikutus noin \d[\d\s]*€, 2 löydöstä\./);
    await expect(situation).toContainText(/Tarkistettiin \d+ asiaa/);
    for (const fact of ["Säästöaste", "Kiinteät menot tuloista", "Puskuri", "Velanhoito tuloista"]) await expect(situation.getByText(fact, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Alueet", exact: true })).toBeVisible();
    // a quiet area lists what it checked
    await expect(page.getByRole("region", { name: "Alueet ilman löydöksiä" })).toContainText("Asuntolainan marginaali");

    // the demo history has a software price rise and two video services at once
    const cards = page.locator("article.finding");
    const rise = cards.filter({ hasText: "Adobe: hinta nousi" });
    const overlap = cards.filter({ hasText: "videopalvelua yhteensä" });
    await expect(rise).toBeVisible();
    await expect(overlap).toBeVisible();
    await expect(rise).toContainText(/144\s€ vuodessa/);
    await expect(rise).toContainText("Varmuus: korkea");
    await expect(overlap).toContainText("Varmuus: keskitaso");

    // the calculation: its lines, the months as bars with a table view, and a way to check the categories
    await rise.getByRole("button", { name: "Avaa laskelma" }).click();
    await expect(rise.getByText("Hinta ennen")).toBeVisible();
    await expect(rise.getByRole("img", { name: "Menot kuukausittain" })).toBeVisible();
    await rise.getByRole("button", { name: "Taulukko" }).click();
    await expect(rise.locator("th", { hasText: "Kuukausi" })).toBeVisible();
    await expect(rise.getByRole("link", { name: "Adobe", exact: true })).toHaveAttribute("href", /#\/transactions\?merchant=Adobe/);
    await rise.getByRole("button", { name: "Sulje laskelma" }).click();
    await expect(rise.getByText("Hinta ennen")).toHaveCount(0);

    // Ei koske meitä takes the finding out of its area and the headline, and the choice stays after a reload
    const title = (await overlap.locator(".finding-title").innerText()).trim();
    await overlap.getByRole("button", { name: "Ei koske meitä" }).click();
    await overlap.getByRole("button", { name: "Tarvitsen tämän" }).click();
    const dismissed = page.getByRole("region", { name: "Ei koske meitä" });
    await expect(dismissed).toContainText(title);
    await expect(dismissed).toContainText("Tarvitsen tämän");
    // the card the keyboard was on is gone: focus is on the message
    await expect(page.getByRole("status").filter({ hasText: "Löydös siirrettiin kohtaan Ei koske meitä." })).toBeFocused();
    await expect(overlap).toHaveCount(0);
    await expect(situation).toContainText(/noin \d[\d\s]*€, 1 löydös\./);

    await page.reload();
    await expect(rise).toBeVisible();
    await expect(overlap).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Ei koske meitä" })).toContainText(title);

    // taking the decision back returns the finding
    await page.getByRole("button", { name: `Peruuta päätös: ${title}` }).click();
    await expect(overlap).toBeVisible();
    await expect(page.getByRole("region", { name: "Ei koske meitä" })).toHaveCount(0);

    // Tein tämän keeps its date, and Muistuta myöhemmin hides the finding until then
    await rise.getByRole("button", { name: "Tein tämän" }).click();
    await rise.getByRole("button", { name: "Tallenna" }).click();
    await expect(page.getByRole("region", { name: "Jo hoidossa" })).toContainText("Adobe: hinta nousi");
    await expect(rise).toHaveCount(0);
    await page.reload();
    const done = page.getByRole("region", { name: "Jo hoidossa" });
    await expect(done).toContainText(/Tehty \d+\.\d+\.\d{4}/);
    // the follow-up judges the change once complete months show it: made today, it waits
    await expect(done.locator(".outcome")).toContainText(/^Seuranta: Odottaa.+\./);
    // one visit makes one snapshot: no line and no changes yet
    await expect(page.getByRole("region", { name: "Seuranta" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Muutokset viime käynnin jälkeen" })).toHaveCount(0);

    // a phone with the decision on the page: Jo hoidossa and its follow-up row fit the screen too
    const phone = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const small = await phone.newPage();
    const seenSmall = watch(small);
    await small.goto("/#/optimise");
    await expect(small.getByRole("region", { name: "Jo hoidossa" }).locator(".outcome")).toContainText(/^Seuranta: Odottaa.+\./);
    await small.waitForLoadState("networkidle");
    await fitsScreen(small, "Jo hoidossa with its follow-up at 390px");

    await page.getByRole("button", { name: /^Peruuta päätös: Adobe/ }).click();
    await expect(page.getByRole("region", { name: "Jo hoidossa" })).toHaveCount(0);
    await overlap.getByRole("button", { name: "Muistuta myöhemmin" }).click();
    await overlap.getByRole("button", { name: "30 päivää" }).click();
    await expect(overlap).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Muistutukset" })).toContainText("Palaa");
    await page.getByRole("button", { name: /^Peruuta päätös: / }).click();
    await expect(overlap).toBeVisible();
    await fitsScreen(page, "Optimoi at 1366px");

    // the phone again, the decision undone: everything stacks, and each form and the calculation fit the screen
    await small.reload();
    const smallRise = small.locator("article.finding").filter({ hasText: "Adobe: hinta nousi" });
    await expect(smallRise).toBeVisible();
    await small.waitForLoadState("networkidle");
    await fitsScreen(small, "Optimoi at 390px");
    await smallRise.getByRole("button", { name: "Avaa laskelma" }).click();
    await expect(smallRise.getByText("Hinta ennen")).toBeVisible();
    await expect(smallRise.getByRole("img", { name: "Menot kuukausittain" })).toBeVisible();
    await fitsScreen(small, "an open calculation at 390px");
    const more = smallRise.getByRole("button", { name: /^Näytä kaikki / });
    if (await more.count()) await more.click();
    await smallRise.getByRole("button", { name: "Taulukko" }).click();
    await fitsScreen(small, "the rows and the table of months at 390px");
    for (const panel of ["Tein tämän", "Ei koske meitä", "Muistuta myöhemmin"]) {
      await smallRise.getByRole("button", { name: panel }).click();
      await fitsScreen(small, `${panel} at 390px`);
    }
    await expect(smallRise.getByRole("button", { name: "Ei koske meitä" })).toBeInViewport();
    expect(seenSmall.problems).toEqual([]);
    await phone.close();
    expect(seen.problems).toEqual([]);

    // switched off, the flags come with the page load: a reload hides the entry, and the address opens the overview
    expect((await flag(false)).ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Päävalikko" }).getByRole("link", { name: "Yleiskatsaus" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Päävalikko" }).getByRole("link", { name: "Optimoi" })).toHaveCount(0);
    await expect(page).toHaveTitle(/^Yleiskatsaus/);
  } finally {
    // the flag is back at its default, so the pages after this test see the app as shipped
    await flag(true);
  }
  await desktop.close();
});

test("sign out and back in", async ({ page }) => {
  const seen = watch(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Kirjaudu sisään" })).toBeVisible();
  await page.getByLabel("Käyttäjätunnus").fill(ADMIN.username);
  await page.getByLabel("Salasana").fill("väärä-salasana-1234");
  await page.getByRole("button", { name: "Kirjaudu" }).click();
  await expect(page.getByText("Väärä käyttäjätunnus tai salasana.")).toBeVisible();
  await page.getByLabel("Salasana").fill(ADMIN.password);
  await page.getByRole("button", { name: "Kirjaudu" }).click();
  await expect(page.getByRole("navigation").getByText("Yleiskatsaus").first()).toBeVisible();
  expect(seen.problems.filter((p) => !/HTTP 401: POST .*\/api\/auth\/login/.test(p) && !/Failed to load resource.*401/.test(p))).toEqual([]);
});

test("an expected bill is added on the reports page, is still there after a reload and can be removed", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports");
  const card = page.locator("#tulevat");
  await expect(card.getByRole("heading", { name: "Tulevat laskut" })).toBeVisible();
  const form = card.getByRole("form", { name: "Lisää odotettu lasku" });

  // a missing name is explained next to the form, nothing is sent
  await form.getByRole("button", { name: "Lisää lasku" }).click();
  await expect(form.getByText("Anna laskulle nimi.")).toBeVisible();

  const due = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
  await form.getByLabel("Nimi").fill("E2E-ajoneuvovero");
  await form.getByLabel("Summa").fill("312,50");
  await form.getByLabel("Eräpäivä").fill(due);
  await form.getByLabel("Toistuu").selectOption({ label: "vuosittain" });
  await form.getByRole("button", { name: "Lisää lasku" }).click();

  const remove = (p: Page) => p.locator("#tulevat").getByRole("button", { name: "Poista lasku E2E-ajoneuvovero" });
  await expect(remove(page)).toBeVisible();
  await expect(card.getByText(/^Varaa .* kuussa, harvinaiset laskut ovat .* vuodessa\.$/)).toBeVisible();

  await page.reload();
  await expect(remove(page)).toBeVisible();

  await remove(page).click();
  await expect(remove(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#tulevat").getByRole("form", { name: "Lisää odotettu lasku" })).toBeVisible();
  await expect(page.locator("#tulevat").getByText("E2E-ajoneuvovero")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});
