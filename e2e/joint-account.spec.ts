import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { cents, linkFakeBank, makeMember, overflow, plain, removeMember, sayJointUse, setScope, waitForSync, watch } from "./helpers.ts";

// The joint account as two members see it. Both partners link the fake bank (e2e/fake-bank/), so its joint account has two
// users, and the first says they use it 60 and 40. Then the pages say a part: the switch of the view, the account row of
// Yhteenveto, the rows and the sums line of Tapahtumat, the caption of Tulot and the block Erääntyvät maksut. No notice under the header says it.
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

/** A notice under the header that says how joint accounts are counted: no page, in neither view, has one. */
const jointNotice = (page: Page) => page.locator(".notice").filter({ hasText: /osuutesi|Yhteiset tilit/ });

/** The holdings card of Yhteenveto: the only card with a heading Varallisuus on that page. */
const holdingsOf = (page: Page) => page.locator(".card").filter({ has: page.getByRole("heading", { name: "Varallisuus", exact: true }) });
const jointRow = (page: Page) => holdingsOf(page).locator(".st-row", { hasText: "Yhteistili" });
/** What the page shows for the joint account: the amount in its row, in cents. */
const jointCents = async (page: Page) => cents(await jointRow(page).locator(".st-num").innerText());

test("the switch offers Koko talous, and no page has a notice about the joint accounts in either view: the rows say the part", async ({ browser }) => {
  const { context, page, seen } = await open(browser, members[0]!, "/#/overview");
  const view = page.getByRole("group", { name: "Näkymä" });
  await expect(view.getByRole("button", { name: "Oma", exact: true })).toHaveAttribute("aria-pressed", "true");
  // no notice under the header: the row of the joint account says the part itself
  await expect(jointNotice(page)).toHaveCount(0);
  await expect(jointRow(page)).toContainText(`osuutesi ${PARTS[0]} %`);

  await view.getByRole("button", { name: "Koko talous", exact: true }).click();
  await expect(view.getByRole("button", { name: "Koko talous", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(jointNotice(page)).toHaveCount(0);
  await expect(jointRow(page)).not.toContainText("osuutesi");

  // Säästövinkit counts the accounts whole in both views, and says nothing of it
  await page.goto("/#/optimise");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Säästövinkit", level: 1 })).toHaveCount(1);
  await expect(jointNotice(page)).toHaveCount(0);
  await view.getByRole("button", { name: "Oma", exact: true }).click();
  await expect(view.getByRole("button", { name: "Oma", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(jointNotice(page)).toHaveCount(0);

  // and back on the overview the own view has its part again
  await page.goto("/#/overview");
  await expect(jointRow(page)).toContainText(`osuutesi ${PARTS[0]} %`);
  await expect(jointNotice(page)).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("at 390 px the header has no fetch time, and the switch and the user menu stand on one row inside the screen", async ({ browser }) => {
  const { context, page, seen } = await open(browser, members[0]!, "/#/overview", { width: 390 });
  await expect(page.locator(".topbar").getByText(/Haettu/)).toHaveCount(0);
  const [toggle, menu] = [await page.locator(".scope-toggle").boundingBox(), await page.locator(".user-menu").boundingBox()];
  expect(toggle, "the switch is in the header").not.toBeNull();
  expect(menu, "the user menu is in the header").not.toBeNull();
  expect(Math.abs(toggle!.y + toggle!.height / 2 - (menu!.y + menu!.height / 2)), "the switch and the user menu are on one row").toBeLessThan(toggle!.height / 2);
  expect(menu!.x + menu!.width, "the user menu is inside the screen").toBeLessThanOrEqual(390);
  expect(await overflow(page), "Yhteenveto scrolls sideways at 390px").toBeLessThanOrEqual(1);
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
  await expect(holdingsOf(a!.page).locator(".st-row", { hasText: "Käyttötili" })).not.toContainText("osuutesi");
  // Koko talous holds the account whole: no part on its row, and the same sum for both members
  for (const w of whole) await expect(jointRow(w.page)).not.toContainText("osuutesi");
  const [partA, partB, wholeA, wholeB] = [await jointCents(a!.page), await jointCents(b!.page), await jointCents(whole[0]!.page), await jointCents(whole[1]!.page)];
  expect(wholeA, "both members see the same account").toBe(wholeB);
  expect(partA + partB, "the two parts are the account").toBe(wholeA);
  expect(partA, "the first partner's part is the larger").toBeGreaterThan(partB);

  for (const s of [...own, ...whole]) expect(s.seen.problems).toEqual([]);
  for (const s of [...own, ...whole]) await s.context.close();
});

test("Tapahtumat shows the part as a joint account's row's figure and the bank's amount under it, and has no line about the sums", async ({ browser }) => {
  const { context, page, seen } = await open(browser, members[0]!, "/#/transactions");
  const rows = page.locator("table tbody tr");
  const joint = rows.filter({ hasText: "Yhteistili" }).filter({ has: page.locator(".tx-part") }).first();
  await expect(joint).toBeVisible();
  const [part, bank] = (await joint.locator("td.num").innerText()).split("\n").map(plain);
  expect(bank, "the bank's amount is told with its words").toMatch(/^koko summa /);
  // the figure the day's sum counts is the part, 60 % of the bank's amount, to the cent
  const share = cents(part!);
  const amount = bank!.replace("koko summa ", "");
  expect(Math.abs(share - Math.round((cents(amount) * PARTS[0]) / 100))).toBeLessThanOrEqual(1);
  expect(Math.abs(share)).toBeLessThan(Math.abs(cents(amount)));
  // an account of the member's own is whole: no part beside it
  const own = rows.filter({ hasText: "Käyttötili" }).first();
  await expect(own).toBeVisible();
  await expect(own.locator(".tx-part")).toHaveCount(0);
  await expect(page.getByText("Yhteisen tilin tapahtumista summissa on sinun osuutesi.")).toHaveCount(0);
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

test("Tulot tells under Kenelle tulot tulevat? that the joint account's income is divided by the parts, in Koko talous where the members are listed", async ({ browser }) => {
  const { context, page, seen } = await open(browser, members[0]!, "/#/reports?period=year", { household: true });
  const heading = page.getByRole("heading", { name: "Kenelle tulot tulevat?" });
  await expect(heading).toBeVisible();
  const caption = page.locator(".income-caption", { hasText: "Yhteisen tilin tulot" });
  await expect(caption).toHaveText("Yhteisen tilin tulot on jaettu jäsenten osuuksien mukaan.");
  // the caption stands under the heading and the list of the members
  const [h, c] = [await heading.boundingBox(), await caption.boundingBox()];
  expect(c!.y).toBeGreaterThan(h!.y);
  for (const name of NAMES) await expect(heading.locator("xpath=following-sibling::ul[1]")).toContainText(name);
  expect(seen.problems).toEqual([]);
  await context.close();
});

/** The block Erääntyvät maksut on Yhteenveto. */
const paydayCard = (page: Page) => page.locator(".card", { has: page.getByRole("heading", { name: "Erääntyvät maksut", exact: true }) });

interface AheadRow {
  date: string;
  name: string;
  cents: number;
  source: "income" | "recurring" | "expected" | "card" | "transfer";
  basis?: "balance" | "usual";
}
interface Ahead {
  from: string;
  reason: "payday" | "late" | "none";
  payday: { name: string } | null;
  rows: AheadRow[];
  totals: { recurringCents: number; typedCents: number; cardCents: number; transferCents: number; dueCents: number };
  balance: { startCents: number; freeCents: number; counts: "own" | "part" | "all" } | null;
}

/** The line under the name of a card's bill, by what its sum is. */
const CARD_NOTE = { balance: "Luottokortin lasku", usual: "Luottokortin lasku, arvio aiemmista laskuista" };
/** What a table shows of a row: its name and, for a card's bill and a transfer, the line under it (the text of the cell, which has no space between the two). */
const listed = (r: AheadRow): string => r.name + (r.source === "card" ? CARD_NOTE[r.basis ?? "usual"] : r.source === "transfer" ? "Oma siirto" : "");
/** The rows of the table of the payments, in the window's order. */
const due = (a: Ahead): AheadRow[] => a.rows.filter((r) => r.cents < 0);
/** The names in the table Saapuvat maksut: other pay of the window, and the pay it waits for last. */
const arriving = (a: Ahead): string[] => [...a.rows.filter((r) => r.source === "income").map((r) => r.name), ...(a.reason === "payday" && a.payday ? [a.payday.name] : [])];
const bills = (a: Ahead): number => a.totals.recurringCents + a.totals.typedCents + a.totals.cardCents + a.totals.transferCents;
const COUNTS = { own: "Omat käyttötilit, ilman yhteistä tiliä", part: "Osuutesi yhteisestä tilistä" };

/** One of the three figures of the block by its label, in cents. */
const figureOf = async (card: Locator, label: string) => cents(await card.locator("dl .st-row", { hasText: label }).locator("dd.st-num").innerText());
const paymentsOf = (card: Locator) => card.getByRole("table", { name: /^Erääntyvät maksut / });

test("Erääntyvät maksut lists the rows of the window the API gives, and the line under Saldo says which accounts the balance counts", async ({ browser }) => {
  // The window depends on the day the spec runs: the fake bank's transfer to the joint account (the 1st) and its card's bill
  // (the 5th) come before the pay (the 25th) only from the 26th to the 5th. So the rows are the API's own answer for this
  // run, which the page must show exactly; the next test shows the two kinds of row whatever the day is.
  const { context, page, seen } = await open(browser, members[0]!, "/#/overview");
  const ahead: Ahead = (await (await context.request.get("/api/dashboard")).json()).ahead;
  const card = paydayCard(page);
  await expect(card).toBeVisible();
  // the table of payments is there whatever the window has: its rows are the window's payments in order, or one row that says there are none
  const expected = due(ahead).map(listed);
  await expect(paymentsOf(card)).toHaveCount(1);
  await expect(paymentsOf(card).locator("tbody td[colspan]")).toHaveText(expected.length > 0 ? [] : ["Ei erääntyviä maksuja."]);
  await expect(paymentsOf(card).locator("tbody tr td:nth-child(2)")).toHaveText(expected);
  // what is to arrive has a table of its own: other pay, and the pay the window waits for
  await expect(card.getByRole("table", { name: "Saapuvat maksut" }).locator("tbody tr td:nth-child(2)")).toHaveText(arriving(ahead));
  // the figure of the payments is the four kinds of payment, and what is free is the balance less them
  expect(bills(ahead)).toBe(ahead.totals.dueCents);
  expect(await figureOf(card, "Erääntyvät maksut")).toBe(bills(ahead));
  expect(await figureOf(card, "Käytettävissä")).toBe((await figureOf(card, "Saldo")) - bills(ahead));
  // the joint account is not a counted balance for a member with a part of it, and the line under Saldo says so
  expect(ahead.balance!.counts).not.toBe("all");
  await expect(card.locator("dl .st-row", { hasText: "Saldo" }).locator(".st-sub").first()).toHaveText(COUNTS[ahead.balance!.counts as "own" | "part"]);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Erääntyvät maksut names a card's bill and a transfer to the joint account, each with its line, and counts both in the payments", async ({ browser }) => {
  // The two kinds of row exist in the real answer only on some days of a month, so the answer is changed on its way, as
  // front-page.spec.ts does for a card with a limit: three rows are added, and the totals and what is free follow, as core
  // has them. Core's tests hold the rows and the sums; this holds what the page makes of them.
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
    json.ahead.totals.dueCents += 173_241;
    json.ahead.balance.freeCents -= 173_241;
    stub = json.ahead;
    await route.fulfill({ response, json });
  });
  await page.goto("/#/overview?period=month");
  const card = paydayCard(page);
  await expect(card).toBeVisible();
  const table = paymentsOf(card);
  await expect(table.locator("tbody tr td:nth-child(2)")).toHaveText(due(stub!).map(listed));
  // the bill of the card says what its sum is and the transfer that it is the member's own, and neither name is a link to Tapahtumat
  const cardRows = table.getByRole("row").filter({ hasText: "ESIMERKKIPANKKI Luottokortti" });
  expect((await cardRows.locator(".st-sub").allInnerTexts()).slice(-2)).toEqual([CARD_NOTE.balance, CARD_NOTE.usual]);
  const move = table.getByRole("row").filter({ hasText: "Yhteistili" }).last();
  await expect(move.locator(".st-sub")).toHaveText("Oma siirto");
  await expect(cardRows.getByRole("link")).toHaveCount(0);
  await expect(move.getByRole("link")).toHaveCount(0);
  // the figure of the payments holds the card's bills and the transfer, the table adds up to it to the cent, and what is
  // free is the balance less it
  const figure = await figureOf(card, "Erääntyvät maksut");
  expect(figure).toBe(bills(stub!));
  const shown = (await table.locator("tbody tr td:last-child").allInnerTexts()).map(cents);
  expect(shown.reduce((sum, c) => sum + c, 0)).toBe(figure);
  expect(await figureOf(card, "Käytettävissä")).toBe((await figureOf(card, "Saldo")) - figure);
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

/** The three ways to cut the joint account, on Tilit of the first partner's page. */
const splitGroup = (page: Page) => page.locator("#tilit").getByRole("group", { name: "Tilin Yhteistili osuudet" });
/** A press that saves: waits for the server's answer, so the next page does not cut the request. */
async function press(page: Page, button: Locator, route = "/api/accounts/") {
  const done = page.waitForResponse((r) => r.request().method() !== "GET" && r.url().includes(route));
  await button.click();
  await done;
}

test("each way to cut the joint account moves the figure of its row on Yhteenveto, and who paid names the part with no percent", async ({ browser }) => {
  const first = await open(browser, members[0]!, "/#/settings");
  const group = splitGroup(first.page);
  const tilit = first.page.locator("#tilit");
  const own = await open(browser, members[0]!, "/#/overview");
  const at60 = await jointCents(own.page);
  await own.context.close();

  // Prosentit: 70 and the rest to the other, the row says 70 % and its sum is 70 / 60 of what 60 % was
  await group.getByRole("button", { name: "Prosentit" }).click();
  await tilit.getByLabel(`${NAMES[0]} %`).fill("70");
  await expect(tilit.getByLabel(`${NAMES[1]} %`)).toHaveValue("30");
  await press(first.page, tilit.getByRole("button", { name: "Tallenna", exact: true }));
  const seventy = await open(browser, members[0]!, "/#/overview");
  await expect(jointRow(seventy.page)).toContainText("osuutesi 70 %");
  expect(Math.abs((await jointCents(seventy.page)) - Math.round((at60 * 70) / 60))).toBeLessThanOrEqual(1);
  await seventy.context.close();

  // Tasan: half of the account
  await press(first.page, group.getByRole("button", { name: "Tasan" }));
  const equal = await open(browser, members[0]!, "/#/overview");
  await expect(jointRow(equal.page)).toContainText("osuutesi 50 %");
  expect(Math.abs((await jointCents(equal.page)) - Math.round((at60 * 50) / 60))).toBeLessThanOrEqual(1);
  await equal.context.close();

  // who paid: no percent is told, the row says the figure is the viewer's part
  await press(first.page, group.getByRole("button", { name: "Sen mukaan, kuka tilille on maksanut" }));
  await expect(group.getByRole("button", { name: "Sen mukaan, kuka tilille on maksanut" })).toHaveAttribute("aria-pressed", "true");
  const paid = await open(browser, members[0]!, "/#/overview");
  await expect(jointRow(paid.page)).toContainText("Yhteinen tili, osuutesi");
  await expect(jointRow(paid.page)).not.toContainText("%");
  await paid.context.close();

  // at 390 px Tilit with the choice and its rows does not scroll sideways
  await first.page.setViewportSize({ width: 390, height: 844 });
  expect(await overflow(first.page)).toBeLessThanOrEqual(0);
  expect(first.seen.problems).toEqual([]);
  await first.context.close();
  // the first partner's 60 and 40 are said again for the specs after this one
  const again = await browser.newContext({ storageState: members[0]!.state });
  await sayJointUse(again, members.map((m, i) => ({ userId: m.id, weight: PARTS[i]! * 100 })));
  await again.close();
});

test("a payer nobody has named is a question: asked in Tarkistettavat with no guess, answered there and taken back on Tilit", async ({ browser }) => {
  const first = await open(browser, members[0]!, "/#/settings");
  const group = splitGroup(first.page);
  const tilit = first.page.locator("#tilit");
  await press(first.page, group.getByRole("button", { name: "Sen mukaan, kuka tilille on maksanut" }));
  // Tilit asks nothing: the question is in Tarkistettavat, and no notice on Yhteenveto tells it again
  await expect(tilit.getByRole("heading", { name: "Kenen rahaa?" })).toHaveCount(0);
  const overview = await open(browser, members[0]!, "/#/overview");
  await expect(overview.page.locator(".notice-item", { hasText: "Kenen rahaa tilillä" })).toHaveCount(0);
  const listed = await open(browser, members[0]!, "/#/transactions");
  await expect(listed.page.getByRole("link", { name: "Kenen?" }).first()).toBeVisible();
  await listed.context.close();

  // the queue holds it: Ohita moves on until the payer is the item shown
  const review = await open(browser, members[0]!, "/#/review");
  const item = review.page.locator(".review-item");
  const reach = async () => {
    await review.page.goto("/#/review");
    await review.page.reload();
    await expect(review.page.locator(".review-item, .review-end").first()).toBeVisible({ timeout: 15_000 });
    for (let n = 0; n < 25 && (await item.locator(".review-name").innerText()) !== "KORHONEN ELISA"; n++) {
      const was = await item.locator(".review-name").innerText();
      await item.getByRole("button", { name: "Ohita" }).click();
      await expect(item.locator(".review-name")).not.toHaveText(was);
    }
    await expect(item.locator(".review-name")).toHaveText("KORHONEN ELISA");
  };
  await reach();
  await expect(item.locator(".review-kind")).toHaveText(/^Yhteinen tili: Yhteistili$/i);
  await expect(item.getByRole("heading", { name: "Kenen rahaa tämä oli?" })).toBeVisible();
  await expect(item.locator(".review-choice")).toHaveText([NAMES[0], NAMES[1], "Yhteistä", "En tiedä"]);
  // no guess: a split exists only when a member said it
  await expect(item.locator(".review-guess")).toHaveCount(0);

  // an answer settles it: the next item shows, and Tilit lists the answer with Poista
  await press(review.page, item.getByRole("button", { name: "Yhteistä" }));
  await expect(item.locator(".review-name")).not.toHaveText("KORHONEN ELISA");
  await first.page.reload();
  const answers = tilit.getByRole("heading", { name: "Vastaukset" });
  await expect(answers).toBeVisible();
  const answered = tilit.locator(".use-row", { hasText: "KORHONEN ELISA" });
  await expect(answered).toContainText("Yhteistä");

  // taking it back brings the question back to the queue
  await press(first.page, answered.getByRole("button", { name: "Poista" }));
  await expect(answers).toHaveCount(0);
  await reach();

  expect(first.seen.problems).toEqual([]);
  expect(overview.seen.problems).toEqual([]);
  expect(review.seen.problems).toEqual([]);
  await first.context.close();
  await overview.context.close();
  await review.context.close();
  const again = await browser.newContext({ storageState: members[0]!.state });
  await sayJointUse(again, members.map((m, i) => ({ userId: m.id, weight: PARTS[i]! * 100 })));
  await again.close();
});
