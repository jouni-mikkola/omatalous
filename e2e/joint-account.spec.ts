import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { cents, linkFakeBank, makeMember, overflow, plain, removeMember, sayJointUse, setScope, waitForSync, watch } from "./helpers.ts";

// The joint account as two members see it. Both partners link the fake bank (e2e/fake-bank/), so its joint account has two
// users, and the first says they use it 60 and 40. Then the pages say a part: the switch of the view and the line under the
// header, the account row of Yhteenveto, the rows and the sums line of Tapahtumat, the caption of Tulot and the payday card.
// The members are made here and go at the end; the administrator's demo household, which the other specs read, is not touched.
const NAMES = ["e2e-yhteinen-a", "e2e-yhteinen-b"] as const;
const PARTS = [60, 40] as const;

interface Member {
  state: string;
  id: string;
}
const members: Member[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  for (const name of NAMES) {
    const member = await makeMember(browser, name);
    members.push(member);
    const context = await browser.newContext({ storageState: member.state });
    await linkFakeBank(await context.newPage());
    await waitForSync(context);
    // the first partner says who uses the joint account, as Asetukset > Tilit does; both copies are one real account
    if (members.length === 2) {
      const first = await browser.newContext({ storageState: members[0]!.state });
      await sayJointUse(first, members.map((m, i) => ({ userId: m.id, weight: PARTS[i]! * 100 })));
      await first.close();
    }
    await context.close();
  }
});
test.afterAll(async ({ browser }) => {
  for (const member of members) await removeMember(browser, member.id);
});

/** A member's session in a fresh context, in the view asked for before the page loads. */
async function open(browser: Browser, who: Member, path: string, options: { width?: number; household?: boolean } = {}) {
  const context = await browser.newContext({ storageState: who.state, viewport: { width: options.width ?? 1280, height: 900 } });
  if (options.household) await setScope(context, who.id, "household");
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto(path);
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  return { context, page, seen };
}

/** The line under the header that says how joint accounts are counted. */
const noticeOf = (page: Page, text: string) => page.locator(".notice").filter({ hasText: text });

/** The holdings card of Yhteenveto: the only card with a heading Varallisuus on that page. */
const holdingsOf = (page: Page) => page.locator(".card").filter({ has: page.getByRole("heading", { name: "Varallisuus", exact: true }) });
const jointRow = (page: Page) => holdingsOf(page).locator(".holding-row", { hasText: "Yhteistili" });
/** What the page shows for the joint account: the amount in its row, in cents. */
const jointCents = async (page: Page) => cents(await jointRow(page).locator(".holding-amount").innerText());

test("the switch offers Koko talous, and the line under the header says how joint accounts are counted in each view", async ({ browser }) => {
  const { context, page, seen } = await open(browser, members[0]!, "/#/overview");
  const view = page.getByRole("group", { name: "Näkymä" });
  await expect(view.getByRole("button", { name: "Oma", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(noticeOf(page, "Yhteisistä tileistä luvuissa on sinun osuutesi.")).toBeVisible();
  await expect(noticeOf(page, "Yhteiset tilit ovat luvuissa kokonaan.")).toHaveCount(0);

  await view.getByRole("button", { name: "Koko talous", exact: true }).click();
  await expect(view.getByRole("button", { name: "Koko talous", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(noticeOf(page, "Yhteiset tilit ovat luvuissa kokonaan.")).toBeVisible();
  await expect(noticeOf(page, "Yhteisistä tileistä luvuissa on sinun osuutesi.")).toHaveCount(0);

  // and back
  await view.getByRole("button", { name: "Oma", exact: true }).click();
  await expect(noticeOf(page, "Yhteisistä tileistä luvuissa on sinun osuutesi.")).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the joint account's row says the part, and the parts of the two members add up to the account in Koko talous", async ({ browser }) => {
  const own = await Promise.all(members.map((m) => open(browser, m, "/#/overview")));
  const whole = await Promise.all(members.map((m) => open(browser, m, "/#/overview", { household: true })));
  const [a, b] = own;
  // the row of an account that is the member's alone says nothing of a part
  await expect(jointRow(a!.page)).toContainText(`Yhteinen tili, osuutesi ${PARTS[0]} %`);
  await expect(jointRow(b!.page)).toContainText(`Yhteinen tili, osuutesi ${PARTS[1]} %`);
  await expect(holdingsOf(a!.page).locator(".holding-row", { hasText: "Käyttötili" })).not.toContainText("osuutesi");
  // Koko talous holds the account whole: no part on its row, and the same sum for both members
  for (const w of whole) await expect(jointRow(w.page)).not.toContainText("osuutesi");
  const [partA, partB, wholeA, wholeB] = [await jointCents(a!.page), await jointCents(b!.page), await jointCents(whole[0]!.page), await jointCents(whole[1]!.page)];
  expect(wholeA, "both members see the same account").toBe(wholeB);
  expect(partA + partB, "the two parts are the account").toBe(wholeA);
  expect(partA, "the first partner's part is the larger").toBeGreaterThan(partB);

  for (const s of [...own, ...whole]) expect(s.seen.problems).toEqual([]);
  for (const s of [...own, ...whole]) await s.context.close();
});

test("Tapahtumat shows the bank's amount and the part beside it on a row of the joint account, and says the sums are parts", async ({ browser }) => {
  const { context, page, seen } = await open(browser, members[0]!, "/#/transactions");
  const rows = page.locator("table tbody tr");
  const joint = rows.filter({ hasText: "Yhteistili" }).filter({ has: page.locator(".tx-part") }).first();
  await expect(joint).toBeVisible();
  const [amount, part] = (await joint.locator("td.num").innerText()).split("\n").map(plain);
  expect(part, "the part is told with its word").toMatch(/^osuutesi /);
  // the bank's amount stays, and the part is 60 % of it, to the cent
  const share = cents(part!.replace("osuutesi ", ""));
  expect(Math.abs(share - Math.round((cents(amount!) * PARTS[0]) / 100))).toBeLessThanOrEqual(1);
  expect(Math.abs(share)).toBeLessThan(Math.abs(cents(amount!)));
  // an account of the member's own is whole: no part beside it
  const own = rows.filter({ hasText: "Käyttötili" }).first();
  await expect(own).toBeVisible();
  await expect(own.locator(".tx-part")).toHaveCount(0);
  await expect(page.getByText("Yhteisen tilin tapahtumista summissa on sinun osuutesi.")).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();

  // Koko talous counts the account whole: the bank's amount alone, and no sentence about parts
  const whole = await open(browser, members[0]!, "/#/transactions", { household: true });
  await expect(whole.page.locator("table tbody tr").filter({ hasText: "Yhteistili" }).first()).toBeVisible();
  await expect(whole.page.locator(".tx-part")).toHaveCount(0);
  await expect(whole.page.getByText("Yhteisen tilin tapahtumista summissa on sinun osuutesi.")).toHaveCount(0);
  expect(whole.seen.problems).toEqual([]);
  await whole.context.close();
});

test("Tulot tells under Jäsenittäin that the joint account's income is divided by the parts, in Koko talous where the members are listed", async ({ browser }) => {
  const { context, page, seen } = await open(browser, members[0]!, "/#/reports?period=year", { household: true });
  const heading = page.getByRole("heading", { name: "Jäsenittäin" });
  await expect(heading).toBeVisible();
  const caption = page.locator(".income-caption", { hasText: "Yhteisen tilin tulot" });
  await expect(caption).toHaveText("Yhteisen tilin tulot on jaettu käyttäjien osuuksien mukaan.");
  // the caption stands under the heading and the list of the members
  const [h, c] = [await heading.boundingBox(), await caption.boundingBox()];
  expect(c!.y).toBeGreaterThan(h!.y);
  for (const name of NAMES) await expect(heading.locator("xpath=following-sibling::ul[1]")).toContainText(name);
  expect(seen.problems).toEqual([]);
  await context.close();
});

/** The card of the payday window on Yhteenveto. */
const paydayCard = (page: Page) => page.locator(".card", { has: page.getByRole("heading", { name: /^(Palkkapäivä |Seuraavat \d+ päivää)/ }) });

interface AheadRow {
  date: string;
  name: string;
  cents: number;
  source: "income" | "recurring" | "expected" | "card" | "transfer";
  basis?: "balance" | "usual";
}
interface Ahead {
  from: string;
  rows: AheadRow[];
  totals: { recurringCents: number; typedCents: number; cardCents: number; transferCents: number };
  balance: { counts: "own" | "part" | "all" } | null;
}

/** What the list shows of a row: the label and, for a card's bill, the note under it (the text of the cell, which has no space between the two). */
const listed = (r: AheadRow): string =>
  [
    r.source === "card" ? `Korttilasku (${r.name})` : r.source === "transfer" ? `Siirto tilille (${r.name})` : r.name,
    r.source === "card" ? (r.basis === "balance" ? "Käytetty luotto tänään" : "Arvio aiemmista laskuista") : "",
  ].join("");
/** The list's order: the payments first, then other pay. */
const inOrder = (rows: AheadRow[]): AheadRow[] => [...rows.filter((r) => r.cents < 0), ...rows.filter((r) => r.cents > 0)];
const bills = (a: Ahead): number => a.totals.recurringCents + a.totals.typedCents + a.totals.cardCents + a.totals.transferCents;
const COUNTS = { own: "Yhteiset tilit eivät ole mukana.", part: "Mukana on vain osuutesi yhteisestä tilistä." };

/** The figure of the card by its label, in whole euros. */
const figureOf = async (card: Locator, label: string) => cents(await card.locator(".ahead-figure", { hasText: label }).locator("dd").innerText()) / 100;

test("the payday card lists the rows of the window the API gives, and its foot says which accounts the balance counts", async ({ browser }) => {
  // The window depends on the day the spec runs: the fake bank's transfer to the joint account (the 1st) and its card's bill
  // (the 5th) come before the pay (the 25th) only from the 26th to the 5th. So the rows are the API's own answer for this
  // run, which the page must show exactly; the next test shows the two kinds of row whatever the day is.
  const { context, page, seen } = await open(browser, members[0]!, "/#/overview");
  const ahead: Ahead = (await (await context.request.get("/api/dashboard")).json()).ahead;
  const card = paydayCard(page);
  await expect(card).toBeVisible();
  const table = card.getByRole("table", { name: "Maksut ennen palkkapäivää" });
  const expected = inOrder(ahead.rows).map(listed);
  // a table is there exactly when the window has rows, and its rows are the window's rows in order
  await expect(table).toHaveCount(expected.length > 0 ? 1 : 0);
  await expect(table.locator("tbody tr td:first-child")).toHaveText(expected);
  expect(await figureOf(card, "Maksut ennen palkkapäivää")).toBe(Math.round(bills(ahead) / 100));
  // the joint account is not a counted balance for a member with a part of it, and the foot says so
  expect(ahead.balance!.counts).not.toBe("all");
  await expect(card.locator(".ahead-note").last()).toContainText(COUNTS[ahead.balance!.counts as "own" | "part"]);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the payday card names a card's bill and a transfer to the joint account, each with its note, and counts both in the payments", async ({ browser }) => {
  // The two kinds of row exist in the real answer only on some days of a month, so the answer is changed on its way, as
  // front-page.spec.ts does for a card with a limit: two rows are added and the totals follow, as core has them. Core's
  // tests hold the rows and the sums; this holds what the page makes of them.
  const context = await browser.newContext({ storageState: members[0]!.state, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  let stub: Ahead | null = null;
  await page.route(/\/api\/dashboard(\?|$)/, async (route) => {
    const response = await route.fetch().catch(() => null);
    const json = await response?.json().catch(() => null);
    if (!response || !json) return;
    const day = json.ahead.from as string;
    const added: AheadRow[] = [
      { date: day, name: "Yhteistili", cents: -60_000, source: "transfer" },
      { date: day, name: "ESIMERKKIPANKKI Luottokortti", cents: -56_241, source: "card", basis: "balance" },
      { date: day, name: "ESIMERKKIPANKKI Luottokortti", cents: -57_000, source: "card", basis: "usual" },
    ];
    json.ahead.rows = [...json.ahead.rows, ...added];
    json.ahead.totals.transferCents += 60_000;
    json.ahead.totals.cardCents += 113_241;
    stub = json.ahead;
    await route.fulfill({ response, json });
  });
  await page.goto("/#/overview");
  const card = paydayCard(page);
  await expect(card).toBeVisible();
  const table = card.getByRole("table", { name: "Maksut ennen palkkapäivää" });
  await expect(table.locator("tbody tr td:first-child")).toHaveText(inOrder(stub!.rows).map(listed));
  // the bill of the card says what its sum is, the transfer says nothing more
  const cardRows = table.getByRole("row").filter({ hasText: "Korttilasku (ESIMERKKIPANKKI Luottokortti)" });
  await expect(cardRows.nth(0).locator(".sub")).toHaveText("Käytetty luotto tänään");
  await expect(cardRows.nth(1).locator(".sub")).toHaveText("Arvio aiemmista laskuista");
  await expect(table.getByRole("row").filter({ hasText: "Siirto tilille (Yhteistili)" }).locator(".sub")).toHaveCount(0);
  // the figure of the payments holds the card's bill and the transfer, and the list adds up to it
  expect(await figureOf(card, "Maksut ennen palkkapäivää")).toBe(Math.round(bills(stub!) / 100));
  // a payment shows its sum with no sign, other pay with a plus; the payments in the list add up to the figure
  const shown = (await table.locator("tbody tr td:last-child").allInnerTexts()).map(plain);
  const paid = shown.filter((t) => !t.startsWith("+")).reduce((sum, t) => sum + cents(t), 0);
  expect(Math.abs(paid / 100 - (await figureOf(card, "Maksut ennen palkkapäivää")))).toBeLessThan(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("at 390 px the pages that say a part do not scroll sideways, in either view", async ({ browser }) => {
  for (const household of [false, true]) {
    for (const path of ["/#/overview", "/#/transactions", "/#/reports?period=year"]) {
      const { context, page, seen } = await open(browser, members[0]!, path, { width: 390, household });
      expect(await overflow(page), `${path} scrolls sideways (${household ? "Koko talous" : "own view"})`).toBeLessThanOrEqual(1);
      const wide = await page.evaluate(() => Array.from(document.querySelectorAll("table")).filter((t) => t.getBoundingClientRect().width > window.innerWidth + 1).length);
      expect(wide, `a table wider than the screen on ${path}`).toBe(0);
      expect(seen.problems).toEqual([]);
      await context.close();
    }
  }
});
