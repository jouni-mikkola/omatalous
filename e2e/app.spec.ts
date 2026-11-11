import { expect, type BrowserContext, type Page, test as base } from "@playwright/test";
import { join } from "node:path";
import { openCategoryPicker, overflow, unfold, watch } from "./helpers.ts";
import { startServer } from "./server.mjs";

const ADMIN = { username: "e2e-admin", displayName: "E2E Admin", password: "e2e-salasana-123456" };

// The first run needs a server nobody has set up, so this file starts one of its own. The servers of the other files
// have the administrator and the demo household made before their first spec (run.mjs); the tests below build on the
// two that make them here.
let app: Awaited<ReturnType<typeof startServer>>;
let STATE = "";
// (the hooks run with the auto fixtures too, so the address is asked for once before there is a server)
const test = base.extend({ baseURL: async ({}, use) => use(app?.base) });
test.beforeAll(async () => {
  app = await startServer();
  STATE = join(app.dir, "admin-state.json");
});
test.afterAll(() => app?.stop());

const PAGES = [
  ["overview", "Yhteenveto"],
  ["reports", "Kuukausi"],
  ["optimise", "Säästövinkit"],
  ["transactions", "Tapahtumat"],
  ["bills", "Laskut"],
  ["transactions?view=merchants", "Tapahtumat"],
  ["settings/banks", "Asetukset"],
  ["settings/server", "Asetukset"],
] as const;

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
  await expect(page.locator(".password-hint")).toContainText("vähintään 12 merkkiä");
  // a common password is refused with the reason, while typing and at the button
  await page.getByLabel("Salasana (vähintään 12 merkkiä)").fill("Salasana123456");
  await expect(page.locator(".password-hint")).toContainText("liian yleinen");
  await page.getByLabel("Salasana uudelleen").fill("Salasana123456");
  await page.getByRole("button", { name: "Luo ja kirjaudu" }).click();
  await expect(page.locator(".field-error").first()).toContainText("liian yleinen");

  await page.getByLabel("Asennuskoodi").fill("väärä-koodi");
  await page.getByLabel("Salasana (vähintään 12 merkkiä)").fill(ADMIN.password);
  await expect(page.locator(".password-hint")).not.toContainText("liian yleinen");
  await page.getByLabel("Salasana uudelleen").fill(ADMIN.password);
  await page.getByRole("button", { name: "Luo ja kirjaudu" }).click();
  await expect(page.locator(".field-error").first()).toBeVisible();

  await page.getByLabel("Asennuskoodi").fill(app.setupCode);
  await page.getByRole("button", { name: "Luo ja kirjaudu" }).click();
  await expect(page.getByRole("heading", { name: "Käyttöönotto" })).toBeVisible();

  // the wizard starts at Enable Banking: the address and schedule were saved with their defaults
  await expect(page.getByLabel("Vaiheet", { exact: true }).getByText("Osoite ja aikataulu")).toHaveCount(0);
  await expect(page.getByLabel("Vaiheet", { exact: true }).getByRole("listitem")).toHaveCount(2);
  // step 2 lists the fields of Enable Banking's form in its order, the values to copy in code, one button for all
  const fields = page.locator(".setup-steps li li");
  await expect(fields.locator(".eb-label")).toHaveText(["Environment", "Private key", "Application name", "Allowed redirect URLs", "Application description", "Email for data protection matters", "Privacy URL", "Terms URL"]);
  await expect(fields.filter({ hasText: "Allowed redirect URLs" }).locator("code.copyable")).toHaveText(/github\.io\/omatalous\/callback\/$/);
  await expect(fields.filter({ hasText: "Privacy URL" }).locator("code.copyable")).toHaveText(/github\.io\/omatalous\/privacy\/$/);
  await expect(fields.filter({ hasText: "Terms URL" }).locator("code.copyable")).toHaveText(/github\.io\/omatalous\/terms\/$/);
  await expect(fields.filter({ hasText: "Email for data protection matters" }).getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Avaa Enable Banking" })).toHaveAttribute("href", "https://enablebanking.com/cp/applications");
  await expect(page.getByRole("link", { name: "Avaa kirjautuminen" })).toHaveAttribute("href", "https://enablebanking.com/sign-in/");
  const checklist = page.getByLabel("Enable Banking -sovelluksen vaiheet");
  await expect(checklist.locator("li.done")).toHaveCount(0);
  await page.getByRole("button", { name: "Luo avain" }).click();
  await expect(checklist.getByText("Salausavain luotu")).toHaveClass(/done/);
  // the .pem option is behind "Muut vaihtoehdot"; the copy button works on plain http too
  await expect(page.getByRole("button", { name: "Minulla on .pem-tiedosto" })).toBeHidden();
  await page.getByText("Muut vaihtoehdot").click();
  await expect(page.getByRole("button", { name: "Minulla on .pem-tiedosto" })).toBeVisible();
  // one button copies the five values of the registration form
  await expect(page.getByRole("button", { name: "Kopioi", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Kopioi kaikki" }).click();
  await expect(page.getByRole("button", { name: "Kopioitu", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Jatka" }).click();
  await expect(page.getByText("Salausavain")).toBeVisible();
  await page.getByRole("button", { name: "Siirry sovellukseen" }).click();
  await expect(page.getByRole("navigation").getByText("Yhteenveto").first()).toBeVisible();
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
  await expect(page.getByText(/Ruoka|Asuminen|Palkka/).and(page.locator(":not(option)")).first()).toBeVisible({ timeout: 20_000 });
  expect(seen.problems).toEqual([]);
  await context.close();
});

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
        // (polled: a page may draw its frame a moment before its rows arrive)
        await expect.poll(async () => (await page.locator("main, .app").first().innerText()).length, { message: `${id} is empty` }).toBeGreaterThan(200);
        expect(await overflow(page), `${id} scrolls sideways at ${viewport.width}px`).toBeLessThanOrEqual(1);
        // no table is wider than the screen, also one that sits in a card that scrolls
        const wide = await page.evaluate(() => Array.from(document.querySelectorAll("table")).filter((t) => t.getBoundingClientRect().width > window.innerWidth + 1).length);
        expect(wide, `${id} has a table wider than the screen at ${viewport.width}px`).toBe(0);
        if (id === "overview") {
          // the page opens on the answer, then the month's pace and the findings, in that order
          const order = [".home-answer", ".home-pace", ".home-notable"];
          // the document order is the reading order of a phone and a screen reader; a wide screen sets the pace beside the findings, so only the answer is checked to stand on top
          const names = await page.evaluate((selectors) => {
            const found = selectors.map((s) => document.querySelector(s)!);
            return found.map((el, i) => (i === 0 || found[i - 1]!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING ? selectors[i] : `${selectors[i]} out of order`));
          }, order);
          expect(names, "the blocks stand in the order of the question").toEqual(order);
          const tops: number[] = [];
          for (const selector of order) tops.push((await page.locator(selector).first().boundingBox())!.y);
          expect(tops[0], "the answer is the topmost block").toBe(Math.min(...tops));
          // what belongs to Raportit and Tapahtumat is not here
          await expect(page.getByRole("heading", { name: "Menot kuukausittain" })).toHaveCount(0);
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

test("a period belongs to one page: Yhteenveto has no period, Raportit five, and an old address opens the page that has its period", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  const toolbar = page.getByRole("toolbar", { name: "Aikaväli" });
  const pressed = toolbar.locator("button[aria-pressed=true]");
  // Yhteenveto is always the running month: it has no switch and no toolbar, Raportit has the shell's toolbar
  await page.goto("/#/overview");
  await expect(page.getByRole("group", { name: "Kuukausi" })).toHaveCount(0);
  await expect(toolbar).toHaveCount(0);
  await page.goto("/#/reports?q=menot");
  await expect(toolbar.getByRole("button")).toHaveText(["3 kk", "6 kk", "12 kk", "Tämä vuosi", "Viime vuosi"]);
  await expect(pressed).toHaveText("12 kk");

  // the address is rewritten, so the old one is not in the history and the shown period is the one the address names
  const MOVED = [
    ["overview?period=3m", "reports?period=3m", /^Kuukausi/, "3 kk"],
    ["overview?period=6m", "reports?period=6m", /^Kuukausi/, "6 kk"],
    ["overview?period=12m", "reports?period=12m", /^Kuukausi/, "12 kk"],
    ["overview?period=year", "reports?period=year", /^Kuukausi/, "Tämä vuosi"],
    ["overview?period=last-year", "reports?period=last-year", /^Kuukausi/, "Viime vuosi"],
    ["reports?period=month", "overview?period=month", /^Yhteenveto/, null],
    ["reports?period=last-month", "overview?period=last-month", /^Yhteenveto/, null],
  ] as const;
  for (const [old, now, title, label] of MOVED) {
    await page.goto("/#/transactions");
    await page.goto(`/#/${old}`);
    await expect.poll(() => new URL(page.url()).hash, `${old} is rewritten`).toBe(`#/${now}`);
    await expect(page).toHaveTitle(title);
    if (label) await expect(pressed).toHaveText(label);
    await page.goBack();
    expect(page.url(), `Back from ${old} skips the old address`).toMatch(/#\/transactions$/);
  }
  // an address a page does not offer a period for opens the page's own default
  await page.goto("/#/reports?period=nonsense");
  await expect(pressed).toHaveText("12 kk");
  // a page whose figures do not depend on the period draws no switch
  for (const q of ["velat", "kuukausi"]) {
    await page.goto(`/#/reports?q=${q}`);
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
    await expect(toolbar, q).toHaveCount(0);
  }
  await page.goto("/#/reports?q=menot");
  await expect(toolbar).toHaveCount(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Kategoriat is the Kauppiaat tab of Tapahtumat: old addresses open it, the rules sit under the table, a period and Arkiostot narrow it", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  const hash = () => new URL(page.url()).hash;
  const rows = page.locator("table.merchant-table tbody tr");

  // the nav has no entry of its own any more
  await page.goto("/#/transactions");
  await expect(page.getByRole("navigation", { name: "Päävalikko" }).getByRole("link", { name: "Kategoriat" })).toHaveCount(0);

  // the old addresses are rewritten, so Back skips them; the rules ones end at the rules
  for (const [old, now] of [
    ["categories", "#/transactions?view=merchants"],
    ["categories?tab=merchants", "#/transactions?view=merchants"],
    ["categories?tab=rules", "#/transactions?view=merchants#saannot"],
    ["rules", "#/transactions?view=merchants#saannot"],
  ] as const) {
    await page.goto("/#/reports");
    await page.goto(`/#/${old}`);
    await expect.poll(hash, `${old} is rewritten`).toBe(now);
    await expect(page).toHaveTitle(/^Tapahtumat/);
    await expect(page.getByRole("heading", { name: "Kauppiaat" })).toBeVisible();
    await page.goBack();
    expect(page.url(), `Back from ${old} skips the old address`).toMatch(/#\/reports$/);
  }

  // the rules address opens at the rules card, below a table that is longer than the screen
  await page.goto("/#/reports");
  await page.goto("/#/rules");
  const rules = page.getByRole("heading", { name: "Säännöt" });
  await expect(rules).toBeInViewport();
  await page.goto("/#/transactions?view=merchants");
  await expect(rows.first()).toBeVisible();
  // only the hash changed, so the page is still scrolled to the rules
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(rules).not.toBeInViewport();
  const [tableBox, rulesBox] = [await page.locator("table.merchant-table").boundingBox(), await rules.boundingBox()];
  expect(rulesBox!.y, "the rules are under the table").toBeGreaterThan(tableBox!.y + tableBox!.height);
  await expect(page.locator("table.merchant-table thead th")).toHaveText(["Kauppias", "Kategoria", "Tapahtumia", "Yhteensä", "Kuussa", "Viimeksi"]);
  for (const cell of await page.locator("table.merchant-table td[data-label=Kuussa]").allInnerTexts()) expect(cell.trim(), "Kuussa is euros or a dash").toMatch(/€|–/);
  const all = await rows.count();

  // the tabs: Lista is the list, and a period carries over to it
  await page.getByRole("button", { name: "Lista", exact: true }).click();
  await expect(page).toHaveURL(/#\/transactions$/);
  await expect(page.getByRole("heading", { name: "Luokittelematta" }).or(page.getByRole("region", { name: "Tapahtumat" })).first()).toBeVisible();
  await page.goto("/#/transactions?view=merchants&from=2026-01-01&to=2026-03-31");
  await page.getByRole("button", { name: "Lista", exact: true }).click();
  await expect(page).toHaveURL(/#\/transactions\?from=2026-01-01&to=2026-03-31$/);

  // a period leaves out the merchants it has no rows of, and the merchant link keeps it
  await page.goto("/#/transactions?view=merchants&from=2000-01-01&to=2000-12-31");
  await expect(page.getByText("Ei kauppiaita näillä rajauksilla.")).toBeVisible();
  await expect(rows).toHaveCount(0);
  await page.getByRole("button", { name: "Tyhjennä" }).click();
  await expect.poll(hash).toBe("#/transactions?view=merchants");
  await expect(rows).toHaveCount(all);
  const today = new Date().toISOString().slice(0, 10);
  await page.goto(`/#/transactions?view=merchants&from=${today.slice(0, 4)}-01-01`);
  await expect(rows.first()).toBeVisible();
  await expect(rows.first().locator(".m-name a")).toHaveAttribute("href", new RegExp(`#/transactions\\?merchant=.*&from=${today.slice(0, 4)}-01-01$`));

  // a row of money in only carries no number and does not count: the other rows keep the counter
  await page.goto("/#/transactions?view=merchants");
  await expect(rows.first()).toBeVisible();
  const ordinals = await rows.evaluateAll((trs) =>
    trs.map((tr) => ({
      unranked: tr.classList.contains("unranked"),
      moneyIn: (tr.querySelector('td[data-rt="main"]')?.textContent ?? "").startsWith("+"),
      // a row that opens draws its number inside .rt-lead, in line with the chevron and the name
      mark: getComputedStyle((tr.firstElementChild?.querySelector(":scope > .rt-lead") ?? tr.firstElementChild) as Element, "::before").content,
    })),
  );
  expect(ordinals.every((r) => r.unranked === r.moneyIn), "only a row of money in is unranked").toBe(true);
  ordinals.filter((r) => !r.unranked).forEach((r, i) => expect(r.mark, `row ${i + 1}`).toContain("counter(rank)"));
  for (const r of ordinals.filter((x) => x.unranked)) expect(r.mark).toBe('""');

  // Arkiostot are the everyday purchases of the recurring detection
  const series: { merchant: string; kind: string; active: boolean }[] = (await (await context.request.get("/api/recurring")).json()).series;
  const habits = new Set(series.filter((r) => r.kind === "habit" && r.active).map((r) => r.merchant));
  expect(habits.size, "the demo has everyday purchases").toBeGreaterThan(0);
  await page.goto("/#/transactions?view=merchants");
  await expect(rows.first()).toBeVisible();
  // the page has no switch for them: only the address sets the filter, and the chip is shown while it is on
  await expect(page.getByRole("group", { name: "Kauppiaiden rajaus" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Poista rajaus: Arkiostot" })).toHaveCount(0);
  await page.goto("/#/transactions?view=merchants&habit=1");
  const chip = page.getByRole("button", { name: "Poista rajaus: Arkiostot" });
  await expect(chip).toBeVisible();
  await expect.poll(() => rows.count()).toBeLessThan(all);
  const shown = await rows.locator(".m-name a").allInnerTexts();
  expect(shown.length).toBeGreaterThan(0);
  for (const name of shown) expect(habits.has(name.trim()), `${name} is an everyday purchase`).toBe(true);
  // its × shows every merchant again
  await chip.click();
  await expect.poll(hash).toBe("#/transactions?view=merchants");
  await expect(chip).toHaveCount(0);
  await expect.poll(() => rows.count()).toBe(all);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the merchants of the month on Tapahtumat, and a merchant there has a summary of its whole history", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  // Yhteenveto no longer links the merchants (VC1): the view is Tapahtumat's own
  await page.goto("/#/transactions?view=merchants");
  // The address changes at the click, a few ms before the page does, and the Overview has merchant links of its own
  // (an income series, in a table): "tbody a" can still find one of those. Look only in the merchant table.
  const link = page.locator(".merchant-table tbody a[href*='merchant=']").first();
  await expect(link).toBeVisible();
  // a closed row only reads its category: the picker is in the opened row
  await expect(page.locator(".merchant-table select, .merchant-table .select-lite")).toHaveCount(0);
  await page.locator(".merchant-table").getByRole("button", { name: /^Avaa / }).first().click();
  await expect(page.locator(".merchant-table .select-lite")).toHaveCount(1);
  // the opened detail takes no rank number, so the payees below it keep theirs
  await expect(page.locator(".merchant-table tbody tr.rt-detail")).toHaveCSS("counter-increment", "none");
  const merchant = (await link.innerText()).trim();
  await link.click();
  // the link that was read is the one that opened
  await expect(page).toHaveURL((url) => new URLSearchParams(url.hash.split("?")[1]).get("merchant") === merchant);
  const summary = page.getByRole("region", { name: `Yhteenveto: ${merchant}` });
  await expect(summary).toBeVisible();
  await expect(summary.getByRole("heading", { name: merchant })).toBeVisible();
  for (const term of ["Ensimmäinen", "Viimeisin"]) await expect(summary.getByText(term, { exact: true })).toBeVisible();
  // the list below is the same merchant
  await expect(page.locator("tbody tr").first()).toBeVisible();
  // the strip above states the filtered sums; the card's whole history stands once, and not at all when the merchant is
  // the only filter (the strip then says the same)
  const strip = page.getByRole("region", { name: "Rajattujen tapahtumien summat" });
  await expect(strip.getByText("Rahaa ulos", { exact: true })).toBeVisible();
  for (const term of ["Menot yhteensä", "Tulot yhteensä", "Maksuja"]) expect(await page.getByText(term, { exact: true }).count()).toBeLessThanOrEqual(1);
  await page.goto(`/#/transactions?merchant=${encodeURIComponent(merchant)}`);
  await expect(summary.getByRole("heading", { name: merchant })).toBeVisible();
  for (const term of ["Menot yhteensä", "Tulot yhteensä", "Maksuja"]) await expect(summary.getByText(term, { exact: true })).toHaveCount(0);
  // without a merchant filter there is no summary, and the strip holds the figures, once each
  await page.goto("/#/transactions");
  await expect(page.getByRole("region", { name: /^Yhteenveto:/ })).toHaveCount(0);
  for (const term of ["Rahaa ulos", "Rahaa sisään", "Erotus"]) await expect(page.getByText(term, { exact: true })).toHaveCount(1);
  await expect(page.getByText(/omia siirtoja ei lasketa/)).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("an empty Tapahtumat says so: with a filter that it matches nothing, without one with the way to a bank", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  // a household with no rows at all: the list's answer is empty whatever the address asks
  await page.route("**/api/transactions?*", (route) => route.fulfill({ json: { total: 0, inCents: 0, outCents: 0, items: [] } }));
  await page.goto("/#/transactions");
  const empty = page.locator(".tx-card .empty");
  await expect(empty).toHaveText(/^Tapahtumia ei vielä ole\.\s*Yhdistä pankki, niin tapahtumat tulevat tähän\.$/);
  await expect(empty.getByRole("link", { name: "Yhdistä pankki" })).toHaveAttribute("href", "#/settings/banks?add=1");
  // no figures for nothing
  await expect(page.getByText("Tapahtumia", { exact: true })).toHaveCount(0);
  await page.goto("/#/transactions?q=zzzz");
  await expect(empty).toHaveText(/^Näillä rajauksilla ei ole tapahtumia\.\s*Tyhjennä rajaukset$/);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a changed category is kept after a reload", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/transactions");
  const rows = page.locator("tbody tr:not(.rt-group):not(.rt-detail):not(.rt-spacer)");
  await expect(rows.first()).toBeVisible();

  // pick a row that was categorised by rule so that "käsin" (by hand) is new after the change
  const row = rows.filter({ hasNot: page.locator(".tx-chip-manual") }).filter({ hasNotText: /Omat siirrot|Luottokortin lasku|Luotonnostot/ }).first();
  const merchant = (await row.locator(".tx-name").innerText()).trim();
  const before = (await row.locator(".tx-category .tx-chip-label").innerText()).trim();
  // the category is changed in the opened row
  await row.getByRole("button", { name: `Avaa ${merchant}: 12 kuukautta` }).click();
  await openCategoryPicker(page, merchant, before);
  // the picker is a list of our own, not a native select
  const target = before === "Lemmikit" ? "Rahapelit" : "Lemmikit";
  await page.getByRole("dialog", { name: `Kategoria: ${merchant}` }).getByRole("option", { name: target }).click();
  // "Siirsimme N tapahtumaa kategoriaan" confirms the save
  await expect(page.getByText(/Siirsimme .* kategoriaan/)).toBeVisible();

  await page.reload();
  const same = rows.filter({ has: page.locator(".tx-name", { hasText: merchant }) }).filter({ has: page.locator(".tx-category .tx-chip-label", { hasText: target }) });
  await expect(same.first()).toBeVisible();
  // "käsin" is the dot on the chip, its word for readers
  await expect(same.first().locator(".tx-chip-manual")).toBeAttached();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Menot kuukausittain is a heat table under its name, keeps the CSV, and 390 px does not scroll sideways", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=menot");
  await unfold(page, "kuukaudet");
  const card = page.locator("#kuukaudet", { has: page.getByRole("heading", { name: "Menot kuukausittain" }) });
  await expect(card.locator("table.heat-table tbody tr").first()).toBeVisible();
  await expect(card.getByRole("link", { name: "Lataa taulukko (CSV)" })).toBeVisible();
  expect(await card.evaluate((c) => c.scrollWidth <= c.clientWidth + 1), "the table fits its card at 390px").toBe(true);
  expect(seen.problems).toEqual([]);
  await context.close();
});

/** The page is no wider than the screen, and no table sticks out of it or scrolls sideways inside its card. */
async function fitsScreen(page: Page, what: string): Promise<void> {
  expect(await overflow(page), `${what} scrolls sideways`).toBeLessThanOrEqual(1);
  const wide = await page.evaluate(() => Array.from(document.querySelectorAll("table")).filter((t) => t.getBoundingClientRect().width > window.innerWidth + 1).length);
  expect(wide, `${what} has a table wider than the screen`).toBe(0);
  const clipped = await page.evaluate(() => Array.from(document.querySelectorAll(".rt-wrap")).filter((w) => w.scrollWidth > w.clientWidth + 1).length);
  expect(clipped, `${what} has a table that scrolls sideways in its card`).toBe(0);
}

test("Säästövinkit without tips shows no sum", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 } });
  try {
    // the server's answer is emptied here because the demo household always has tips
    await context.route(/\/api\/optimise(\?|$)/, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const areas = body.data.areas.map((a: { findings: unknown[] }) => ({ ...a, findings: [] }));
      await route.fulfill({ response, json: { ...body, data: { ...body.data, areas, soon: [], headline: { ...body.data.headline, count: 0, midCents: 0, lowCents: 0, highCents: 0 } } } });
    });
    const page = await context.newPage();
    await page.goto("/#/optimise");
    const lead = page.getByRole("region", { name: "Säästövinkit lyhyesti" });
    await expect(lead).toContainText("Ei vinkkejä juuri nyt");
    await expect(lead).not.toContainText("€");
  } finally {
    await context.close();
  }
});

test("Säästövinkit: a demo finding is listed, decisions survive a reload with their follow-up, and everything fits a phone", async ({ browser }) => {
  const desktop = await browser.newContext({ storageState: STATE, viewport: { width: 1366, height: 800 } });
  const page = await desktop.newPage();
  const seen = watch(page);
  {
    await page.goto("/#/optimise");
    await expect(page).toHaveTitle(/^Säästövinkit/);
    await expect(page.getByRole("navigation", { name: "Päävalikko" }).getByRole("link", { name: "Säästövinkit" })).toBeVisible();
    await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });

    // the lead strip opens on the euros a year of the tips; what was checked is told further down, behind one line per area
    const lead = page.getByRole("region", { name: "Säästövinkit lyhyesti" });
    const found = lead.locator(".kf", { has: page.getByText("Arvioitu säästö vuodessa", { exact: true }) }).locator(".fig");
    await expect(found).toHaveText(/^\d[\d\s]*€$/);
    await expect(lead.getByText("Tarkistimme", { exact: true })).toHaveCount(0);
    // a tile shows only with something to say: the demo has no deadline in 60 days and no confirmed change
    for (const tile of ["Seuraava määräpäivä", "Vahvistettu säästö"]) await expect(lead.getByText(tile, { exact: true })).toHaveCount(0);
    // what the numbers rest on and what waits are not told on the page, and no area is a list of nothing
    for (const gone of [/^Tiedot \d+\.\d+\.\d{4} asti/, /^Laskettu /, /^Odottaa tietoja/]) await expect(page.getByText(gone)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Tietojen laatu" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Alueet", exact: true })).toHaveCount(0);
    await expect(page.locator("details", { has: page.locator("summary", { hasText: /Tarkistet|ilman vinkkejä|Odottaa/ }) })).toHaveCount(0);

    // the demo history has a software price rise and two video services at once
    const cards = page.locator("article.tip");
    const rise = cards.filter({ hasText: "Adobe: hinta nousi" });
    const overlap = cards.filter({ hasText: "videopalvelua yhteensä" });
    await expect(rise).toBeVisible();
    await expect(overlap).toBeVisible();
    await expect(rise).toContainText(/144\s€\s*vuodessa/);
    // the certainty is told only when it is not high, as a badge with its reason
    await expect(rise).not.toContainText("Varmuus");
    await expect(overlap.locator(".tip-meta .certainty")).toHaveText("Arvio on suuntaa antava");
    await expect(overlap.locator(".tip-reason")).toHaveText(/.+/);

    // the calculation opens from the figure, with no key of words: its lines, the months as bars with their table under them, and a way to check the categories
    await expect(rise.getByRole("button", { name: "Avaa laskelma" })).toHaveCount(0);
    await rise.getByRole("button", { name: /\. Näytä laskelma$/ }).click();
    await expect(rise.getByText("Nousu vuodessa")).toBeVisible();
    await expect(rise.getByRole("img", { name: "Menot kuukausittain" })).toBeVisible();
    await expect(rise.locator("th", { hasText: "Kuukausi" })).toBeVisible();
    await expect(rise.getByRole("link", { name: "Adobe", exact: true })).toHaveAttribute("href", /#\/transactions\?merchant=Adobe/);
    await rise.getByRole("button", { name: /\. Näytä laskelma$/ }).click();
    await expect(rise.getByText("Nousu vuodessa")).toHaveCount(0);

    // Ei koske meitä takes the finding out of its area and the headline to Päätetyt, and the choice stays after a reload
    const title = (await overlap.locator(".tip-title").innerText()).trim();
    const before = await found.innerText();
    await overlap.getByRole("button", { name: "Päätä" }).click();
    await overlap.getByRole("button", { name: "Ei koske meitä" }).click();
    await overlap.getByRole("button", { name: "Tarvitsen tämän" }).click();
    const decided = page.getByRole("region", { name: "Päätetyt" });
    await expect(decided).toContainText(title);
    await expect(decided).toContainText("Ohitettu · Tarvitsen tämän");
    // the card the keyboard was on is gone: focus is on the message
    await expect(page.getByRole("status").filter({ hasText: "Siirsimme vinkin kohtaan Päätetyt." })).toBeFocused();
    await expect(overlap).toHaveCount(0);
    // the euros of the headline are one tip fewer
    await expect(found).not.toHaveText(before);

    await page.reload();
    await expect(rise).toBeVisible();
    await expect(overlap).toHaveCount(0);
    await expect(decided).toContainText(title);

    // taking the decision back returns the finding
    await page.getByRole("button", { name: `Peruuta päätös: ${title}` }).click();
    await expect(overlap).toBeVisible();
    await expect(decided).toHaveCount(0);

    // Merkitse tehdyksi keeps its date, and Muistuta myöhemmin hides the finding until then
    await rise.getByRole("button", { name: "Päätä" }).click();
    await rise.getByRole("button", { name: "Merkitse tehdyksi" }).click();
    await rise.getByRole("button", { name: "Tallenna" }).click();
    await expect(decided).toContainText("Adobe: hinta nousi");
    await expect(rise).toHaveCount(0);
    await page.reload();
    const done = decided.getByRole("listitem").filter({ hasText: "Adobe: hinta nousi" });
    await expect(done).toContainText(/Tehty \d+\.\d+\.\d{4}/);
    // the follow-up judges the change once complete months show it: made today, it waits
    const followUp = page.getByRole("region", { name: "Muutosten säästö" });
    await expect(followUp.locator("tr", { hasText: "Adobe" })).toContainText("Odottaa kuukausia");
    // one visit makes one snapshot: no line and no changes yet
    await expect(followUp.getByRole("heading", { name: "Arvioitu ja vahvistettu" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Muutokset viime käynnin jälkeen" })).toHaveCount(0);

    // a phone with the decision on the page: Päätetyt and its follow-up row fit the screen too
    const phone = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const small = await phone.newPage();
    const seenSmall = watch(small);
    await small.goto("/#/optimise");
    await expect(small.getByRole("region", { name: "Muutosten säästö" })).toContainText("Odottaa kuukausia");
    await small.waitForLoadState("networkidle");
    await fitsScreen(small, "Päätetyt with its follow-up at 390px");

    await page.getByRole("button", { name: /^Peruuta päätös: Adobe/ }).click();
    await expect(decided).toHaveCount(0);
    await overlap.getByRole("button", { name: "Päätä" }).click();
    await overlap.getByRole("button", { name: "Muistuta myöhemmin" }).click();
    await overlap.getByRole("button", { name: "30 päivää" }).click();
    await expect(overlap).toHaveCount(0);
    await expect(decided).toContainText(/Muistutus \d+\.\d+\.\d{4}/);
    await page.getByRole("button", { name: /^Peruuta päätös: / }).click();
    await expect(overlap).toBeVisible();
    await fitsScreen(page, "Säästövinkit at 1366px");

    // the phone again, the decision undone: everything stacks, and each form and the calculation fit the screen
    await small.reload();
    const smallRise = small.locator("article.tip").filter({ hasText: "Adobe: hinta nousi" });
    await expect(smallRise).toBeVisible();
    await small.waitForLoadState("networkidle");
    // the first tip's title is on the first screen of a phone, with no scrolling
    await expect(small.locator("article.tip .tip-title").first()).toBeInViewport({ ratio: 1 });
    await fitsScreen(small, "Säästövinkit at 390px");
    await smallRise.getByRole("button", { name: /\. Näytä laskelma$/ }).click();
    await expect(smallRise.getByText("Nousu vuodessa")).toBeVisible();
    await expect(smallRise.getByRole("img", { name: "Menot kuukausittain" })).toBeVisible();
    await fitsScreen(small, "an open calculation at 390px");
    // a tip has one key at rest; Päätä shows the answers
    await expect(smallRise.locator(".finding-actions button")).toHaveCount(1);
    await smallRise.getByRole("button", { name: "Päätä" }).click();
    await expect(smallRise.getByRole("button", { name: "Merkitse tehdyksi" })).toBeVisible();
    const more = smallRise.getByRole("button", { name: /^Näytä kaikki / });
    if (await more.count()) await more.click();
    await fitsScreen(small, "the rows and the table of months at 390px");
    for (const panel of ["Merkitse tehdyksi", "Ei koske meitä", "Muistuta myöhemmin"]) {
      await smallRise.getByRole("button", { name: panel }).click();
      await fitsScreen(small, `${panel} at 390px`);
    }
    await expect(smallRise.getByRole("button", { name: "Ei koske meitä" })).toBeInViewport();
    expect(seenSmall.problems).toEqual([]);
    await phone.close();
    expect(seen.problems).toEqual([]);
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
  await expect(page.getByLabel("Käyttäjätunnus")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Salasana")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Salasana").fill(ADMIN.password);
  await page.getByRole("button", { name: "Kirjaudu" }).click();
  await expect(page.getByRole("navigation").getByText("Yhteenveto").first()).toBeVisible();
  expect(seen.problems.filter((p) => !/HTTP 401: POST .*\/api\/auth\/login/.test(p) && !/Failed to load resource.*401/.test(p))).toEqual([]);
});

test("the Laskut page fits a phone: the timeline and the table are inside the screen at 390 px, in at most 3000 px", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/bills");
  await expect(page.getByRole("heading", { name: "Laskut, sopimukset ja tilaukset" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  // a table wider than its card scrolls sideways inside the card and clips the last column
  const clipped = await page.evaluate(() => Array.from(document.querySelectorAll(".rt-wrap")).filter((w) => w.scrollWidth > w.clientWidth + 1).length);
  expect(clipped, "tables that scroll sideways").toBe(0);
  await fitsScreen(page, "Laskut");
  expect(await page.evaluate(() => document.documentElement.scrollHeight), "page height at 390 px").toBeLessThanOrEqual(3000);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the Laskut page at 1440 px is at most 1800 px tall and does not scroll sideways", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/bills");
  await expect(page.getByRole("heading", { name: "Laskut, sopimukset ja tilaukset" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => document.documentElement.scrollHeight), "page height at 1440 px").toBeLessThanOrEqual(1800);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("an expected bill is added at the head of Tulossa, shows in its one table, is still there after a reload and can be removed", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/bills");
  const coming = page.locator("#tulossa");
  const table = page.locator("#laskut-taulukko");
  await expect(coming.getByRole("heading", { name: "Tulevat maksut" })).toBeVisible();
  // the form is a dialog behind the button: it pushes nothing down
  await expect(page.getByRole("dialog", { name: "Lisää lasku" })).toHaveCount(0);
  const tableTop = (await table.boundingBox())!.y;
  await coming.getByRole("button", { name: "Lisää lasku" }).click();
  const form = page.getByRole("dialog", { name: "Lisää lasku" });
  expect((await table.boundingBox())!.y, "the table stays where it was").toBe(tableTop);

  // a missing name is explained next to the form, nothing is sent
  await form.getByRole("button", { name: "Lisää lasku" }).click();
  await expect(form.getByText("Anna laskulle nimi.")).toBeVisible();

  // due within the 30 days of the list, so it is in the list as well as among the bills typed in
  const due = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10);
  await form.getByLabel("Nimi").fill("E2E-ajoneuvovero");
  await form.getByLabel("Summa").fill("312,50");
  await form.getByLabel("Eräpäivä").fill(due);
  await form.getByLabel("Toistuu").selectOption({ label: "vuosittain" });
  await form.getByRole("button", { name: "Lisää lasku" }).click();

  await expect(page.getByRole("dialog", { name: "Lisää lasku" })).toHaveCount(0);
  await expect(coming.getByText("Lasku E2E-ajoneuvovero lisätty.")).toBeVisible();
  await expect(table.locator("tbody tr").filter({ has: page.locator("button.rt-drill") }).filter({ hasText: "E2E-ajoneuvovero" })).toContainText("Lisätty käsin");
  const remove = (p: Page) => p.locator("#laskut-taulukko").getByRole("button", { name: "Poista lasku E2E-ajoneuvovero" });
  const open = (p: Page) => p.locator("#laskut-taulukko").getByRole("button", { name: "Tiedot: E2E-ajoneuvovero" });
  await open(page).click();
  await expect(remove(page)).toBeVisible();

  await page.reload();
  await expect(open(page)).toBeVisible();

  await open(page).click();
  await remove(page).click();
  await page.getByRole("dialog", { name: "Poista lasku E2E-ajoneuvovero?" }).getByRole("button", { name: "Poista lasku" }).click();
  await expect(open(page)).toHaveCount(0);
  await expect(page.locator("#tulossa").getByText("E2E-ajoneuvovero")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#tulossa").getByRole("button", { name: "Lisää lasku" })).toBeVisible();
  await expect(page.getByText("E2E-ajoneuvovero")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Toistuvat is Laskut: the old address opens the new page, and Yhteenveto links to its list", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  const nav = page.getByRole("navigation", { name: "Päävalikko" });

  // the address is rewritten, so Back does not return to the old one
  await page.goto("/#/transactions");
  await page.goto("/#/recurring");
  await expect.poll(() => new URL(page.url()).hash).toBe("#/bills");
  await expect(page).toHaveTitle(/^Laskut/);
  await expect(page.locator("#tulossa").getByRole("heading", { name: "Tulevat maksut" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Laskut" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Toistuvat" })).toHaveCount(0);
  await page.goBack();
  expect(page.url()).toMatch(/#\/transactions$/);

  // what the page holds: the 30 days with their sums and the one table with the fixed costs, and no old tile or list
  await page.goto("/#/bills");
  for (const heading of ["Tulevat maksut", "Laskut, sopimukset ja tilaukset"]) await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await expect(page.locator("#laskut-taulukko .card-datum")).toContainText("/kk");
  for (const gone of ["Seuraavaksi erääntyy", "Tilaukset", "Sopimukset ja laskut", "Harvoin tulevat laskut", "Tulevat laskut", "Hinnanmuutokset"]) await expect(page.getByRole("heading", { name: gone, exact: true })).toHaveCount(0);
  await page.goto("/#/reports?q=kiinteat");
  await expect(page.getByRole("heading", { name: "Kiinteät ja muuttuvat" })).toBeVisible();
  // the price changes of the fixed costs are a section of this report since BA-9; Laskut has none (checked above)
  await expect(page.locator("#kiinteat-hinnat").getByRole("heading", { name: "Hinnanmuutokset" })).toBeVisible();

  // Yhteenveto lists the payments and sends on to Laskut
  await page.goto("/#/overview");
  // the payments are opened by Näytä maksut and the list sends on to Laskut
  await page.getByRole("button", { name: "Näytä maksut" }).click();
  await page.getByRole("link", { name: "Laskut", exact: true }).first().click();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/bills");
  await expect(page.locator("#tulossa").getByRole("heading", { name: "Tulevat maksut" })).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});
