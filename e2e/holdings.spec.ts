import { expect, test, type Locator, type Page } from "@playwright/test";
import { join } from "node:path";
import { cents, overflow, plain, watch } from "./helpers.ts";

// Varat ja velat: the names of accounts, cards and loans are links, the sums of a group stand on one right edge, Tilit and
// Lainat stand side by side from 900 px with the cards in a row under them (a household with no loan has Tilit and its
// cards side by side), a card is a flat row and its arc shows what is used. The demo household of the
// administrator (e2e/run.mjs) has a checking and a savings account and a card with no limit and no last digits; the
// loan this spec saves is removed again, so the specs after it find the household as they expect.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };

test.describe.configure({ mode: "serial" });

const holdingsOf = (page: Page) => page.getByRole("region", { name: "Varat ja velat", exact: true });
const groupOf = (page: Page, heading: string) => holdingsOf(page).locator("section", { has: page.getByRole("heading", { name: heading, exact: true }) });
const colour = (el: Locator) => el.evaluate((node) => getComputedStyle(node).color);
/** Where the right edges of the elements are, to a tenth of a pixel. */
const rights = (els: Locator) => els.evaluateAll((nodes) => nodes.map((n) => Math.round(n.getBoundingClientRect().right * 10) / 10));

let loanId = "";
test.afterAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE });
  if (loanId) await context.request.delete(`/api/loans/${loanId}`, { headers: FETCH });
  await context.close();
});

test("a name opens its rows in Tapahtumat, in the colour of a link and underlined when pointed at, and no total is a link", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=saldot");
  const holdings = holdingsOf(page);
  await expect(holdings).toBeVisible();

  // an account: the link is in the accent colour, not the colour of the other words of the row, and underlined when hovered
  const account = holdings.getByRole("link", { name: "Käyttötili (esimerkki)" });
  const plainText = await colour(holdings.locator(".st-total .st-name", { hasText: "Tilit yhteensä" }));
  const underline = (el: Locator) => el.evaluate((node) => getComputedStyle(node).textDecorationLine);
  expect(await colour(account), "a name is a link in the colour of one").not.toBe(plainText);
  expect(await underline(account)).toBe("none");
  await account.hover();
  expect(await underline(account), "a link shows itself when pointed at").toBe("underline");

  // a total is no link, the sum of one group or of the block
  await expect(holdings.getByRole("link", { name: /yhteensä$/i })).toHaveCount(0);

  // the Tili chip of Tapahtumat names the account the address picked
  const tili = page.locator(".tx-fchip.set").filter({ has: page.locator(".tx-fchip-name", { hasText: /^Tili$/ }) });
  const chosen = async () => ({ id: new URLSearchParams(page.url().split("?")[1]).get("accountId") ?? "", name: await tili.locator(".tx-fchip-value").innerText() });
  await account.click();
  await expect(page).toHaveURL(/#\/transactions\?accountId=/);
  await expect(tili).toBeVisible();
  const first = await chosen();
  expect(first.name).toContain("Käyttötili (esimerkki)");
  expect(new URL(page.url()).hash).toBe(`#/transactions?accountId=${encodeURIComponent(first.id)}`);

  // a card: the same, with the card's name as the account is called
  await page.goto("/#/reports?q=saldot");
  await holdingsOf(page).getByRole("link", { name: "Nordea Gold (esimerkki)" }).click();
  await expect(page).toHaveURL(/#\/transactions\?accountId=/);
  await expect(tili).toBeVisible();
  const second = await chosen();
  expect(second.name).toContain("Nordea Gold (esimerkki)");
  expect(second.id).not.toBe(first.id);

  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the focus of a link shows whole, inside the name that is cut", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto("/#/reports?q=saldot");
  const link = holdingsOf(page).getByRole("link", { name: "Käyttötili (esimerkki)" });
  await expect(link).toBeVisible();
  // by the keyboard, so that the browser shows the ring
  await link.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  const box = await link.evaluate((a) => {
    const style = getComputedStyle(a);
    const ring = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
    const r = a.getBoundingClientRect();
    const cell = a.parentElement!.getBoundingClientRect();
    return { shown: style.outlineStyle !== "none", leftSpare: r.left - ring - cell.left, topSpare: r.top - ring - cell.top, rightSpare: cell.right - (r.right + ring), bottomSpare: cell.bottom - (r.bottom + ring) };
  });
  expect(box.shown, "the focused link has a ring").toBe(true);
  for (const side of ["leftSpare", "topSpare", "rightSpare", "bottomSpare"] as const) expect(box[side], `the ring is cut at the ${side}`).toBeGreaterThanOrEqual(-0.01);
  await context.close();
});

test("the sums of a group stand on one right edge, an account's row is 54 px, two weights only, and a card with no limit is its name, its digits and one figure, with the day of the balances once in the heading", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/reports?q=saldot");
  const holdings = holdingsOf(page);
  await expect(holdings).toBeVisible();

  // Tilit: the two accounts and the total at the foot end at one x
  const tilit = groupOf(page, "Tilit");
  const edges = await rights(tilit.locator(".st-num"));
  expect(edges.length, "the total and two accounts").toBe(3);
  // no bracket stands beside the accounts, so the total's sum ends where theirs do
  expect(new Set(edges).size, `the sums end at ${edges.join(", ")}`).toBe(1);

  // a row of an account is 54 px with its hairline: room for the curve that will stand between the name and the sum
  // (measured once the page's entry has ended: it reads 53.99998 while it runs)
  await page.locator("#root").evaluate((e) => Promise.all(e.getAnimations({ subtree: true }).map((a) => a.finished)));
  const row = (await tilit.locator("li.st-row", { hasText: "Säästötili (esimerkki)" }).boundingBox())!;
  expect(row.height).toBeGreaterThanOrEqual(54);
  expect(row.height).toBeLessThanOrEqual(55);

  // 400 and 600 and no other weight in the block
  const weights = await holdings.evaluate((root) => {
    const found = new Set<string>();
    for (const el of Array.from(root.querySelectorAll("*"))) if (Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim())) found.add(getComputedStyle(el).fontWeight);
    return [...found].sort();
  });
  expect(weights).toEqual(["400", "600"]);

  // the heading names the day of the balances, and the rows repeat it nowhere
  await expect(holdings.locator(".holding-date")).toHaveText(/^Saldo päivältä \d/);
  // the demo's card has a name, its last digits and what is used: no limit row, no meter, and no line without words
  const card = groupOf(page, "Luottokortit").locator(".holding-unit");
  await expect(card.locator(".st-row")).toHaveCount(1);
  await expect(card.locator(".st-row").last().locator(".st-name")).toHaveText("Käytetty luotto");
  await expect(card.locator(".card-face")).toHaveCount(1);
  await expect(card.locator(".card-face-mask")).toHaveText("•••• 4242");
  await expect(card.locator(".st-sub")).toHaveCount(0);
  await expect(card.locator(".card-meter, .sr-only")).toHaveCount(0);
  // no limit, so no arc and no picture beyond the row
  await expect(card.locator(".credit-arc, .holding-unit-body svg, .holding-unit-body img")).toHaveCount(0);
  for (const line of await holdings.locator(".st-row, .st-sub").all()) expect(plain(await line.innerText()), "a row or a line without words").not.toBe("");
  // no loan, so no hole where it would be: Tilit and the cards stand side by side, the cards running to the right edge
  await expect(holdings.getByRole("heading", { name: "Lainat", exact: true })).toHaveCount(0);
  const [accounts, cards] = await Promise.all([tilit.boundingBox(), groupOf(page, "Luottokortit").boundingBox()]);
  expect(cards!.x, "two groups side by side").toBeGreaterThan(accounts!.x + accounts!.width - 2);
  expect(Math.abs(cards!.y - accounts!.y)).toBeLessThanOrEqual(1);
  // of two groups the first has five parts and the second seven
  const whole = (await holdings.boundingBox())!;
  // the groups run to the frame's edges; the rule between them is the register's split after the fifth column (--split-5)
  // --gap is in rem, so it is read as a width
  const gap = await holdings.evaluate((el) => {
    const probe = document.createElement("div");
    probe.style.width = "var(--gap)";
    el.append(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  });
  const column = (whole.width - 2 - 11 * gap) / 12;
  expect(Math.abs(cards!.x - (whole.x + 1 + 5 * column + 4.5 * gap - 1)), "the second group starts on the split after five columns").toBeLessThanOrEqual(2);
  expect(Math.abs(cards!.x + cards!.width - (whole.x + whole.width - 1)), "and runs to the frame's right edge").toBeLessThanOrEqual(2);

  expect(seen.problems).toEqual([]);
  await context.close();
});

test("every card is a flat row above its figures, with its name as the one link and its digits as text, and nothing scrolls sideways", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  // five cards, one for each tone, the way a household with five would be answered
  const cards = ["Esimerkkipankki Gold", "Esimerkkipankki Platinum", "Esimerkkipankki Black", "Esimerkkipankki Silver", "Esimerkkipankki Luotto"].map((name, i) => ({
    id: `face-${i}`, name, bank: "Esimerkkipankki", ownerName: null, mask: `•••• ${1000 + i}`, limitCents: 300_000, usedCents: 120_000 * i, freeCents: Math.max(0, 300_000 - 120_000 * i), overCents: Math.max(0, 120_000 * i - 300_000), balanceAt: null,
  }));
  await page.route(/\/api\/reports(\?|$)/, async (route) => {
    const response = await route.fetch().catch(() => null);
    const json = await response?.json().catch(() => null);
    if (!response || !json) return;
    if (!json.balances) return route.fulfill({ response, json });
    json.balances.holdings.cards = cards;
    json.balances.holdings.cardsCents = cards.reduce((sum, c) => sum + c.usedCents, 0);
    await route.fulfill({ response, json });
  });
  await page.goto("/#/reports?q=saldot");
  const group = groupOf(page, "Luottokortit");
  const units = group.locator(".holding-unit");
  await expect(units).toHaveCount(5);

  // one flat row for each card, in its unit, with its last four digits as text
  await expect(group.locator(".card-face")).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    await expect(units.nth(i).locator(".card-face-mask")).toHaveText(`•••• ${1000 + i}`);
  }
  // the name is the one link of the row, whole, and nothing of the row is hidden from a screen reader or out of the tab order
  await expect(units.nth(1).getByRole("link", { name: "Esimerkkipankki Platinum", exact: true })).toBeVisible();
  await expect(units.nth(1).locator(".card-face a")).toHaveCount(1);
  await expect(units.nth(1).locator(".card-face [aria-hidden], .card-face [tabindex]")).toHaveCount(0);

  // the row is text: no picture, no chip
  await expect(units.first().locator(".card-face svg, .card-face img")).toHaveCount(0);

  // each card has the arc of what is used, named by its two figures; the card over its limit has it in the colour of what is wrong
  await expect(group.locator(".credit-arc")).toHaveCount(5);
  await expect(units.nth(1).getByRole("img", { name: /^Käytetty luotto 1\D*200,00\D*€, luottoraja 3\D*000,00\D*€$/ })).toHaveCount(1);
  await expect(group.locator(".credit-arc-over")).toHaveCount(2);
  for (const over of [3, 4]) await expect(units.nth(over).locator(".credit-arc-over")).toHaveCount(1);
  const arcPaint = (unit: number) => units.nth(unit).locator(".credit-arc-fill").evaluate((el) => getComputedStyle(el).stroke);
  expect(await arcPaint(4), "over the limit the arc is in the colour of what is wrong").toBe(await units.nth(4).locator(".holding-bad").evaluate((el) => getComputedStyle(el).color));
  expect(await arcPaint(2), "within it the arc is not").not.toBe(await arcPaint(4));

  for (const width of [1280, 1000, 700, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    for (let i = 0; i < 5; i++) {
      const [box, unit] = await Promise.all([units.nth(i).locator(".card-face").boundingBox(), units.nth(i).boundingBox()]);
      expect(box!.x, "inside the unit").toBeGreaterThanOrEqual(unit!.x);
      expect(box!.x + box!.width, "inside the unit").toBeLessThanOrEqual(unit!.x + unit!.width + 0.5);
      expect(box!.y, "the row is the top of the unit").toBeLessThanOrEqual(unit!.y + 1);
      // the row's text stays on the row
      const outside = await units.nth(i).locator(".card-face").evaluate((el) => {
        const edge = el.getBoundingClientRect();
        return Array.from(el.querySelectorAll("*")).filter((n) => {
          const r = n.getBoundingClientRect();
          // the name's box reaches 4 px past its text on every side (the pointer's room, holdings.css): its text is what stays on the row
          const slack = n.classList.contains("holding-name") ? parseFloat(getComputedStyle(n).paddingLeft) : 0;
          return r.width > 0 && (r.left + slack < edge.left - 0.5 || r.right - slack > edge.right + 0.5 || r.top + slack < edge.top - 0.5 || r.bottom - slack > edge.bottom + 0.5);
        }).length;
      });
      expect(outside, `parts of a face outside it at ${width} px`).toBe(0);
    }
    // the figures of a card end on one right edge, the right edge of the card's own unit, whatever the columns
    for (let i = 0; i < 5; i++) {
      const edges = await rights(units.nth(i).locator(".st-num"));
      const [unit] = await rights(units.nth(i));
      expect(new Set(edges).size, `the sums of card ${i} end at ${edges.join(", ")} at ${width} px`).toBe(1);
      expect(Math.abs(edges[0]! - unit!), "on the right edge of the unit").toBeLessThanOrEqual(0.5);
    }
    expect(await overflow(page), `Yhteenveto scrolls sideways at ${width} px`).toBeLessThanOrEqual(1);
  }

  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Yhteenveto's rail has Tilit, Luottokortit and Lainat as one line each under one link to Varat ja velat, and the loan's sum is the loan", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const today = (await (await context.request.get("/api/meta")).json()).today as string;
  const saved = await context.request.post("/api/loans", {
    headers: FETCH,
    data: {
      name: "Kodin laina", lender: "Esimerkkirahoitus Oy", kind: "mortgage", grantedCents: 15_000_000, balanceCents: 12_000_000, balanceDate: today,
      rateBp: 400, reference: "euribor_12", marginBp: 60, repayment: "annuity", intervalMonths: 1, paymentCents: 100_000, endDate: null, limitCents: null, seriesKey: null,
    },
  });
  expect(saved.ok(), `POST /api/loans answered ${saved.status()}: ${await saved.text()}`).toBe(true);
  loanId = (await saved.json()).loan.id;

  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview");
  const holdings = holdingsOf(page);
  await expect(holdings.locator("[data-holding]")).toHaveCount(3);
  await expect(holdings.locator("[data-holding] dt")).toHaveText(["Tilit", "Luottokortit", "Lainat"]);
  // the lines are told, not linked: the heading is the one link
  await expect(holdings.getByRole("link")).toHaveCount(1);
  expect(cents(plain(await holdings.locator("[data-holding=loans] dd").innerText()))).toBe(12_000_000);

  // the sums of the lines end on one right edge
  const edges = await rights(holdings.locator("[data-holding] dd"));
  expect(new Set(edges).size, `the sums end at ${edges.join(", ")}`).toBe(1);
  expect(await overflow(page), "Yhteenveto scrolls sideways").toBeLessThanOrEqual(1);

  await holdings.getByRole("link", { name: "Varat ja velat" }).click();
  await expect(page).toHaveURL(/#\/balances/);
  await expect(page.locator("#lainat").getByRole("button", { name: "Kodin laina", exact: true })).toBeVisible();

  expect(seen.problems).toEqual([]);
  await context.close();
});
