import { expect, type BrowserContext, type Page, test } from "@playwright/test";
import { join } from "node:path";

const SETUP_CODE = process.env.E2E_SETUP_CODE ?? "";
const ADMIN = { username: "e2e-admin", displayName: "E2E Admin", password: "e2e-salasana-123456" };
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

const PAGES = [
  ["overview", "Yleiskatsaus"],
  ["reports", "Raportit"],
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
  // "Vain tämä yksi tapahtuma muuttui" or "N tapahtumaa siirrettiin" confirms the save
  await expect(page.getByText(/siirrettiin kategoriaan/)).toBeVisible();

  await page.reload();
  const same = page.locator("tbody tr").filter({ has: page.getByRole("button", { name: new RegExp(`^Kategoria: ${merchant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, nyt ${target}`) }) });
  await expect(same.first()).toBeVisible();
  // the row has a phone and a desktop copy of its badge, one of them is hidden by CSS
  await expect(same.first().locator(".badge", { hasText: "käsin" }).first()).toBeAttached();
  expect(seen.problems).toEqual([]);
  await context.close();
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
