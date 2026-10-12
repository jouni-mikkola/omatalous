import { expect, type BrowserContext, type Page, test as base } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";
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
  ["reports", "Raportit"],
  ["optimise", "Säästövinkit"],
  ["transactions", "Tapahtumat"],
  ["bills", "Laskut"],
  ["transactions?view=merchants", "Tapahtumat"],
  ["settings", "Asetukset"],
  ["settings?section=technical", "Asetukset"],
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
  await page.getByLabel("Salasana uudelleen").fill("lyhyt");
  await page.getByRole("button", { name: "Luo ja kirjaudu" }).click();
  await expect(page.getByText("Vähintään 12 merkkiä.")).toBeVisible();

  await page.getByLabel("Asennuskoodi").fill("väärä-koodi");
  await page.getByLabel("Salasana (vähintään 12 merkkiä)").fill(ADMIN.password);
  await page.getByLabel("Salasana uudelleen").fill(ADMIN.password);
  await page.getByRole("button", { name: "Luo ja kirjaudu" }).click();
  await expect(page.locator(".error").first()).toBeVisible();

  await page.getByLabel("Asennuskoodi").fill(app.setupCode);
  await page.getByRole("button", { name: "Luo ja kirjaudu" }).click();
  await expect(page.getByRole("heading", { name: "Käyttöönotto" })).toBeVisible();

  // the wizard starts at Enable Banking: the address and schedule were saved with their defaults
  await expect(page.getByLabel("Vaiheet", { exact: true }).getByText("Osoite ja aikataulu")).toHaveCount(0);
  await expect(page.getByLabel("Vaiheet", { exact: true }).getByRole("listitem")).toHaveCount(2);
  // step 2 lists the fields of Enable Banking's form in its order, each value with its own copy button
  const fields = page.locator(".setup-steps li li");
  await expect(fields.locator(".eb-label")).toHaveText(["Environment", "Private key", "Application name", "Allowed redirect URLs", "Application description", "Email for data protection matters", "Privacy URL", "Terms URL"]);
  await expect(fields.filter({ hasText: "Allowed redirect URLs" }).locator("code.copyable")).toHaveText(/github\.io\/omatalous\/callback\/$/);
  await expect(fields.filter({ hasText: "Privacy URL" }).locator("code.copyable")).toHaveText(/github\.io\/omatalous\/privacy\/$/);
  await expect(fields.filter({ hasText: "Terms URL" }).locator("code.copyable")).toHaveText(/github\.io\/omatalous\/terms\/$/);
  await expect(fields.filter({ hasText: "Email for data protection matters" }).getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Avaa Enable Banking" })).toHaveAttribute("href", "https://enablebanking.com/cp/applications");
  await expect(page.getByText("Jos sinulla ei ole tiliä, luo se ensin.")).toBeVisible();
  const checklist = page.getByLabel("Enable Banking -sovelluksen vaiheet");
  await expect(checklist.locator("li.done")).toHaveCount(0);
  await page.getByRole("button", { name: "Luo avain" }).click();
  await expect(checklist.getByText("Avain luotu")).toHaveClass(/done/);
  // the .pem option is behind "Muut vaihtoehdot"; the copy button works on plain http too
  await expect(page.getByRole("button", { name: "Minulla on .pem-tiedosto" })).toBeHidden();
  await page.getByText("Muut vaihtoehdot").click();
  await expect(page.getByRole("button", { name: "Minulla on .pem-tiedosto" })).toBeVisible();
  await page.getByRole("button", { name: "Kopioi Allowed redirect URLs" }).click();
  await expect(page.getByRole("button", { name: "Kopioitu Allowed redirect URLs" })).toBeVisible();
  await page.getByRole("button", { name: "Ohita" }).click();
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
  await expect(page.getByText(/Ruoka|Asuminen|Palkka/).first()).toBeVisible({ timeout: 20_000 });
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
        expect((await page.locator("main, .app").first().innerText()).length, `${id} is empty`).toBeGreaterThan(200);
        expect(await overflow(page), `${id} scrolls sideways at ${viewport.width}px`).toBeLessThanOrEqual(1);
        // no table is wider than the screen, also one that sits in a card that scrolls
        const wide = await page.evaluate(() => Array.from(document.querySelectorAll("table")).filter((t) => t.getBoundingClientRect().width > window.innerWidth + 1).length);
        expect(wide, `${id} has a table wider than the screen at ${viewport.width}px`).toBe(0);
        if (id === "overview") {
          // the days to the payday come first, then the month with its pace
          const month = page.getByRole("region", { name: "Tulot ja menot", exact: true });
          const pace = month.getByRole("heading", { name: "Menojen kertymä" });
          await expect(pace).toBeVisible();
          await expect(month.getByText(/\d+\.\d+\. mennessä/).first()).toBeVisible();
          const ahead = page.getByRole("heading", { name: "Erääntyvät maksut", exact: true });
          await expect(ahead).toBeVisible();
          const [monthBox, aheadBox] = [await month.boundingBox(), await ahead.boundingBox()];
          expect(aheadBox!.y, "the days to the payday are above the month").toBeLessThan(monthBox!.y);
          // on a desktop the categories stand beside the figures and the chart, on a phone they come after the chart
          const [figures, bars] = [await month.getByRole("link", { name: "Menot", exact: true }).boundingBox(), await month.getByRole("heading", { name: "Menot kategorioittain" }).boundingBox()];
          if (device === "desktop") expect(bars!.x, "side by side").toBeGreaterThan(figures!.x + figures!.width);
          else expect(bars!.y, "stacked").toBeGreaterThan((await pace.boundingBox())!.y);
          // the month columns and the merchants left the page: a link each
          await expect(page.getByRole("heading", { name: "Menot kuukausittain" })).toHaveCount(0);
          await expect(page.getByRole("link", { name: "Menot kuukausittain" })).toBeVisible();
          await expect(page.getByRole("link", { name: "Kauppiaat" })).toBeVisible();
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

test("a period belongs to one page: Yhteenveto offers two months, Raportit five, and an old address opens the page that has its period", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  const toolbar = page.getByRole("toolbar", { name: "Aikaväli" });
  const pressed = toolbar.locator("button[aria-pressed=true]");
  // Yhteenveto draws its own switch in the block it changes, Raportit has the shell's toolbar
  const months = page.getByRole("group", { name: "Kuukausi" });
  const pressedMonth = months.locator("button[aria-pressed=true]");
  // the two months are named by the server's own day: "Lokakuu 2026" and the one before it
  const { today } = (await (await context.request.get("/api/meta")).json()) as { today: string };
  const monthName = (back: number) => {
    const at = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - back, 1));
    const name = new Intl.DateTimeFormat("fi-FI", { month: "long", year: "numeric", timeZone: "UTC" }).format(at);
    return name.charAt(0).toUpperCase() + name.slice(1);
  };
  const [thisMonth, lastMonth] = [monthName(0), monthName(1)];

  await page.goto("/#/overview");
  await expect(months.getByRole("button")).toHaveText([thisMonth, lastMonth]);
  await expect(pressedMonth).toHaveText(thisMonth);
  await expect(toolbar).toHaveCount(0);
  await page.goto("/#/reports");
  await expect(toolbar.getByRole("button")).toHaveText(["3 kk", "6 kk", "12 kk", "Tämä vuosi", "Viime vuosi"]);
  await expect(pressed).toHaveText("12 kk");

  // the address is rewritten, so the old one is not in the history and the shown period is the one the address names
  const MOVED = [
    ["overview?period=3m", "reports?period=3m", /^Raportit/, "3 kk"],
    ["overview?period=6m", "reports?period=6m", /^Raportit/, "6 kk"],
    ["overview?period=12m", "reports?period=12m", /^Raportit/, "12 kk"],
    ["overview?period=year", "reports?period=year", /^Raportit/, "Tämä vuosi"],
    ["overview?period=last-year", "reports?period=last-year", /^Raportit/, "Viime vuosi"],
    ["reports?period=month", "overview?period=month", /^Yhteenveto/, thisMonth],
    ["reports?period=last-month", "overview?period=last-month", /^Yhteenveto/, lastMonth],
  ] as const;
  for (const [old, now, title, label] of MOVED) {
    await page.goto("/#/transactions");
    await page.goto(`/#/${old}`);
    await expect.poll(() => new URL(page.url()).hash, `${old} is rewritten`).toBe(`#/${now}`);
    await expect(page).toHaveTitle(title);
    await expect(title.source.includes("Yhteenveto") ? pressedMonth : pressed).toHaveText(label);
    await page.goBack();
    expect(page.url(), `Back from ${old} skips the old address`).toMatch(/#\/transactions$/);
  }
  // an address a page does not offer a period for opens the page's own default
  await page.goto("/#/reports?period=nonsense");
  await expect(pressed).toHaveText("12 kk");
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

  // the tabs: Tapahtumat is the list, and a period carries over to it
  await page.getByRole("button", { name: "Tapahtumat", exact: true }).click();
  await expect(page).toHaveURL(/#\/transactions$/);
  await expect(page.getByRole("heading", { name: "Luokittelematta" }).or(page.getByRole("heading", { name: "Tapahtumat", level: 2 })).first()).toBeVisible();
  await page.goto("/#/transactions?view=merchants&from=2026-01-01&to=2026-03-31");
  await page.getByRole("button", { name: "Tapahtumat", exact: true }).click();
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

  // Arkiostot are the everyday purchases of the recurring detection
  const series: { merchant: string; kind: string; active: boolean }[] = (await (await context.request.get("/api/recurring")).json()).series;
  const habits = new Set(series.filter((r) => r.kind === "habit" && r.active).map((r) => r.merchant));
  expect(habits.size, "the demo has everyday purchases").toBeGreaterThan(0);
  await page.goto("/#/transactions?view=merchants");
  await expect(rows.first()).toBeVisible();
  // the page has no switch for them: only the address sets the filter, and the chip is shown while it is on
  await expect(page.getByRole("group", { name: "Kauppiaiden rajaus" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Poista rajaus Arkiostot" })).toHaveCount(0);
  await page.goto("/#/transactions?view=merchants&habit=1");
  const chip = page.getByRole("button", { name: "Poista rajaus Arkiostot" });
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

test("the last month tells why it differed (Menojen muutos), the running month does not, and Raportit has it no more", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview?period=last-month");
  const change = page.getByRole("region", { name: "Menojen muutos" });
  await expect(change).toBeVisible();
  await expect(change.getByText(/verrattuna tavalliseen kuukauteen/)).toBeVisible();
  // one usual total: the sentence, the bridge's start and the table's footer say the same figure; the bridge is left
  // out when no category stands out (only "Muut muutokset" would be in it)
  const usual = (await change.locator(".change-table tfoot td").nth(2).innerText()).trim();
  if (await change.locator(".bridge-title").count()) await expect(change.locator(".bridge-title")).toContainText(`${usual} →`);
  const sentence = (await change.locator(".change-sentence").innerText()).replace(/\s/g, " ");
  if (sentence.includes("tavallisesti")) expect(sentence).toContain(`tavallisesti ${usual.replace(/\s/g, " ")}`);
  await expect(page.getByRole("heading", { name: "Menojen kertymä" })).toHaveCount(0);
  await expect(page.getByText("Tasauserä")).toHaveCount(0);

  await page.getByRole("group", { name: "Kuukausi" }).getByRole("button").first().click();
  await expect(page.getByRole("heading", { name: "Menojen kertymä" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Menojen muutos" })).toHaveCount(0);
  await page.goto("/#/reports");
  await expect(page.getByRole("heading", { name: "Tulot ja menot" }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Menojen muutos" })).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the merchants of the month are a link to Tapahtumat, and a merchant there has a summary of its whole history", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview");
  await page.getByRole("link", { name: "Kauppiaat" }).click();
  await expect(page).toHaveURL(/#\/transactions\?view=merchants&from=\d{4}-\d{2}-01&to=/);
  // The address changes at the click, a few ms before the page does, and the Overview has merchant links of its own
  // (an income series, in a table): "tbody a" can still find one of those. Look only in the merchant table.
  const link = page.locator(".merchant-table tbody a[href*='merchant=']").first();
  await expect(link).toBeVisible();
  const merchant = (await link.innerText()).trim();
  await link.click();
  // the link that was read is the one that opened
  await expect(page).toHaveURL((url) => new URLSearchParams(url.hash.split("?")[1]).get("merchant") === merchant);
  const summary = page.getByRole("region", { name: `Yhteenveto: ${merchant}` });
  await expect(summary).toBeVisible();
  await expect(summary.getByRole("heading", { name: merchant })).toBeVisible();
  for (const term of ["Maksuja", "Ensimmäinen", "Viimeisin"]) await expect(summary.getByText(term, { exact: true })).toBeVisible();
  // the list below is the same merchant
  await expect(page.locator("tbody tr").first()).toBeVisible();
  // the card states the sums, so the list's head does not draw them a second time (and has no line about the sum)
  for (const term of ["Maksettu yhteensä", "Saatu yhteensä"]) {
    await expect(page.getByText(term, { exact: true })).toHaveCount(await summary.getByText(term, { exact: true }).count());
  }
  await expect(page.getByText("Tapahtumia", { exact: true })).toHaveCount(0);
  // without a merchant filter there is no summary, and the list's head holds the three figures, once each
  await page.goto("/#/transactions");
  await expect(page.getByRole("region", { name: /^Yhteenveto:/ })).toHaveCount(0);
  for (const term of ["Tapahtumia", "Maksettu yhteensä"]) await expect(page.getByText(term, { exact: true })).toHaveCount(1);
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
  await expect(empty).toHaveText(/^Ei tapahtumia\.\s*Yhdistä pankki$/);
  await expect(empty.getByRole("link", { name: "Yhdistä pankki" })).toHaveAttribute("href", "#/settings?add=1");
  // no figures for nothing
  await expect(page.getByText("Tapahtumia", { exact: true })).toHaveCount(0);
  await page.goto("/#/transactions?q=zzzz");
  await expect(empty).toHaveText("Ei tapahtumia näillä rajauksilla.");
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
  await page.goto("/#/bills");
  const total = page.locator(".card", { has: page.getByRole("heading", { name: "Tilaukset" }) }).locator(".card-head strong");
  await expect(total).toBeVisible();
  // the row "Tilaukset kuukaudessa" on top of the page and the card header are one figure
  const row = page.locator(".st-row", { hasText: "Tilaukset kuukaudessa" });
  await expect(row.locator(".st-name")).toHaveText("Tilaukset kuukaudessa");
  await expect(row.locator(".st-num")).toHaveText((await total.innerText()).replace(/\/kk$/, "").trim());

  const answer = page.getByRole("button", { name: /^Käytössä: / }).first();
  await expect(answer).toBeVisible();
  const merchant = ((await answer.getAttribute("aria-label")) ?? "").replace(/^Käytössä: /, "");
  await answer.click();
  const undo = page.getByRole("button", { name: `Kumoa: ${merchant}` }).first();
  await expect(undo).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: `Kumoa: ${merchant}` }).first()).toBeVisible();
  // the merchant is also a row in the list of what falls due, so the row is looked for in the Tilaukset card
  const subs = page.locator(".card", { has: page.getByRole("heading", { name: "Tilaukset", exact: true }) });
  await expect(subs.locator("tr", { has: page.getByRole("link", { name: merchant, exact: true }) }).first().locator(".badge", { hasText: "Käytössä" })).toBeVisible();

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
  await expect(page.getByRole("heading", { name: "Tulot ja menot", exact: true })).toBeVisible();
  const alerts = page.getByRole("list", { name: "Ilmoitukset" });
  // a forgotten service is answered, not only dismissed (the buttons are looked at, not pressed: a mark would change the Laskut page)
  await expect(alerts.getByRole("button", { name: /^Käytössä: / }).first()).toBeVisible();
  await expect(alerts.getByRole("button", { name: /^Lopetettu: / }).first()).toBeVisible();

  const dismiss = alerts.getByRole("button", { name: /^Kuittaa: / }).first();
  await expect(dismiss).toBeVisible();
  const name = (await dismiss.getAttribute("aria-label"))!;
  await dismiss.click();
  await expect(alerts.getByRole("button", { name, exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Tulot ja menot", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(alerts.getByRole("button", { name, exact: true }), "the dismissed alert is back after a reload").toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the Laskut tables fit a phone: the date of the next charge is inside the card at 390 px", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/bills");
  await expect(page.getByRole("heading", { name: "Tilaukset" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  // a table wider than its card scrolls sideways inside the card and clips the last column
  const clipped = await page.evaluate(() => Array.from(document.querySelectorAll(".table-wrap")).filter((w) => w.scrollWidth > w.clientWidth + 1).length);
  expect(clipped, "tables that scroll sideways").toBe(0);
  // the list of what falls due has its three heads, and the page fits the screen
  await expect(page.locator("#tulossa thead th")).toHaveText(["Eräpäivä", "Saaja", "Summa"]);
  await fitsScreen(page, "Laskut");
  const next = page.locator("th", { hasText: "Seuraava" }).first();
  // the list of what falls due comes first, so the table is below the fold: scrolled to, it is whole inside the screen
  await next.scrollIntoViewIfNeeded();
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

test("Säästövinkit at its default flag: a demo finding is listed, decisions survive a reload with their follow-up, and everything fits a phone", async ({ browser }) => {
  const desktop = await browser.newContext({ storageState: STATE, viewport: { width: 1366, height: 800 } });
  const page = await desktop.newPage();
  const seen = watch(page);
  // the module ships on; an admin can switch it off in Asetukset > Palvelin, and the end of the test does that through the same API
  const flag = (on: boolean) => desktop.request.put("/api/admin/features", { headers: { "X-Requested-With": "fetch" }, data: { optimise: on } });
  try {
    await page.goto("/#/optimise");
    await expect(page).toHaveTitle(/^Säästövinkit/);
    await expect(page.getByRole("navigation", { name: "Päävalikko" }).getByRole("link", { name: "Säästövinkit" })).toBeVisible();
    await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });

    // Tilanne is figures: the euros a year of the tips, then the four facts
    const situation = page.getByRole("region", { name: "Tilanne" });
    const found = situation.locator(".optimise-facts > div", { has: page.getByText("Säästömahdollisuus vuodessa (arvio)", { exact: true }) }).locator("dd");
    await expect(found).toHaveText(/^\d[\d\s]*€$/);
    for (const fact of ["Säästöaste", "Kiinteät menot tuloista", "Puskuri", "Velanhoito tuloista"]) await expect(situation.getByText(fact, { exact: true })).toBeVisible();
    // what the numbers rest on, what was checked and what waits are not told on the page, and no area is a list of nothing
    for (const gone of [/^Tiedot \d+\.\d+\.\d{4} asti/, /^Laskettu /, /^Tarkistett/, /^Odottaa tietoja/]) await expect(page.getByText(gone)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Tietojen laatu" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Alueet", exact: true })).toHaveCount(0);
    await expect(page.locator("details", { has: page.locator("summary", { hasText: /Tarkistet|ilman vinkkejä|Odottaa/ }) })).toHaveCount(0);

    // the demo history has a software price rise and two video services at once
    const cards = page.locator("article.finding");
    const rise = cards.filter({ hasText: "Adobe: hinta nousi" });
    const overlap = cards.filter({ hasText: "videopalvelua yhteensä" });
    await expect(rise).toBeVisible();
    await expect(overlap).toBeVisible();
    await expect(rise).toContainText(/144\s€ vuodessa/);
    // the certainty is told only when it is not high, as a badge with its reason
    await expect(rise).not.toContainText("Varmuus");
    await expect(overlap.locator(".finding-certainty")).toHaveText(/^Varmuus: keskitaso .+/);

    // the calculation: its lines, the months as bars with a table view, and a way to check the categories
    await rise.getByRole("button", { name: "Avaa laskelma" }).click();
    await expect(rise.getByText("Hinta ennen")).toBeVisible();
    await expect(rise.getByRole("img", { name: "Menot kuukausittain" })).toBeVisible();
    await rise.getByRole("button", { name: "Taulukko" }).click();
    await expect(rise.locator("th", { hasText: "Kuukausi" })).toBeVisible();
    await expect(rise.getByRole("link", { name: "Adobe", exact: true })).toHaveAttribute("href", /#\/transactions\?merchant=Adobe/);
    await rise.getByRole("button", { name: "Sulje laskelma" }).click();
    await expect(rise.getByText("Hinta ennen")).toHaveCount(0);

    // Ei koske meitä takes the finding out of its area and the headline to Päätetyt, and the choice stays after a reload
    const title = (await overlap.locator(".finding-title").innerText()).trim();
    const before = await found.innerText();
    await overlap.getByRole("button", { name: "Ei koske meitä" }).click();
    await overlap.getByRole("button", { name: "Tarvitsen tämän" }).click();
    const decided = page.getByRole("region", { name: "Päätetyt" });
    await expect(decided).toContainText(title);
    await expect(decided).toContainText("Ei koske meitä · Tarvitsen tämän");
    // the card the keyboard was on is gone: focus is on the message
    await expect(page.getByRole("status").filter({ hasText: "Vinkki siirrettiin kohtaan Päätetyt." })).toBeFocused();
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

    // Tein tämän keeps its date, and Muistuta myöhemmin hides the finding until then
    await rise.getByRole("button", { name: "Tein tämän" }).click();
    await rise.getByRole("button", { name: "Tallenna" }).click();
    await expect(decided).toContainText("Adobe: hinta nousi");
    await expect(rise).toHaveCount(0);
    await page.reload();
    const done = decided.getByRole("listitem").filter({ hasText: "Adobe: hinta nousi" });
    await expect(done).toContainText(/Tehty \d+\.\d+\.\d{4}/);
    // the follow-up judges the change once complete months show it: made today, it waits
    await expect(done.locator(".outcome")).toContainText(/^Seuranta: Odottaa.+\./);
    // one visit makes one snapshot: no line and no changes yet
    await expect(page.getByRole("region", { name: "Seuranta" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Muutokset viime käynnin jälkeen" })).toHaveCount(0);

    // a phone with the decision on the page: Päätetyt and its follow-up row fit the screen too
    const phone = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const small = await phone.newPage();
    const seenSmall = watch(small);
    await small.goto("/#/optimise");
    await expect(small.getByRole("region", { name: "Päätetyt" }).locator(".outcome")).toContainText(/^Seuranta: Odottaa.+\./);
    await small.waitForLoadState("networkidle");
    await fitsScreen(small, "Päätetyt with its follow-up at 390px");

    await page.getByRole("button", { name: /^Peruuta päätös: Adobe/ }).click();
    await expect(decided).toHaveCount(0);
    await overlap.getByRole("button", { name: "Muistuta myöhemmin" }).click();
    await overlap.getByRole("button", { name: "30 päivää" }).click();
    await expect(overlap).toHaveCount(0);
    await expect(decided).toContainText(/Muistutus \d+\.\d+\.\d{4}/);
    await page.getByRole("button", { name: /^Peruuta päätös: / }).click();
    await expect(overlap).toBeVisible();
    await fitsScreen(page, "Säästövinkit at 1366px");

    // the phone again, the decision undone: everything stacks, and each form and the calculation fit the screen
    await small.reload();
    const smallRise = small.locator("article.finding").filter({ hasText: "Adobe: hinta nousi" });
    await expect(smallRise).toBeVisible();
    await small.waitForLoadState("networkidle");
    // the first tip's title is on the first screen of a phone, with no scrolling
    await expect(small.locator("article.finding .finding-title").first()).toBeInViewport({ ratio: 1 });
    await fitsScreen(small, "Säästövinkit at 390px");
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
    await expect(page.getByRole("navigation", { name: "Päävalikko" }).getByRole("link", { name: "Yhteenveto" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Päävalikko" }).getByRole("link", { name: "Säästövinkit" })).toHaveCount(0);
    await expect(page).toHaveTitle(/^Yhteenveto/);
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
  await expect(page.getByRole("navigation").getByText("Yhteenveto").first()).toBeVisible();
  expect(seen.problems.filter((p) => !/HTTP 401: POST .*\/api\/auth\/login/.test(p) && !/Failed to load resource.*401/.test(p))).toEqual([]);
});

test("an expected bill is added in the list of what falls due on Laskut, is still there after a reload and can be removed", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/bills");
  const coming = page.locator("#tulossa");
  await expect(coming.getByRole("heading", { name: "Erääntyvät maksut" })).toBeVisible();
  // the form is behind the button
  await expect(coming.getByRole("form", { name: "Lisää lasku" })).toHaveCount(0);
  await coming.getByRole("button", { name: "Lisää lasku" }).click();
  const form = coming.getByRole("form", { name: "Lisää lasku" });

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

  await expect(coming.getByRole("form", { name: "Lisää lasku" })).toHaveCount(0);
  await expect(coming.getByText("Lasku E2E-ajoneuvovero lisätty.")).toBeVisible();
  await expect(coming.getByRole("row", { name: /E2E-ajoneuvovero/ })).toContainText("lisätty käsin");
  const rare = page.locator("#tulevat");
  await expect(rare.getByRole("heading", { name: "Harvinaiset laskut" })).toBeVisible();
  const remove = (p: Page) => p.locator("#tulevat").getByRole("button", { name: "Poista lasku E2E-ajoneuvovero" });
  await expect(remove(page)).toBeVisible();
  // the monthly figure stands beside the heading, and there is no sentence about it
  await expect(rare.locator(".card-head strong")).toHaveText(/^\d[\d\s]*\s€\/kk$/);
  await expect(rare.getByText(/vuodessa eli/)).toHaveCount(0);

  await page.reload();
  await expect(remove(page)).toBeVisible();
  await expect(page.locator("#tulossa").getByRole("row", { name: /E2E-ajoneuvovero/ })).toBeVisible();

  await remove(page).click();
  await expect(remove(page)).toHaveCount(0);
  // the list of what is coming is fetched again too
  await expect(page.locator("#tulossa").getByText("E2E-ajoneuvovero")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#tulossa").getByRole("button", { name: "Lisää lasku" })).toBeVisible();
  await expect(page.getByText("E2E-ajoneuvovero")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Harvinaiset laskut at 1280 px: the due month of a row stands on one line", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/bills");
  const months = page.locator("#tulevat .rare-table td.due-col");
  await expect(months.first()).toBeVisible();
  // a text that wraps has one box per line
  const wrapped = await months.evaluateAll((cells) =>
    cells.filter((cell) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      return range.getClientRects().length > 1;
    }).length,
  );
  expect(wrapped, "months that wrap").toBe(0);
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
  await expect(page.locator("#tulossa").getByRole("heading", { name: "Erääntyvät maksut" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Laskut" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Toistuvat" })).toHaveCount(0);
  await page.goBack();
  expect(page.url()).toMatch(/#\/transactions$/);

  // what the page holds: the fixed costs line, the one list of what is coming, the cards of subscriptions and contracts
  await page.goto("/#/bills");
  await expect(page.locator(".st-row", { hasText: "Kiinteät menot kuukaudessa" })).toBeVisible();
  for (const heading of ["Erääntyvät maksut", "Tilaukset", "Sopimukset ja laskut"]) await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  // the report sections that moved here, and none of the old tiles or the old second list
  await expect(page.getByRole("heading", { name: "Tulevat laskut" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Tulossa tässä kuussa" })).toHaveCount(0);
  await page.goto("/#/reports");
  await expect(page.getByRole("heading", { name: "Kiinteät ja muuttuvat" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tulevat laskut" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Hinnanmuutokset" })).toHaveCount(0);

  // the card of the days to the payday lists the payments and sends on to Laskut
  await page.goto("/#/overview");
  // the fixed costs in the block "Tulot ja menot" link to the page itself, not to the old address that is redirected
  await expect(page.getByRole("region", { name: "Tulot ja menot", exact: true }).getByRole("link", { name: "Kiinteät menot kuukaudessa", exact: true })).toHaveAttribute("href", "#/bills");
  const ahead = page.locator(".card", { has: page.getByRole("heading", { name: "Erääntyvät maksut", exact: true }) });
  await expect(ahead).toBeVisible();
  // the card lists all of them, so it has no Näytä kaikki; the list on Laskut has the form for a bill
  await expect(ahead.getByRole("button", { name: /^Näytä kaikki/ })).toHaveCount(0);
  await ahead.getByRole("link", { name: "Laskut" }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/bills");
  await expect(page.locator("#tulossa").getByRole("heading", { name: "Erääntyvät maksut" })).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});
