import { type Browser, expect, test } from "@playwright/test";
import { join } from "node:path";
import { linkFakeBank, makeMember, overflow, removeMember, waitForSync, watch } from "./helpers.ts";

// Asetukset: the header link, the three targets, the card every old address lands on, and the repair of a bank connection
// that ended. The server has the administrator and the demo household already (e2e/run.mjs makes them). A member lives in
// the household for the length of the file.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const TARGET_LABELS = ["Pankit ja tilit", "Kotitalous", "Palvelin"];
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
  { heading: "Tiedot", target: "banks" },
  { heading: "Esimerkkitiedot", target: "banks", example: true },
  { heading: "Lainat", target: "household" },
  { heading: "Talouden jäsenet", target: "household", admin: true },
  { heading: "Salasana", target: "household" },
  { heading: "Kaksivaiheinen kirjautuminen", target: "household" },
  { heading: "Omat istunnot", target: "household" },
  { heading: "Palvelin", target: "server", admin: true },
  { heading: "Etäkäyttö", target: "server", admin: true },
  { heading: "Ylläpito", target: "server", admin: true },
  { heading: "Turvallisuusloki", target: "server", admin: true },
];
const TARGET_LABEL: Record<string, string> = { banks: "Pankit ja tilit", household: "Kotitalous", server: "Palvelin" };
/** The three targets that were folded into the others: their addresses open the target that has their cards. */
const FOLDED = ["members", "security", "data"];

let member: { state: string; id: string };
test.beforeAll(async ({ browser }) => {
  member = await makeMember(browser, "e2e-asetukset");
});
test.afterAll(async ({ browser }) => removeMember(browser, member.id));

async function admin(browser: Browser, width = 1440, height = 800) {
  const context = await browser.newContext({ storageState: STATE, viewport: { width, height } });
  const page = await context.newPage();
  return { context, page, seen: watch(page), hash: () => new URL(page.url()).hash };
}

test("Asetukset is in the user menu and has three targets, each its own address", async ({ browser }) => {
  const { context, page, seen, hash } = await admin(browser);
  const nav = page.getByRole("navigation", { name: "Päävalikko" });
  const targets = page.getByRole("navigation", { name: "Asetukset", exact: true });

  // the questions in the nav, Tarkistettavat the fourth, and Asetukset in the user menu instead of among them
  await page.goto("/#/overview");
  await expect(nav.getByRole("link")).toHaveText(["Yhteenveto", "Kuukausi", "Laskut", /^Tarkistettavat/, "Tapahtumat"]);
  await expect(nav.getByRole("link", { name: "Asetukset" })).toHaveCount(0);
  const menu = page.locator(".user-menu");
  await menu.locator("summary").click();
  await expect(menu.getByRole("link")).toHaveText(["Lisää", "Asetukset"]);
  await expect(menu.getByRole("button", { name: "Kirjaudu ulos" })).toBeVisible();
  const header = menu.getByRole("link", { name: "Asetukset", exact: true });
  await header.click();
  await expect.poll(hash).toBe("#/settings/banks");
  await expect(page).toHaveTitle(/^Asetukset/);
  await menu.locator("summary").click();
  await expect(header).toHaveAttribute("aria-current", "page");
  await menu.locator("summary").click();

  // the three targets in a row, the open one marked, and each opens its own address with its own cards
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
  await page.goto("/#/settings/household");
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
  await expect.poll(hash).toBe("#/settings/banks?section=csv");
  await expect(page.getByRole("heading", { name: "Pankkiyhteydet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tuo CSV" })).toHaveCount(0);
  await page.goto("/#/settings?add=1");
  await expect.poll(hash).toBe("#/settings/banks?add=1");
  await expect(page.getByRole("heading", { name: "Valitse pankki" })).toBeVisible();

  // a phone: the tabs in one row, Asetukset still in the user menu, and no target is wider than the screen
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
  const memberContext = await browser.newContext({ storageState: member.state, viewport: { width: 1440, height: 800 } });
  const memberPage = await memberContext.newPage();
  const memberSeen = watch(memberPage);
  const memberTargets = memberPage.getByRole("navigation", { name: "Asetukset", exact: true });
  await memberPage.goto("/#/settings");
  await expect(memberTargets.getByRole("link")).toHaveText(TARGET_LABELS.filter((l) => l !== TARGET_LABEL.server));
  await expect(memberTargets.getByRole("link", { name: TARGET_LABEL.server })).toHaveCount(0);
  for (const { heading, target, admin, example, fetched } of INVENTORY) {
    if (example || fetched) continue;
    if (admin) {
      // the admin's card on a target the member has too is not drawn there; the admin's own target opens the first one
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
  const { context, page, seen, hash } = await admin(browser, 1440, 600);
  const cases: [address: string, lands: string, card: string | null][] = [
    ["/#/settings", "#/settings/banks", null],
    ["/#/settings/banks#tilit", "#/settings/banks#tilit", "tilit"],
    ["/#/settings/household#lainat", "#/settings/household#lainat", "lainat"],
    ["/#/settings/household#salasana", "#/settings/household#salasana", "salasana"],
    ["/#/settings/household#kirjautuminen", "#/settings/household#kirjautuminen", "kirjautuminen"],
    ["/#/settings/server#palvelin", "#/settings/server#palvelin", "palvelin"],
    ["/#/settings/server#turvallisuusloki", "#/settings/server#turvallisuusloki", "turvallisuusloki"],
    ["/#/settings?section=technical", "#/settings/server", null],
    ["/#/settings?section=maintenance", "#/settings/server#yllapito", "yllapito"],
    // the three targets that were folded into the others: the address opens the target that has the card now
    ["/#/settings/members", "#/settings/household", null],
    ["/#/settings/security", "#/settings/household", null],
    ["/#/settings/data", "#/settings/banks", null],
    ["/#/settings/security#salasana", "#/settings/household#salasana", "salasana"],
    ["/#/settings/security#kirjautuminen", "#/settings/household#kirjautuminen", "kirjautuminen"],
    ["/#/settings/security#turvallisuusloki", "#/settings/server#turvallisuusloki", "turvallisuusloki"],
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

  // an address of a folded target, from Yhteenveto: Back returns there, not to the address that was rewritten
  await page.goto("/#/overview");
  await page.goto("/#/settings/security#turvallisuusloki");
  await expect.poll(hash).toBe("#/settings/server#turvallisuusloki");
  await expect(page.getByRole("heading", { name: "Turvallisuusloki", exact: true })).toBeVisible();
  await page.goBack();
  expect(page.url()).toMatch(/#\/overview$/);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a member's targets have their own cards and none of the admin's, and Hae nyt is a row of Päivitykset", async ({ browser }) => {
  const context = await browser.newContext({ storageState: member.state, viewport: { width: 1440, height: 800 } });
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
  // the address of the folded security target is the member's own sessions, and the admin's log is not there
  for (const folded of FOLDED) {
    await page.goto(`/#/settings/${folded}`);
    await expect.poll(hash, folded).toBe(folded === "data" ? "#/settings/banks" : "#/settings/household");
  }
  await page.goto("/#/settings/security#kirjautuminen");
  await expect.poll(hash).toBe("#/settings/household#kirjautuminen");
  await expect(page.getByRole("heading", { name: "Omat istunnot", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Turvallisuusloki", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Talouden jäsenet", exact: true })).toHaveCount(0);
  await expect(page.locator("#kirjautuminen")).toBeInViewport();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("an ended or ending bank connection has Yhdistä uudelleen on its row and in the banner, and the row starts the same bank again", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 800 } });
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

test("Kotitalous shows its cards when one read fails, and after a few seconds when one never answers", async ({ browser }) => {
  const { context, page } = await admin(browser);
  // one read fails: that card says so itself and the others work
  await page.route("**/api/security/sessions", (route) => route.fulfill({ status: 500, json: { error: "Palvelin ei vastannut." } }));
  await page.goto("/#/settings/household");
  await expect(page.getByRole("heading", { name: "Salasana", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Talouden jäsenet", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Omat istunnot" })).toBeVisible();
  await expect(page.getByText("Palvelin ei vastannut.")).toBeVisible();
  await expect(page.getByText("Ladataan…")).toHaveCount(0);
  await page.unroute("**/api/security/sessions");

  // one read never answers: the cards are drawn after 4 s at the latest
  await page.route("**/api/security/sessions", () => new Promise(() => {}));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Salasana", exact: true })).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole("heading", { name: "Lainat", exact: true })).toBeVisible();

  // the same on Palvelin, when the security log never answers
  await page.route("**/api/security/events*", () => new Promise(() => {}));
  await page.goto("/#/settings/server");
  await expect(page.getByRole("heading", { name: "Ylläpito", exact: true })).toBeVisible({ timeout: 8000 });
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
