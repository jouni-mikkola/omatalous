import { expect, test, type Browser } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// Asetukset > Pankkiyhteydet after a link: a new consent from any row, when the consent ends and the calendar file,
// the accounts the bank handed over that are not linked at Enable Banking, and the next bank. The server's answer for
// /api/meta is replaced, so no bank is called. Runs after app.spec.ts, which created the administrator.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

const BANKS = [
  { id: "nordea-fi", name: "Nordea", country: "FI" },
  { id: "op-fi", name: "OP", country: "FI" },
];

const consent = (id: string, institution: string, daysLeft: number, validUntil: string) => ({
  id,
  institution,
  status: "active",
  state: "active",
  history: false,
  replaced: false,
  validUntil,
  createdAt: "2026-07-17T00:00:00Z",
  lastSyncedAt: "2026-10-12T06:00:00Z",
  daysLeft,
});

const account = (id: string, connectionId: string, extra: Record<string, unknown> = {}) => ({
  id,
  userId: "u1",
  name: id,
  bankName: id,
  customName: null,
  holder: "Testi Esimerkki",
  cardMask: null,
  creditLimitCents: null,
  iban: null,
  currency: "EUR",
  type: "checking",
  provider: "enablebanking",
  connectionId,
  balanceCents: 123456,
  balanceAt: "2026-10-12T06:00:00Z",
  lastSyncedAt: "2026-10-12T06:00:00Z",
  problem: null,
  ...extra,
});

const notLinked = { kind: "not_linked", message: "tiliä ei ole linkitetty Enable Bankingissa." };
const IBANS = { chk: "FI2112345600000785", sav: "FI4950009420028730" };

/** A page of the signed-in administrator, with the consents and accounts `answer` gives for each read of /api/meta. Starting a bank is recorded, not made. */
async function open(browser: Browser, answer: (read: number) => { connections: unknown[]; accounts: unknown[] }, width = 1280) {
  const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const seen = watch(page);
  const state = { reads: 0 };
  await page.route("**/api/meta", async (route) => {
    // the page reads /api/meta by itself: a read still on its way when the page reloads or the context closes has no response left to change
    const response = await route.fetch().catch(() => null);
    const json = await response?.json().catch(() => null);
    if (!response || !json) return;
    const { connections, accounts } = answer(state.reads++);
    json.connections = connections;
    json.accounts = accounts;
    // the consents and the reminder day are dates of 2026-2027: the page compares them with this day, not with the day the suite runs
    json.today = "2026-10-12";
    json.bank = { ...json.bank, configured: true, redirectMode: "own", banks: BANKS, source: "instance" };
    await route.fulfill({ response, json });
  });
  const started: { bank?: string }[] = [];
  await page.route("**/api/connections/start", async (route) => {
    started.push(route.request().postDataJSON());
    await route.fulfill({ json: { url: "/#/settings?connected=1" } });
  });
  return { context, page, seen, started, state };
}

const card = (page: import("@playwright/test").Page) => page.locator("#pankkiyhteydet");

test("every consent has Yhdistä uudelleen, also with months left, and it starts the same bank without the picker", async ({ browser }) => {
  const connections = [consent("n1", "Nordea", 93, "2027-01-14T00:00:00Z"), consent("o1", "OP", 160, "2027-03-20T00:00:00Z")];
  const { context, page, seen, started } = await open(browser, () => ({ connections, accounts: [account("Käyttötili", "n1"), account("OP-tili", "o1")] }));
  await page.goto("/#/settings");
  const table = card(page).getByRole("table");
  await expect(table.getByRole("button", { name: "Yhdistä uudelleen" })).toHaveCount(2);

  // the end of the consent in words, in one column with the state
  await expect(table.getByRole("row", { name: /Nordea/ })).toContainText("voimassa 14.1.2027 asti, vielä 93 päivää");
  await expect(table.getByRole("row", { name: /OP/ })).toContainText("voimassa 20.3.2027 asti, vielä 160 päivää");
  await expect(table.getByRole("columnheader", { name: "Voimassa" })).toHaveCount(0);

  await table.getByRole("row", { name: /OP/ }).getByRole("button", { name: "Yhdistä uudelleen" }).click();
  await expect.poll(() => started.length).toBe(1);
  expect(started[0]).toMatchObject({ bank: "op-fi" });
  await expect(page.getByRole("heading", { name: "Valitse pankki" })).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).hash).toBe("#/settings?connected=1");
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the calendar file: one all-day event seven days before the end, with the address of the app and no account", async ({ browser }) => {
  const connections = [consent("n1", "Nordea", 93, "2027-01-14T00:00:00Z")];
  const { context, page, seen } = await open(browser, () => ({ connections, accounts: [account("Käyttötili", "n1", { iban: IBANS.chk })] }));
  await page.goto("/#/settings");
  await expect(card(page).getByText("voimassa 14.1.2027 asti")).toBeVisible();
  await expect(card(page).getByText("7.1.2027")).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), card(page).getByRole("button", { name: "Muistutus kalenteriin" }).click()]);
  expect(download.suggestedFilename()).toBe("pankkiyhteys-nordea-2027-01-14.ics");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  const unfolded = text.replaceAll("\r\n ", "");
  expect(unfolded).toContain("BEGIN:VEVENT\r\n");
  expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  expect(unfolded).toContain("DTSTART;VALUE=DATE:20270107\r\n");
  expect(unfolded).toContain("DTEND;VALUE=DATE:20270108\r\n");
  expect(unfolded).toContain("SUMMARY:Omatalous: pankkiyhteys vanhenee 14.1.2027\r\n");
  expect(unfolded).toContain("DESCRIPTION:Nordea: yhteys vanhenee 14.1.2027. Avaa Omatalous ja valitse Asetukset > Pankkiyhteydet > Yhdistä uudelleen.");
  // the address the page was opened from, and nothing of the account
  expect(unfolded).toContain(`URL:${new URL(page.url()).origin}/#/settings\r\n`);
  expect(text).not.toMatch(/FI21|0785|Käyttötili|Testi Esimerkki/);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a link that left accounts unread lists them by the bank's name and the last digits, and the step that fixes it", async ({ browser }) => {
  // the first fetch is still running at the first read of /api/meta: the page looks again by itself
  const connections = [consent("n1", "Nordea", 180, "2027-04-06T00:00:00Z")];
  const fresh = (read: number) => {
    const fetched = read >= 2;
    const fetchedAt = fetched ? "2026-10-12T06:00:00Z" : null;
    return [
      account("Käyttötili", "n1", { iban: IBANS.chk, lastSyncedAt: fetchedAt, problem: fetched ? notLinked : null }),
      account("Nordea Gold", "n1", { type: "credit_card", cardMask: "•••• 1144", creditLimitCents: 200000, lastSyncedAt: fetchedAt, problem: fetched ? notLinked : null }),
      account("Säästötili", "n1", { type: "savings", iban: IBANS.sav, lastSyncedAt: "2026-10-12T06:00:00Z" }),
    ];
  };
  const { context, page, seen, started } = await open(browser, (read) => ({ connections, accounts: fresh(read) }));
  await page.goto("/#/settings?connected=3");
  await page.reload();

  // the bank has just handed over three accounts: the next bank is offered, and the list waits for the first fetch
  const add = card(page).getByRole("button", { name: "Yhdistä toinen pankki" });
  await expect(add).toBeVisible();
  await expect(card(page).getByRole("button", { name: "Yhdistä pankki" })).toHaveCount(0);
  await expect(card(page).getByText("linkitetty Enable Bankingissa")).toHaveCount(0);

  const list = card(page).locator(".unlinked");
  await expect(list).toBeVisible({ timeout: 25_000 });
  await expect(list.getByText("2 tiliä ei ole linkitetty Enable Bankingissa.")).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveText(["Käyttötili · •••• 0785", "Nordea Gold · •••• 1144"]);
  await expect(list).toContainText("Linkitä ne Control Panelissa (API applications > Omatalous > Link accounts). Paina sen jälkeen Hae nyt.");
  await expect(list.getByRole("link", { name: "Avaa Control Panel" })).toHaveAttribute("href", "https://enablebanking.com/cp/applications");
  // never the whole number in the list
  await expect(list).not.toContainText(IBANS.chk.slice(0, 8));

  // the second bank: one press opens the picker, one more starts it
  await add.click();
  await expect(page.getByRole("heading", { name: "Valitse pankki" })).toBeVisible();
  await page.getByRole("button", { name: "Yhdistä OP" }).click();
  await expect.poll(() => started.length).toBe(1);
  expect(started[0]).toMatchObject({ bank: "op-fi" });
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the list is one line for one account, and not there when every account is read; a bank that brought none keeps the old button", async ({ browser }) => {
  const connections = [consent("n1", "Nordea", 180, "2027-04-06T00:00:00Z")];
  const one = await open(browser, () => ({ connections, accounts: [account("Käyttötili", "n1", { iban: IBANS.chk, problem: notLinked }), account("Säästötili", "n1", { iban: IBANS.sav })] }));
  await one.page.goto("/#/settings");
  await expect(card(one.page).getByText("Yksi tili ei ole linkitetty Enable Bankingissa.")).toBeVisible();
  await expect(card(one.page).locator(".unlinked").getByRole("listitem")).toHaveText(["Käyttötili · •••• 0785"]);
  await expect(card(one.page).getByRole("button", { name: "Yhdistä pankki" })).toBeVisible();
  expect(one.seen.problems).toEqual([]);
  await one.context.close();

  const none = await open(browser, () => ({ connections, accounts: [account("Käyttötili", "n1", { iban: IBANS.chk }), account("Säästötili", "n1", { iban: IBANS.sav })] }));
  await none.page.goto("/#/settings");
  await expect(card(none.page).getByRole("table")).toBeVisible();
  await expect(card(none.page).locator(".unlinked")).toHaveCount(0);
  expect(none.seen.problems).toEqual([]);
  await none.context.close();

  // a link that brought no account is a warning, and the next bank is not what it needs
  const empty = await open(browser, () => ({ connections, accounts: [] }));
  await empty.page.goto("/#/settings?connected=0");
  await empty.page.reload();
  await expect(empty.page.getByText("Pankki ei antanut tilejä.")).toBeVisible();
  await expect(card(empty.page).getByRole("button", { name: "Yhdistä pankki" })).toBeVisible();
  await expect(card(empty.page).getByRole("button", { name: "Yhdistä toinen pankki" })).toHaveCount(0);
  await empty.context.close();
});

test("390 px: the consents and the buttons fit without sideways scroll", async ({ browser }) => {
  // a consent that owns no account is among the answer too
  const earlier = { ...consent("h1", "Aktia", 0, "2026-05-01T00:00:00Z"), status: "expired", state: "lapsed", history: true };
  const connections = [consent("n1", "Nordea", 93, "2027-01-14T00:00:00Z"), consent("o1", "OP", 10, "2026-10-22T00:00:00Z"), earlier];
  const accounts = [account("Käyttötili", "n1", { iban: IBANS.chk, problem: notLinked }), account("OP-tili", "o1", { iban: IBANS.sav, problem: notLinked })];
  const { context, page, seen } = await open(browser, () => ({ connections, accounts }), 390);
  await page.goto("/#/settings?connected=2");
  await page.reload();
  await expect(card(page).locator(".unlinked")).toBeVisible();
  await expect(card(page).locator(".unlinked").getByRole("listitem")).toHaveText(["Nordea · Käyttötili · •••• 0785", "OP · OP-tili · •••• 8730"]);
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  // each consent is a block of its own, so its buttons are on the screen and not behind a sideways scroll
  for (const row of [0, 1]) {
    const renew = card(page).getByRole("button", { name: "Yhdistä uudelleen" }).nth(row);
    const remove = card(page).getByRole("button", { name: "Poista" }).nth(row);
    await renew.scrollIntoViewIfNeeded();
    for (const button of [renew, remove]) {
      const box = (await button.boundingBox())!;
      expect(box.x, `row ${row}`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `row ${row}`).toBeLessThanOrEqual(390);
    }
  }
  // the consent that owns no account is not listed
  await expect(card(page).getByText("Aiemmat yhteydet")).toHaveCount(0);
  await expect(card(page).getByText("Aktia")).toHaveCount(0);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a second press after the browser has left for the bank starts nothing more", async ({ browser }) => {
  const connections = [consent("n1", "Nordea", 93, "2027-01-14T00:00:00Z")];
  const { context, page, seen, started } = await open(browser, () => ({ connections, accounts: [account("Käyttötili", "n1")] }));
  await page.goto("/#/settings");
  const renew = card(page).getByRole("button", { name: "Yhdistä uudelleen" });
  await renew.dblclick();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/settings?connected=1");
  // the address is set: the buttons stay disabled for as long as this page is there, so a late press posts nothing
  await expect(renew).toBeDisabled();
  await expect(card(page).getByRole("button", { name: "Poista" })).toBeDisabled();
  await renew.click({ force: true });
  await page.waitForTimeout(500);
  expect(started).toHaveLength(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});
