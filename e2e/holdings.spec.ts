import { expect, test, type Locator, type Page } from "@playwright/test";
import { join } from "node:path";
import { cents, overflow, plain, watch } from "./helpers.ts";

// Varallisuus in the look of a statement: the names of accounts, cards and loans are links, the sums of a group stand on
// one right edge, the rows are of one height, and the groups stand side by side from the width that fits them. The demo
// household of the administrator (e2e/run.mjs) has a checking and a savings account and a card with no limit and no last
// digits; the loan this spec saves is removed again, so the specs after it find the household as they expect.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
const FETCH = { "X-Requested-With": "fetch" };

test.describe.configure({ mode: "serial" });

const holdingsOf = (page: Page) => page.getByRole("region", { name: "Varallisuus", exact: true });
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

test("a name opens its rows in Tapahtumat, in its own colour until it is pointed at, and no total is a link", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview");
  const holdings = holdingsOf(page);
  await expect(holdings).toBeVisible();

  // an account: the link is in the colour of the other words of the row until it is hovered
  const account = holdings.getByRole("link", { name: "Käyttötili (esimerkki)" });
  const plainText = await colour(holdings.getByText("Tilit yhteensä", { exact: true }));
  expect(await colour(account), "the block does not turn blue").toBe(plainText);
  await account.hover();
  expect(await colour(account), "a link shows itself when pointed at").not.toBe(plainText);

  // a total is no link, the sum of one group or of the block
  await expect(holdings.getByRole("link", { name: /yhteensä$/i })).toHaveCount(0);

  const chosen = async () => page.getByRole("combobox", { name: "Tili", exact: true }).evaluate((select: HTMLSelectElement) => ({ id: select.value, name: select.selectedOptions[0]?.text ?? "" }));
  await account.click();
  await expect(page).toHaveURL(/#\/transactions\?accountId=/);
  await expect(page.getByRole("combobox", { name: "Tili", exact: true })).not.toHaveValue("");
  const first = await chosen();
  expect(first.name).toContain("Käyttötili (esimerkki)");
  expect(new URL(page.url()).hash).toBe(`#/transactions?accountId=${encodeURIComponent(first.id)}`);

  // a card: the same, with the card's name as the account is called
  await page.goto("/#/overview");
  await holdingsOf(page).getByRole("link", { name: "Nordea Gold (esimerkki)" }).click();
  await expect(page).toHaveURL(/#\/transactions\?accountId=/);
  await expect(page.getByRole("combobox", { name: "Tili", exact: true })).not.toHaveValue("");
  const second = await chosen();
  expect(second.name).toContain("Nordea Gold (esimerkki)");
  expect(second.id).not.toBe(first.id);

  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the focus of a link shows whole, inside the name that is cut", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto("/#/overview");
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

test("the sums of a group stand on one right edge, a row is 32 px, two weights only, and a card with no limit and no digits is its name and one row", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview");
  const holdings = holdingsOf(page);
  await expect(holdings).toBeVisible();

  // Tilit: the two accounts and the total at the foot end at one x
  const tilit = groupOf(page, "Tilit");
  const edges = await rights(tilit.locator(".st-num"));
  expect(edges.length, "the total and two accounts").toBe(3);
  expect(new Set(edges).size, `the sums of Tilit end at ${edges.join(", ")}`).toBe(1);

  // a row of an account is 32 px and its hairline
  const row = (await tilit.locator("li.st-row", { hasText: "Säästötili (esimerkki)" }).boundingBox())!;
  expect(row.height).toBeGreaterThanOrEqual(32);
  expect(row.height).toBeLessThanOrEqual(33);

  // 400 and 600 and no other weight in the block
  const weights = await holdings.evaluate((root) => {
    const found = new Set<string>();
    for (const el of Array.from(root.querySelectorAll("*"))) if (Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim())) found.add(getComputedStyle(el).fontWeight);
    return [...found].sort();
  });
  expect(weights).toEqual(["400", "600"]);

  // the demo's card has a name and what is used: no limit row, no last digits, its face and no meter, and no line without words
  const card = groupOf(page, "Luottokortit").locator(".holding-unit");
  await expect(card.locator(".st-row")).toHaveCount(2);
  await expect(card.locator(".st-row").last().locator(".st-name")).toHaveText("Käytetty luotto");
  await expect(card.locator(".card-face")).toHaveCount(1);
  await expect(card.locator(".card-meter, .sr-only, .st-sub")).toHaveCount(0);
  await expect(card.locator(".holding-unit-body").locator("svg, img")).toHaveCount(0);
  for (const line of await holdings.locator(".st-row, .st-sub").all()) expect(plain(await line.innerText()), "a row or a line without words").not.toBe("");
  // in a column of its own beside Tilit
  const [accounts, cards] = await Promise.all([tilit.boundingBox(), groupOf(page, "Luottokortit").boundingBox()]);
  expect(cards!.x, "two groups side by side").toBeGreaterThan(accounts!.x + accounts!.width - 2);
  expect(Math.abs(cards!.y - accounts!.y)).toBeLessThanOrEqual(1);
  // of two groups the first is a third of the block and the second the other two: the line the blocks under it split at
  const whole = (await holdings.boundingBox())!;
  expect(Math.abs(cards!.x - (whole.x + whole.width / 3)), "the second group starts on the first third").toBeLessThanOrEqual(2);
  expect(Math.abs(cards!.x + cards!.width - (whole.x + whole.width)), "and runs to the right edge").toBeLessThanOrEqual(2);

  expect(seen.problems).toEqual([]);
  await context.close();
});

test("every card has its face at the left of its unit, drawn by the app and hidden from a screen reader, and nothing scrolls sideways", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  // five cards, one for each tone, the way a household with five would be answered
  const cards = ["Esimerkkipankki Gold", "Esimerkkipankki Platinum", "Esimerkkipankki Black", "Esimerkkipankki Silver", "Esimerkkipankki Luotto"].map((name, i) => ({
    id: `face-${i}`, name, bank: "Esimerkkipankki", ownerName: null, mask: `•••• ${1000 + i}`, limitCents: 300_000, usedCents: 120_000 * i, freeCents: Math.max(0, 300_000 - 120_000 * i), overCents: Math.max(0, 120_000 * i - 300_000), balanceAt: null,
  }));
  await page.route(/\/api\/dashboard(\?|$)/, async (route) => {
    const response = await route.fetch().catch(() => null);
    const json = await response?.json().catch(() => null);
    if (!response || !json) return;
    json.holdings.cards = cards;
    json.holdings.cardsCents = cards.reduce((sum, c) => sum + c.usedCents, 0);
    await route.fulfill({ response, json });
  });
  await page.goto("/#/overview");
  const group = groupOf(page, "Luottokortit");
  const units = group.locator(".holding-unit");
  await expect(units).toHaveCount(5);

  // one face for each card, in its unit, with the tone its name gives
  await expect(group.locator(".card-face")).toHaveCount(5);
  for (const [i, tone] of ["gold", "platinum", "black", "silver", "plain"].entries()) {
    await expect(units.nth(i).locator(".card-face")).toHaveClass(new RegExp(`card-face-${tone}$`));
    await expect(units.nth(i).locator(".card-face")).toHaveAttribute("aria-hidden", "true");
    await expect(units.nth(i).locator(".card-face-mask")).toHaveText(`•••• ${1000 + i}`);
  }
  // the name is the unit's link, whole, and the digits stand on the face alone, which a screen reader leaves out
  await expect(units.nth(1).getByRole("link", { name: "Esimerkkipankki Platinum", exact: true })).toBeVisible();
  expect(await units.nth(1).getByText("1001").evaluate((el) => el.closest('[aria-hidden="true"]') !== null), "the digits are on the face").toBe(true);

  // the face is drawn: its two small SVGs and CSS, and the page asks for no picture for it
  await expect(units.first().locator(".card-face svg")).toHaveCount(2);
  await expect(units.first().locator(".card-face img")).toHaveCount(0);

  for (const [width, face] of [[1280, { width: 132, height: 83 }], [1000, { width: 132, height: 83 }], [700, { width: 132, height: 83 }], [390, { width: 96, height: 60 }]] as const) {
    await page.setViewportSize({ width, height: 900 });
    for (let i = 0; i < 5; i++) {
      const [box, body, unit] = await Promise.all([units.nth(i).locator(".card-face").boundingBox(), units.nth(i).locator(".holding-unit-body").boundingBox(), units.nth(i).boundingBox()]);
      expect([box!.width, box!.height], `the face at ${width} px`).toEqual([face.width, face.height]);
      expect(box!.x + box!.width, `the face is at the left of the name and the figures at ${width} px`).toBeLessThanOrEqual(body!.x + 0.5);
      expect(Math.abs(box!.y - body!.y), "on the line the unit starts at").toBeLessThanOrEqual(12);
      expect(box!.x, "inside the unit").toBeGreaterThanOrEqual(unit!.x);
      // the face's text stays on the face
      const outside = await units.nth(i).locator(".card-face").evaluate((el) => {
        const edge = el.getBoundingClientRect();
        return Array.from(el.querySelectorAll("*")).filter((n) => {
          const r = n.getBoundingClientRect();
          return r.width > 0 && (r.left < edge.left - 0.5 || r.right > edge.right + 0.5 || r.top < edge.top - 0.5 || r.bottom > edge.bottom + 0.5);
        }).length;
      });
      expect(outside, `parts of a face outside it at ${width} px`).toBe(0);
    }
    // the figures of all the cards end on one right edge, the right edge of the group's rows
    const edges = await rights(group.locator(".holding-unit-body .st-num"));
    expect(new Set(edges).size, `the sums of the cards end at ${edges.join(", ")} at ${width} px`).toBe(1);
    const list = (await group.locator(".holding-units").boundingBox())!;
    expect(Math.abs(edges[0]! - (list.x + list.width)), "on the right edge of the list").toBeLessThanOrEqual(0.5);
    expect(await overflow(page), `Yhteenveto scrolls sideways at ${width} px`).toBeLessThanOrEqual(1);
  }

  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a loan's name opens the report Lainat, the sums of the block stand on one right edge, and the groups stand side by side from 1040 px", async ({ browser }) => {
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
  const lainat = groupOf(page, "Lainat");
  await expect(lainat).toBeVisible();

  // the loan's own sums, the sum of the loans, and the debts of the block under all three groups on one right edge
  const foot = holdings.locator(".holding-foot");
  await expect(lainat.locator(".st-total .st-name")).toHaveText("Lainat yhteensä");
  await expect(foot.locator(".st-name")).toHaveText("Velat yhteensä");
  const edges = [...(await rights(lainat.locator(".st-num"))), ...(await rights(foot.locator(".st-num")))];
  expect(edges.length).toBeGreaterThanOrEqual(4);
  expect(new Set(edges).size, `the sums of Lainat and the foot end at ${edges.join(", ")}`).toBe(1);
  // the sum of the loans is the loan, and the debts are that and what the card owes
  expect(cents(plain(await lainat.locator(".st-total .st-num").innerText()))).toBe(12_000_000);
  const used = cents(plain(await groupOf(page, "Luottokortit").locator(".st-row", { hasText: "Käytetty luotto" }).locator(".st-num").innerText()));
  expect(used, "the demo card owes something").toBeGreaterThan(0);
  expect(cents(plain(await foot.locator(".st-num").innerText()))).toBe(12_000_000 + used);
  // the foot runs across the three groups, under them
  const [footBox, accounts, loans] = await Promise.all([foot.boundingBox(), groupOf(page, "Tilit").boundingBox(), lainat.boundingBox()]);
  expect(footBox!.y).toBeGreaterThanOrEqual(Math.max(accounts!.y + accounts!.height, loans!.y + loans!.height) - 1);
  expect(footBox!.width).toBeGreaterThan(loans!.x + loans!.width - accounts!.x - 2);

  // width: three side by side from 1040 px and under each other below it, down to a phone, with nothing scrolling sideways
  const sideBySide = async () => {
    const boxes = await Promise.all(["Tilit", "Luottokortit", "Lainat"].map(async (name) => (await groupOf(page, name).boundingBox())!));
    return boxes.slice(1).every((b, i) => b.x >= boxes[i]!.x + boxes[i]!.width - 2 && Math.abs(b.y - boxes[0]!.y) <= 1);
  };
  const stacked = async () => {
    const boxes = await Promise.all(["Tilit", "Luottokortit", "Lainat"].map(async (name) => (await groupOf(page, name).boundingBox())!));
    return boxes.slice(1).every((b, i) => b.y >= boxes[i]!.y + boxes[i]!.height - 2);
  };
  for (const [width, three] of [[1280, true], [1040, true], [1039, false], [900, false], [700, false], [390, false]] as const) {
    await page.setViewportSize({ width, height: 900 });
    expect(await (three ? sideBySide() : stacked()), `at ${width} px the groups are ${three ? "side by side" : "under each other"}`).toBe(true);
    expect(await overflow(page), `Yhteenveto scrolls sideways at ${width} px`).toBeLessThanOrEqual(1);
  }

  // the loan's name leads to the report, which shows Lainat
  await page.setViewportSize({ width: 1280, height: 900 });
  await lainat.getByRole("link", { name: "Kodin laina" }).click();
  await expect(page).toHaveURL(/#\/reports#lainat$/);
  await expect(page.locator("#lainat").getByRole("heading", { name: "Lainat" })).toBeInViewport();

  expect(seen.problems).toEqual([]);
  await context.close();
});
