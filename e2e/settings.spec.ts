import { type Browser, expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { linkFakeBank, makeMember, overflow, removeMember, waitForSync, watch } from "./helpers.ts";

// Asetukset: the header link, the plain page and the technical page, the card every old address lands on, and the repair
// of a bank connection that ended. The server has the administrator and the demo household already (e2e/run.mjs makes
// them). A member lives in the household for the length of the file: Tilien jakaminen is a card only beside a second member.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const PLAIN = ["Pankkiyhteydet", "Tilit", "Talouden jäsenet", "Jäsenet ilman tunnusta", "Tilien jakaminen", "Lainat", "Tiedot", "Salasana", "Tekniset asetukset", "Kaksivaiheinen kirjautuminen", "Tietoja"];
const MEMBER_PLAIN = PLAIN.filter((h) => h !== "Talouden jäsenet" && h !== "Jäsenet ilman tunnusta");

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

test("Asetukset is a link in the header to one plain page, and Tekniset asetukset opens the page of the rest", async ({ browser }) => {
  const { context, page, seen, hash } = await admin(browser);
  const nav = page.getByRole("navigation", { name: "Päävalikko" });

  // five questions in the nav, and Asetukset beside the user menu instead of among them
  await page.goto("/#/overview");
  await expect(nav.getByRole("link")).toHaveText(["Yhteenveto", "Laskut", "Tapahtumat", "Raportit", "Säästövinkit"]);
  await expect(nav.getByRole("link", { name: "Asetukset" })).toHaveCount(0);
  const header = page.locator("header.topbar").getByRole("link", { name: "Asetukset", exact: true });
  await header.click();
  await expect.poll(hash).toBe("#/settings");
  await expect(page).toHaveTitle(/^Asetukset/);
  await expect(header).toHaveAttribute("aria-current", "page");

  // one page for everyone, no tabs: what a household sets, and the way to the rest
  await expect(page.getByRole("group", { name: "Asetukset" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(PLAIN);
  await expect(page.getByRole("button", { name: "Yhdistä pankki" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hae nyt" }), "no connection, nothing to fetch").toHaveCount(0);
  await expect(page.locator("#pankkiyhteydet").getByText("Yhdistä ensin pankki.")).toHaveCount(0);
  await expect(page.getByText("Lisää seuraava tili")).toHaveCount(0);
  for (const gone of ["Haku pankista", "Omat istunnot", "Esimerkkitiedot", "Palvelin", "Turvallisuusloki", "Tietojen laatu"]) {
    await expect(page.getByRole("heading", { name: gone, exact: true }), gone).toHaveCount(0);
  }

  // Salasana: a card with a button, which opens the three fields and can close them
  const password = page.locator("#salasana");
  await expect(password.getByLabel("Nykyinen salasana")).toHaveCount(0);
  await password.getByRole("button", { name: "Vaihda salasana" }).click();
  await expect(password.getByLabel("Nykyinen salasana")).toBeVisible();
  await expect(password.getByLabel("Uusi salasana (vähintään 12 merkkiä)")).toBeVisible();
  await password.getByRole("button", { name: "Peruuta" }).click();
  await expect(password.getByLabel("Nykyinen salasana")).toHaveCount(0);

  // Tekniset asetukset: the rest, with the way back
  await page.getByRole("link", { name: "Avaa", exact: true }).click();
  await expect.poll(hash).toBe("#/settings?section=technical");
  await expect(page.getByRole("link", { name: "← Asetukset" })).toBeVisible();
  for (const heading of ["Haku pankista", "Omat istunnot", "Esimerkkitiedot", "Palvelin", "Turvallisuusloki"]) {
    await expect(page.getByRole("heading", { name: heading, exact: true }), heading).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Ylläpito", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pankkiyhteydet", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Salasana", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "← Asetukset" }).click();
  await expect.poll(hash).toBe("#/settings");
  await expect(page.getByRole("heading", { name: "Tekniset asetukset", exact: true })).toBeVisible();

  // Raportit no longer has the card, and Yhteenveto has no line that links to it (a warning about the data is a row of Ilmoitukset)
  await page.goto("/#/reports");
  await expect(page.getByRole("heading", { name: "Tietojen laatu" })).toHaveCount(0);
  await page.goto("/#/overview");
  await expect(page.getByRole("link", { name: "Tietojen laatu" })).toHaveCount(0);

  // the address of the removed CSV import and the bank picker open the plain page
  await page.goto("/#/settings?section=csv");
  await expect(page.getByRole("heading", { name: "Pankkiyhteydet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tuo CSV" })).toHaveCount(0);
  await page.goto("/#/settings?add=1");
  await expect(page.getByRole("heading", { name: "Valitse pankki" })).toBeVisible();

  // Vaihda salasana in the user menu opens Salasana with the form
  await page.goto("/#/overview");
  await page.locator(".user-menu summary").click();
  await page.getByRole("link", { name: "Vaihda salasana" }).click();
  await expect.poll(hash).toBe("#/settings#salasana");
  await expect(page.getByLabel("Nykyinen salasana")).toBeVisible();
  await expect(page.getByLabel("Uusi salasana (vähintään 12 merkkiä)")).toBeVisible();

  // a phone: five labels in one row, Asetukset still in the header, and neither page is wider than the screen
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/#/overview");
  const tops = await nav.getByRole("link").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size, "the five labels share one row").toBe(1);
  await expect(page.locator("header.topbar").getByRole("link", { name: "Asetukset", exact: true })).toBeVisible();
  for (const address of ["/#/settings", "/#/settings?section=technical"]) {
    await page.goto(address);
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
    expect(await overflow(page), address).toBeLessThanOrEqual(1);
  }
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("every address of Asetukset lands on the card it names, on the page that has it, and the rewrite leaves no old entry for Back", async ({ browser }) => {
  // a short screen, so that a card low on the page is out of sight until the address brings it
  const { context, page, seen, hash } = await admin(browser, 1280, 600);
  await withQualityNote(page);
  const cases: [address: string, lands: string, card: string | null][] = [
    ["/#/settings?tab=talous", "#/settings", null],
    ["/#/settings#tilit", "#/settings#tilit", "tilit"],
    ["/#/settings#lainat", "#/settings#lainat", "lainat"],
    ["/#/settings#salasana", "#/settings#salasana", "salasana"],
    ["/#/settings?tab=talous#turvallisuusloki", "#/settings?section=technical#turvallisuusloki", "turvallisuusloki"],
    ["/#/settings?section=security", "#/settings?section=technical#turvallisuusloki", "turvallisuusloki"],
    ["/#/settings#kirjautuminen", "#/settings?section=technical#kirjautuminen", "kirjautuminen"],
    ["/#/settings#laatu", "#/settings?section=technical#laatu", "laatu"],
    ["/#/settings?section=server", "#/settings?section=server", "palvelin"],
    ["/#/settings?section=maintenance", "#/settings?section=maintenance", "yllapito"],
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
      await expect(page.getByRole("heading", { name: "Pankkiyhteydet", exact: true })).toBeVisible();
    }
  }

  // the old security address, from Yhteenveto: Back returns there, not to the address that was rewritten
  await page.goto("/#/overview");
  await page.goto("/#/settings?section=security");
  await expect.poll(hash).toBe("#/settings?section=technical#turvallisuusloki");
  await expect(page.getByRole("heading", { name: "Turvallisuusloki", exact: true })).toBeVisible();
  await page.goBack();
  expect(page.url()).toMatch(/#\/overview$/);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a member's plain page has the plain cards, the technical page has none of the admin's, and Hae nyt is a row of Haku pankista", async ({ browser }) => {
  const context = await browser.newContext({ storageState: member.state, viewport: { width: 1280, height: 800 } });
  // without a connection there is nothing to fetch: no button, no sentence about it
  const before = await context.newPage();
  await before.goto("/#/settings");
  await expect(before.getByRole("heading", { level: 2 })).toHaveText(MEMBER_PLAIN);
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

  // the fetch is a row of Haku pankista on the technical page
  await page.getByRole("link", { name: "Avaa", exact: true }).click();
  await expect.poll(hash).toBe("#/settings?section=technical");
  const runs = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Haku pankista", exact: true }) });
  await expect(runs.getByRole("row").filter({ hasText: "käsin" })).toHaveCount(1);
  await expect(runs.getByRole("row").filter({ hasText: "uusi yhteys" })).toHaveCount(1);
  await expect(page.getByText("Ei hakuja.")).toHaveCount(0);

  // a member sees the cards that are theirs and none of the admin's, whichever address opens the page
  await expect(page.getByRole("heading", { name: "Omat istunnot", exact: true })).toBeVisible();
  await expect(page.getByText("Oma Enable Banking -sovellus", { exact: true })).toBeVisible();
  for (const address of ["/#/settings?section=technical", "/#/settings?section=server", "/#/settings?section=maintenance", "/#/settings?section=security"]) {
    await page.goto(address);
    await expect(page.getByRole("heading", { name: "Haku pankista", exact: true }), address).toBeVisible();
    for (const admins of ["Palvelin", "Turvallisuusloki", "Ylläpito"]) await expect(page.getByRole("heading", { name: admins, exact: true }), `${address}: ${admins}`).toHaveCount(0);
  }
  // the old security address is the member's own sessions, and a card with a note comes with the note
  await expect.poll(hash).toBe("#/settings?section=technical#kirjautuminen");
  await expect(page.locator("#kirjautuminen")).toBeInViewport();
  await page.goto("/#/settings#laatu");
  await expect.poll(hash).toBe("#/settings?section=technical#laatu");
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
    await page.goto("/#/settings?section=technical#laatu");
    const block = page.locator("#laatu");
    await expect(block.locator("strong").first()).toContainText("ilman ostoja");
    await expect(block).not.toContainText("lasketaan menoiksi");
    const table = block.getByRole("table");
    if (width === 1280) await expect(table.getByRole("columnheader")).toHaveText(["Kortti", "Laskut 12 kuukaudelta", "Miksi ostot puuttuvat"]);
    const lines = await table.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => (tr.textContent ?? "").replace(/\s+/g, " ")));
    expect(lines[0]).toContain("Morrow Bank");
    expect(lines[0]).toContain("Korttia ei ole yhdistetty.");
    expect(lines[1]).toContain("Bank Norwegian ·· 1234");
    expect(lines[1]).toContain("Pankki antaa ostot vasta 1.9.2026 alkaen.");
    await expect(block.getByRole("link", { name: "Yhdistä pankki" })).toHaveAttribute("href", "#/settings?add=1");
    await expect(block.getByRole("link", { name: "Näytä tapahtumat" })).toBeVisible();
    expect(await overflow(page), `the page scrolls sideways at ${width} px`).toBeLessThanOrEqual(1);
    expect(seen.problems).toEqual([]);
    await context.close();
  }
});

test("Tietojen laatu opens with the share of spending filed without asking, at 1280 and 390", async ({ browser }) => {
  // made-up shares: the answer is changed on its way, core's tests hold how they are made
  const cases = [
    { filed: { share: 0.874, guessShare: 0.004, userShare: 0.06, cents: 874_00, totalCents: 1000_00 }, lines: ["Viimeisen 12 kuukauden menoista 87 % on luokiteltu ilman kysymistä.", "Näistä arvioita alle 1 %. Itse luokittelit 6 %."] },
    { filed: { share: 1, guessShare: 0, userShare: 0, cents: 500_00, totalCents: 500_00 }, lines: ["Viimeisen 12 kuukauden menoista 100 % on luokiteltu ilman kysymistä."] },
  ];
  for (const width of [1280, 390]) {
    for (const c of cases) {
      const { context, page, seen } = await admin(browser, width, 900);
      await page.route("**/api/reports?**", async (route) => {
        const answer = await route.fetch();
        await route.fulfill({ response: answer, json: { ...(await answer.json()), dataQuality: { signals: [], filed: c.filed } } });
      });
      await page.goto("/#/settings?section=technical#laatu");
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
  await page.goto("/#/settings?section=technical");
  await expect(page.getByRole("heading", { name: "Haku pankista", exact: true })).toBeVisible();
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
  await expect(banner.getByRole("link", { name: "Yhdistä uudelleen" })).toHaveAttribute("href", "#/settings?add=1");
  await banner.getByRole("link", { name: "Yhdistä uudelleen" }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/settings?add=1");
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

test("Tekniset asetukset draws no empty cards while its data is on the way, only the loading placeholder", async ({ browser }) => {
  const { context, page, seen } = await admin(browser);
  // the first answer is held until the test lets it go
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/sync/runs", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/#/settings?section=technical");
  await expect(page.getByRole("status").getByText("Ladataan…")).toBeVisible();
  // no card is drawn, so no empty frame is either
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
  await expect(page.locator(".card:not(.skeleton):visible")).toHaveCount(0);
  release();
  await expect(page.getByRole("heading", { name: "Haku pankista" })).toBeVisible();
  await expect(page.getByRole("status").getByText("Ladataan…")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Tekniset asetukset shows its cards when one read fails, and after a few seconds when one never answers", async ({ browser }) => {
  const { context, page } = await admin(browser);
  // one read fails: that card says so itself and the others work
  await page.route("**/api/security/sessions", (route) => route.fulfill({ status: 500, json: { error: "Palvelin ei vastannut." } }));
  await page.goto("/#/settings?section=technical");
  await expect(page.getByRole("heading", { name: "Haku pankista" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Turvallisuusloki", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Omat istunnot" })).toBeVisible();
  await expect(page.getByText("Palvelin ei vastannut.")).toBeVisible();
  await expect(page.getByText("Ladataan…")).toHaveCount(0);
  await page.unroute("**/api/security/sessions");

  // one read never answers: the cards are drawn after 4 s at the latest
  await page.route("**/api/security/events*", () => new Promise(() => {}));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Haku pankista" })).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole("heading", { name: "Omat istunnot" })).toBeVisible();
  await context.close();
});
