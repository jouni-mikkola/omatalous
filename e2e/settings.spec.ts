import { type Browser, expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { linkFakeBank, makeMember, overflow, removeMember, waitForSync, watch } from "./helpers.ts";

// Asetukset: the header link, the six targets, the card every old address lands on, and the repair of a bank connection
// that ended. The server has the administrator and the demo household already (e2e/run.mjs makes them). A member lives in
// the household for the length of the file.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const TARGET_LABELS = ["Pankit ja tilit", "Talous", "Jäsenet", "Turvallisuus", "Tiedot", "Palvelin ja ylläpito"];
/** Cards that were removed: each is a row, a field or a line of another card now, and no address brings it back. */
const REMOVED = ["Tietoja", "Palvelutunnukset", "Jäsenet ilman tunnusta", "Tilien jakaminen", "Palauta uusin varmuuskopio", "Kokeiltavat toiminnot"];
/**
 * Every card of Asetukset and the target that has it: the list of the settings. A new card is added here, so that the
 * test of two clicks reads it. `admin` marks what a member is not offered; `example` the card a member has only while no one in the household has an account.
 */
const INVENTORY: { heading: string; target: string; admin?: true; example?: true; fetched?: true }[] = [
  { heading: "Pankkiyhteydet", target: "banks" },
  { heading: "Tilit", target: "banks" },
  { heading: "Pankkihaut", target: "banks", fetched: true },
  { heading: "Pankkisovellus", target: "banks" },
  { heading: "Lainat", target: "household" },
  { heading: "Kuukauden menotavoite", target: "household" },
  { heading: "Talouden jäsenet", target: "members", admin: true },
  { heading: "Salasana", target: "security" },
  { heading: "Kaksivaiheinen kirjautuminen", target: "security" },
  { heading: "Omat istunnot", target: "security" },
  { heading: "Turvallisuusloki", target: "security", admin: true },
  { heading: "Tiedot", target: "data" },
  { heading: "Esimerkkitiedot", target: "data", example: true },
  { heading: "Palvelin", target: "server", admin: true },
  { heading: "Etäkäyttö", target: "server", admin: true },
  { heading: "Ylläpito", target: "server", admin: true },
];
const TARGET_LABEL: Record<string, string> = { banks: "Pankit ja tilit", household: "Talous", members: "Jäsenet", security: "Turvallisuus", data: "Tiedot", server: "Palvelin ja ylläpito" };

let member: { state: string; id: string };
test.beforeAll(async ({ browser }) => {
  member = await makeMember(browser, "e2e-asetukset");
});
test.afterAll(async ({ browser }) => removeMember(browser, member.id));

/** The household's notes about its data depend on the date; the card Tietojen laatu is drawn from one note, so the answer is given one. */
async function withQualityNote(page: Page): Promise<void> {
  await page.route("**/api/reports?**", async (route) => {
    const answer = await route.fetch();
    const json = await answer.json();
    await route.fulfill({ response: answer, json: { ...json, dataQuality: { signals: [{ id: "stale", tone: "warning", title: "Esimerkkitilin tiedot ovat vanhoja", detail: "Esimerkkitili on haettu viimeksi viikko sitten." }] } } });
  });
}

async function admin(browser: Browser, width = 1280, height = 800) {
  const context = await browser.newContext({ storageState: STATE, viewport: { width, height } });
  const page = await context.newPage();
  return { context, page, seen: watch(page), hash: () => new URL(page.url()).hash };
}

test("Asetukset is in the user menu and has six targets, each its own address", async ({ browser }) => {
  const { context, page, seen, hash } = await admin(browser);
  const nav = page.getByRole("navigation", { name: "Päävalikko" });
  const targets = page.getByRole("navigation", { name: "Asetukset", exact: true });

  // the questions in the nav, Tarkistettavat the fourth, and Asetukset in the user menu instead of among them
  await page.goto("/#/overview");
  await expect(nav.getByRole("link")).toHaveText(["Yhteenveto", "Kuukausi", "Laskut", /^Tarkistettavat/, "Tapahtumat", "Säästövinkit"]);
  await expect(nav.getByRole("link", { name: "Asetukset" })).toHaveCount(0);
  const menu = page.locator(".user-menu");
  await menu.locator("summary").click();
  await expect(menu.getByRole("link")).toHaveText(["Asetukset"]);
  await expect(menu.getByRole("button", { name: "Kirjaudu ulos" })).toBeVisible();
  const header = menu.getByRole("link", { name: "Asetukset", exact: true });
  await header.click();
  await expect.poll(hash).toBe("#/settings/banks");
  await expect(page).toHaveTitle(/^Asetukset/);
  await menu.locator("summary").click();
  await expect(header).toHaveAttribute("aria-current", "page");
  await menu.locator("summary").click();

  // the six targets in a row, the open one marked, and each opens its own address with its own cards
  await expect(targets.getByRole("link")).toHaveText(TARGET_LABELS);
  await expect(targets.getByRole("link", { name: "Pankit ja tilit" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Yhdistä pankki" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hae nyt" }), "no connection, nothing to fetch").toHaveCount(0);
  await expect(page.locator("#pankkiyhteydet").getByText("Yhdistä ensin pankki.")).toHaveCount(0);
  await expect(page.getByText("Lisää seuraava tili")).toHaveCount(0);
  for (const target of Object.keys(TARGET_LABEL)) {
    await targets.getByRole("link", { name: TARGET_LABEL[target], exact: true }).click();
    await expect.poll(hash).toBe(`#/settings/${target}`);
    await expect(targets.getByRole("link", { name: TARGET_LABEL[target], exact: true })).toHaveAttribute("aria-current", "page");
    for (const { heading, target: on, fetched } of INVENTORY) {
      // a card that shows only for a household with a note, or beside a second member, is not asked for here
      if (on === target) {
        if (!fetched) await expect(page.getByRole("heading", { name: heading, exact: true }), `${target}: ${heading}`).toBeVisible();
      }
      else await expect(page.getByRole("heading", { name: heading, exact: true }), `${target}: ${heading} is on ${on}`).toHaveCount(0);
    }
  }

  // Salasana: a card with a button, which opens the three fields and can close them
  await page.goto("/#/settings/security");
  const password = page.locator("#salasana");
  await expect(password.getByLabel("Nykyinen salasana")).toHaveCount(0);
  await password.getByRole("button", { name: "Vaihda salasana" }).click();
  await expect(password.getByLabel("Nykyinen salasana")).toBeVisible();
  await expect(password.getByLabel("Uusi salasana (vähintään 12 merkkiä)")).toBeVisible();
  await password.getByRole("button", { name: "Peruuta" }).click();
  await expect(password.getByLabel("Nykyinen salasana")).toHaveCount(0);

  // Raportit no longer has the card, and Yhteenveto has no line that links to it (a warning about the data is a line under the heading)
  await page.goto("/#/reports");
  await expect(page.getByRole("heading", { name: "Tietojen laatu" })).toHaveCount(0);
  await page.goto("/#/overview");
  await expect(page.getByRole("link", { name: "Tietojen laatu" })).toHaveCount(0);

  // the address of the removed CSV import and the bank picker open Pankit ja tilit
  await page.goto("/#/settings?section=csv");
  await expect.poll(hash).toBe("#/settings/banks");
  await expect(page.getByRole("heading", { name: "Pankkiyhteydet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tuo CSV" })).toHaveCount(0);
  await page.goto("/#/settings?add=1");
  await expect.poll(hash).toBe("#/settings/banks?add=1");
  await expect(page.getByRole("heading", { name: "Valitse pankki" })).toBeVisible();

  // a phone: five tabs in one row, Asetukset still in the user menu, and no target is wider than the screen
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/#/overview");
  const tops = await nav.getByRole("link").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size, "the five labels share one row").toBe(1);
  await page.locator(".user-menu summary").click();
  await expect(page.locator(".user-menu").getByRole("link", { name: "Asetukset", exact: true })).toBeVisible();
  for (const target of Object.keys(TARGET_LABEL)) {
    await page.goto(`/#/settings/${target}`);
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
    expect(await overflow(page), target).toBeLessThanOrEqual(1);
  }
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("every setting is at most two clicks from Asetukset, and a member is offered none of the admin's", async ({ browser }) => {
  // an administrator: from any target, a click on the target's link and the card is there
  const { context, page, seen } = await admin(browser);
  const targets = page.getByRole("navigation", { name: "Asetukset", exact: true });
  for (const { heading, target, fetched } of INVENTORY) {
    if (fetched) continue;
    // start on a target that is not the card's own, so that the click is needed
    await page.goto(target === "banks" ? "/#/settings/household" : "/#/settings/banks");
    await expect(targets).toBeVisible();
    let clicks = 0;
    await targets.getByRole("link", { name: TARGET_LABEL[target], exact: true }).click();
    clicks += 1;
    await expect(page.getByRole("heading", { name: heading, exact: true }), `${heading} on ${target}`).toBeVisible();
    expect(clicks, heading).toBeLessThanOrEqual(2);
  }
  await context.close();

  // a member: no link to the admin's target, its address opens the first target, and none of the admin's cards is drawn
  const memberContext = await browser.newContext({ storageState: member.state, viewport: { width: 1280, height: 800 } });
  const memberPage = await memberContext.newPage();
  const memberSeen = watch(memberPage);
  const memberTargets = memberPage.getByRole("navigation", { name: "Asetukset", exact: true });
  await memberPage.goto("/#/settings");
  await expect(memberTargets.getByRole("link")).toHaveText(TARGET_LABELS.filter((l) => l !== TARGET_LABEL.server && l !== TARGET_LABEL.members));
  await expect(memberTargets.getByRole("link", { name: TARGET_LABEL.server })).toHaveCount(0);
  for (const { heading, target, admin, example, fetched } of INVENTORY) {
    if (example || fetched) continue;
    if (admin) {
      await memberPage.goto(`/#/settings/${target}`);
      await expect(memberPage.getByRole("heading", { level: 2 }).first()).toBeVisible();
      await expect(memberPage.getByRole("heading", { name: heading, exact: true }), `${heading} is the admin's`).toHaveCount(0);
    } else {
      await memberPage.goto(target === "banks" ? "/#/settings/household" : "/#/settings/banks");
      await memberTargets.getByRole("link", { name: TARGET_LABEL[target], exact: true }).click();
      await expect(memberPage.getByRole("heading", { name: heading, exact: true }), `${heading} on ${target}`).toBeVisible();
    }
  }
  await memberPage.goto("/#/settings/server");
  await expect.poll(() => new URL(memberPage.url()).hash).toBe("#/settings/banks");
  expect(seen.problems).toEqual([]);
  expect(memberSeen.problems).toEqual([]);
  await memberContext.close();
});

test("every address of Asetukset lands on the card it names, on the target that has it, and the rewrite leaves no old entry for Back", async ({ browser }) => {
  // a short screen, so that a card low on the page is out of sight until the address brings it
  const { context, page, seen, hash } = await admin(browser, 1280, 600);
  await withQualityNote(page);
  const cases: [address: string, lands: string, card: string | null][] = [
    ["/#/settings", "#/settings/banks", null],
    ["/#/settings?tab=talous", "#/settings/banks", null],
    ["/#/settings#tilit", "#/settings/banks#tilit", "tilit"],
    ["/#/settings#lainat", "#/settings/household#lainat", "lainat"],
    ["/#/settings#salasana", "#/settings/security#salasana", "salasana"],
    ["/#/settings?tab=talous#turvallisuusloki", "#/settings/security#turvallisuusloki", "turvallisuusloki"],
    ["/#/settings?section=security", "#/settings/security#turvallisuusloki", "turvallisuusloki"],
    ["/#/settings#kirjautuminen", "#/settings/security#kirjautuminen", "kirjautuminen"],
    ["/#/settings#laatu", "#/settings/data#laatu", "laatu"],
    ["/#/settings?section=technical", "#/settings/server", null],
    ["/#/settings?section=server", "#/settings/server#palvelin", "palvelin"],
    ["/#/settings?section=maintenance", "#/settings/server#yllapito", "yllapito"],
    ["/#/settings/data#laatu", "#/settings/data#laatu", "laatu"],
    // the removed cards: the address lands on the target that has what is left of them
    ["/#/settings#jasenet-ilman-tunnusta", "#/settings/members#jasenet-ilman-tunnusta", null],
    ["/#/settings#tilien-jakaminen", "#/settings/banks#tilien-jakaminen", null],
    ["/#/settings#palvelutunnukset", "#/settings/security#palvelutunnukset", null],
  ];
  for (const [address, lands, card] of cases) {
    await page.goto("/#/overview");
    await page.goto(address);
    await expect.poll(hash, address).toBe(lands);
    if (card) {
      await expect(page.locator(`#${card}`), `${address} brings #${card}`).toBeInViewport();
      // a card that loads its data above the target must not push the target out of sight after the scroll
      await page.waitForLoadState("networkidle");
      await expect(page.locator(`#${card}`), `${address} keeps #${card} in sight`).toBeInViewport();
    } else {
      await expect(page.getByRole("navigation", { name: "Asetukset", exact: true })).toBeVisible();
    }
  }

  // no target draws a removed card, for an admin
  for (const target of Object.keys(TARGET_LABEL)) {
    await page.goto(`/#/settings/${target}`);
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
    for (const heading of REMOVED) await expect(page.getByRole("heading", { name: heading, exact: true }), `${target}: ${heading}`).toHaveCount(0);
  }

  // the old security address, from Yhteenveto: Back returns there, not to the address that was rewritten
  await page.goto("/#/overview");
  await page.goto("/#/settings?section=security");
  await expect.poll(hash).toBe("#/settings/security#turvallisuusloki");
  await expect(page.getByRole("heading", { name: "Turvallisuusloki", exact: true })).toBeVisible();
  await page.goBack();
  expect(page.url()).toMatch(/#\/overview$/);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a member's targets have their own cards and none of the admin's, and Hae nyt is a row of Päivitykset", async ({ browser }) => {
  const context = await browser.newContext({ storageState: member.state, viewport: { width: 1280, height: 800 } });
  // without a connection there is nothing to fetch: no button, no sentence about it
  const before = await context.newPage();
  await before.goto("/#/settings");
  await expect(before.getByRole("heading", { name: "Pankkiyhteydet", exact: true })).toBeVisible();
  await expect(before.getByRole("button", { name: "Hae nyt" })).toHaveCount(0);
  await expect(before.locator("#pankkiyhteydet").getByText("Yhdistä ensin pankki.")).toHaveCount(0);
  await before.close();

  // with one, Hae nyt sits in the head of Pankkiyhteydet beside the button that adds a bank (a page that opens after the
  // application was saved reads it)
  const page = await context.newPage();
  const seen = watch(page);
  const hash = () => new URL(page.url()).hash;
  await withQualityNote(page);
  await linkFakeBank(page);
  await waitForSync(context);
  await page.goto("/#/settings");
  await page.reload();
  const banks = page.locator("#pankkiyhteydet");
  await expect(banks.getByRole("button", { name: "Hae nyt" })).toBeVisible();
  await expect(banks.getByRole("button", { name: /^Yhdistä (toinen )?pankki$/ })).toBeVisible();
  await banks.getByRole("button", { name: "Hae nyt" }).click();
  await expect(page.locator(".notice").filter({ hasText: /uutta tapahtumaa|uusi tapahtuma/ })).toBeVisible();

  // the fetch is a row of Päivitykset, on the same target
  await expect.poll(hash).toBe("#/settings/banks");
  const runs = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Pankkihaut", exact: true }) });
  await expect(runs.getByRole("row").filter({ hasText: "käsin" })).toHaveCount(1);
  await expect(runs.getByRole("row").filter({ hasText: "uusi yhteys" })).toHaveCount(1);
  await expect(page.getByText("Ei hakuja.")).toHaveCount(0);

  // a member sees the cards that are theirs, whichever old address opens Asetukset
  await expect(page.getByText("Pankkisovellus", { exact: true })).toBeVisible();
  for (const address of ["/#/settings?section=technical", "/#/settings?section=server", "/#/settings?section=maintenance", "/#/settings/server"]) {
    await page.goto(address);
    await expect(page.getByRole("heading", { name: "Pankkisovellus", exact: true }), address).toBeVisible();
    for (const admins of ["Palvelin", "Turvallisuusloki", "Ylläpito"]) await expect(page.getByRole("heading", { name: admins, exact: true }), `${address}: ${admins}`).toHaveCount(0);
  }
  // the old security address is the member's own sessions, and a card with a note comes with the note
  await page.goto("/#/settings?section=security");
  await expect.poll(hash).toBe("#/settings/security#kirjautuminen");
  await expect(page.getByRole("heading", { name: "Omat istunnot", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Turvallisuusloki", exact: true })).toHaveCount(0);
  await expect(page.locator("#kirjautuminen")).toBeInViewport();
  await page.goto("/#/settings#laatu");
  await expect.poll(hash).toBe("#/settings/data#laatu");
  await expect(page.locator("#laatu").getByRole("heading", { name: "Tietojen laatu", exact: true })).toBeVisible();
  await expect(page.locator("#laatu")).toContainText("Esimerkkitilin tiedot ovat vanhoja");
  await expect(page.getByText("Ei huomautettavaa.")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Tietojen laatu tells the card bills by issuer, with the reason the purchases are missing, at 1280 and 390", async ({ browser }) => {
  // made-up bills: the answer is changed on its way, core's tests hold how the rows are made
  const rows = [
    { issuer: "Morrow Bank", label: "Morrow Bank", cents: 60_000, count: 3, lastDate: "2026-09-05", reason: "not_connected", since: null },
    { issuer: "Bank Norwegian", label: "Bank Norwegian ·· 1234", cents: 50_000, count: 2, lastDate: "2026-06-20", reason: "before_history", since: "2026-09-01" },
  ];
  for (const width of [1280, 390]) {
    const { context, page, seen } = await admin(browser, width, 900);
    await page.route("**/api/reports?**", async (route) => {
      const answer = await route.fetch();
      const signal = { id: "card_bills", tone: "warning", title: "Korttilaskuja 1 100,00 € ilman ostoja", detail: "Yhdistä kortti.", category: "card_bill", cents: 110_000, cardPurchases: rows };
      await route.fulfill({ response: answer, json: { ...(await answer.json()), dataQuality: { signals: [signal] } } });
    });
    await page.goto("/#/settings/data#laatu");
    const block = page.locator("#laatu");
    await expect(block.locator("strong").first()).toContainText("ilman ostoja");
    await expect(block).not.toContainText("lasketaan menoiksi");
    const table = block.getByRole("table");
    if (width === 1280) await expect(table.getByRole("columnheader")).toHaveText(["Kortti", "Laskut 12 kuukaudelta", "Miksi ostot puuttuvat"]);
    // web-first: at 390 nothing above waits for the table, and a read of its rows before they draw finds none
    const lines = table.locator("tbody tr");
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toContainText("Morrow Bank");
    await expect(lines.nth(0)).toContainText("Korttia ei ole yhdistetty.");
    await expect(lines.nth(1)).toContainText("Bank Norwegian ·· 1234");
    await expect(lines.nth(1)).toContainText("Pankki antaa ostot vasta 1.9.2026 alkaen.");
    await expect(block.getByRole("link", { name: "Yhdistä pankki" })).toHaveAttribute("href", "#/settings/banks?add=1");
    await expect(block.getByRole("link", { name: "Näytä tapahtumat" })).toBeVisible();
    expect(await overflow(page), `the page scrolls sideways at ${width} px`).toBeLessThanOrEqual(1);
    expect(seen.problems).toEqual([]);
    await context.close();
  }
});

test("Tietojen laatu opens with the share of spending filed without asking, at 1280 and 390", async ({ browser }) => {
  // made-up shares: the answer is changed on its way, core's tests hold how they are made
  const cases = [
    { filed: { share: 0.874, guessShare: 0.004, userShare: 0.06, cents: 874_00, totalCents: 1000_00 }, lines: ["Sovellus luokitteli automaattisesti 87 % viimeisen 12 kuukauden menoista, joista alle 1 % arvauksena.", "Itse luokittelit 6 %."] },
    { filed: { share: 1, guessShare: 0, userShare: 0, cents: 500_00, totalCents: 500_00 }, lines: ["Sovellus luokitteli automaattisesti 100 % viimeisen 12 kuukauden menoista."] },
  ];
  for (const width of [1280, 390]) {
    for (const c of cases) {
      const { context, page, seen } = await admin(browser, width, 900);
      await page.route("**/api/reports?**", async (route) => {
        const answer = await route.fetch();
        await route.fulfill({ response: answer, json: { ...(await answer.json()), dataQuality: { signals: [], filed: c.filed } } });
      });
      await page.goto("/#/settings/data#laatu");
      const block = page.locator("#laatu");
      await expect(block.getByRole("heading", { name: "Tietojen laatu", exact: true })).toBeVisible();
      const lines = await block.locator(".filed-share p").evaluateAll((ps) => ps.map((p) => (p.textContent ?? "").replace(/\s+/g, " ")));
      expect(lines).toEqual(c.lines);
      expect(await overflow(page), `the page scrolls sideways at ${width} px`).toBeLessThanOrEqual(1);
      expect(seen.problems).toEqual([]);
      await context.close();
    }
  }
});

test("Tietojen laatu is a card only while the data has a note", async ({ browser }) => {
  const { context, page, seen } = await admin(browser);
  await page.route("**/api/reports?**", async (route) => {
    const answer = await route.fetch();
    await route.fulfill({ response: answer, json: { ...(await answer.json()), dataQuality: { signals: [] } } });
  });
  await page.goto("/#/settings/data");
  await expect(page.getByRole("heading", { name: "Tiedot", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Tietojen laatu", exact: true })).toHaveCount(0);
  await expect(page.locator("#laatu")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("an ended or ending bank connection has Yhdistä uudelleen on its row and in the banner, and the row starts the same bank again", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seen = watch(page);
  const connection = (id: string, state: string, daysLeft: number | null) => ({
    id,
    institution: "Nordea",
    status: state === "active" ? "active" : "expired",
    state,
    history: false,
    replaced: false,
    validUntil: state === "active" ? "2026-10-20T00:00:00Z" : "2026-09-01T00:00:00Z",
    createdAt: "2026-03-01T00:00:00Z",
    lastSyncedAt: null,
    daysLeft,
  });
  // one consent that ended and one that ends in nine days, on a server that has its bank application
  let metaAsked = 0;
  let metaAnswered = 0;
  await page.route("**/api/meta", async (route) => {
    metaAsked++;
    try {
      // the page reads /api/meta by itself: a read still on its way when the page reloads or the context closes has no response left to change
      const response = await route.fetch().catch(() => null);
      const json = await response?.json().catch(() => null);
      if (!response || !json) return;
      json.connections = [connection("old", "lapsed", null), connection("soon", "active", 9)];
      json.bank = { ...json.bank, configured: true, redirectMode: "own" };
      await route.fulfill({ response, json });
    } finally {
      // a read that gave up counts as answered, so the wait below does not hang on it
      metaAnswered++;
    }
  });
  const started: unknown[] = [];
  await page.route("**/api/connections/start", async (route) => {
    started.push(route.request().postDataJSON());
    await route.fulfill({ json: { url: "/#/settings?connected=1" } });
  });

  await page.goto("/#/overview");
  // the banner of the ended consent opens the bank picker at Asetukset
  const banner = page.locator(".notice", { hasText: "vanhentui" });
  await expect(banner.getByRole("link", { name: "Yhdistä uudelleen" })).toHaveAttribute("href", "#/settings/banks?add=1");
  await banner.getByRole("link", { name: "Yhdistä uudelleen" }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/settings/banks?add=1");
  await expect(page.getByRole("heading", { name: "Valitse pankki" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yhdistä pankki" })).toBeHidden();

  // both rows offer it, one click starts Nordea again without the picker
  await page.getByRole("button", { name: "Sulje" }).click();
  await expect(page.getByRole("button", { name: "Yhdistä pankki" })).toBeVisible();
  const reconnect = page.getByRole("table").getByRole("button", { name: "Yhdistä uudelleen" });
  await expect(reconnect).toHaveCount(2);
  const readBefore = metaAsked;
  await reconnect.first().click();
  await expect.poll(() => started.length).toBe(1);
  expect(started[0]).toMatchObject({ bank: "nordea-fi" });
  // The click is not over when the start is answered: the page goes to the address it was given and reads /api/meta
  // again, a few ms later. Closing the context before that read is answered cuts its route.fetch off (1 run in 100).
  await expect.poll(() => metaAsked > readBefore && metaAnswered === metaAsked).toBe(true);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a target draws no empty cards while its data is on the way, only the loading placeholder", async ({ browser }) => {
  const { context, page, seen } = await admin(browser);
  // the first answer is held until the test lets it go
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/sync/runs", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/#/settings/banks");
  await expect(page.getByRole("status").getByText("Ladataan…")).toBeVisible();
  // no card is drawn, so no empty frame is either
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
  await expect(page.locator(".card:not(.skeleton):visible")).toHaveCount(0);
  release();
  await expect(page.getByRole("heading", { name: "Pankkiyhteydet" })).toBeVisible();
  await expect(page.getByRole("status").getByText("Ladataan…")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Turvallisuus shows its cards when one read fails, and after a few seconds when one never answers", async ({ browser }) => {
  const { context, page } = await admin(browser);
  // one read fails: that card says so itself and the others work
  await page.route("**/api/security/sessions", (route) => route.fulfill({ status: 500, json: { error: "Palvelin ei vastannut." } }));
  await page.goto("/#/settings/security");
  await expect(page.getByRole("heading", { name: "Salasana", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Turvallisuusloki", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Omat istunnot" })).toBeVisible();
  await expect(page.getByText("Palvelin ei vastannut.")).toBeVisible();
  await expect(page.getByText("Ladataan…")).toHaveCount(0);
  await page.unroute("**/api/security/sessions");

  // one read never answers: the cards are drawn after 4 s at the latest
  await page.route("**/api/security/events*", () => new Promise(() => {}));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Salasana", exact: true })).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole("heading", { name: "Omat istunnot" })).toBeVisible();
  await context.close();
});

test("Palvelin is two cards and its Tallenna saves only its own form", async ({ browser }) => {
  const { context, page } = await admin(browser);
  await page.goto("/#/settings/server");
  const card = (name: string) => page.locator(".card").filter({ has: page.getByRole("heading", { name, exact: true }) });
  const server = card("Palvelin");
  await expect(server.getByRole("button", { name: "Tallenna", exact: true })).toHaveCount(1);
  for (const other of ["Etäkäyttö"]) {
    await expect(card(other), other).toBeVisible();
    await expect(card(other).getByRole("heading", { name: "Palvelin", exact: true }), other).toHaveCount(0);
    await expect(card(other).getByRole("button", { name: "Tallenna", exact: true }), other).toHaveCount(0);
  }
  // the switch for Säästövinkit is gone: the card and its address (the old technical page) lead nowhere else
  await expect(page.getByRole("heading", { name: "Kokeiltavat toiminnot" })).toHaveCount(0);
  // the one Tallenna sends one change of the instance settings and touches no bank application
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  await server.getByRole("button", { name: "Tallenna", exact: true }).click();
  await expect(server.getByText("Tallennettu.")).toBeVisible();
  expect(writes.filter((w) => /features|bank-app|enable-banking|remote|access/.test(w))).toEqual([]);
  expect(writes).toHaveLength(1);
  await context.close();
});

test("at 390 px every key of every target of Asetukset is inside the screen", async ({ browser }) => {
  const { context, page } = await admin(browser, 390, 800);
  for (const route of Object.keys(TARGET_LABEL).map((target) => `/#/settings/${target}`)) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
    await expect(page.getByText("Ladataan…")).toHaveCount(0);
    expect(await overflow(page), route).toBeLessThanOrEqual(0);
    const outside = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".card button, .card a.btn, .card select"))
        .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().right > window.innerWidth + 0.5)
        .map((el) => el.textContent?.trim() || el.getAttribute("aria-label") || el.tagName),
    );
    expect(outside, route).toEqual([]);
  }
  await context.close();
});

for (const width of [390, 1440]) {
  test(`the tabs of Asetukset are links, the open one is in view and nothing scrolls sideways at ${width} px`, async ({ browser }) => {
    const { context, page } = await admin(browser, width, 900);
    const tabs = page.getByRole("navigation", { name: "Asetukset", exact: true });
    for (const target of Object.keys(TARGET_LABEL)) {
      await page.goto(`/#/settings/${target}`);
      const tab = tabs.getByRole("link", { name: TARGET_LABEL[target], exact: true });
      await expect(tab).toHaveAttribute("aria-current", "page");
      await expect(tab).toHaveAttribute("href", `/#/settings/${target}`);
      await expect(tab).toBeInViewport({ ratio: 0.99 });
      expect(await overflow(page), `${target} at ${width} px`).toBeLessThanOrEqual(0);
    }
    // a keyboard reaches the next tab and Enter opens it
    await page.goto("/#/settings/banks");
    await tabs.getByRole("link", { name: "Pankit ja tilit", exact: true }).focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect.poll(() => new URL(page.url()).hash).toBe("#/settings/household");
    await context.close();
  });
}
