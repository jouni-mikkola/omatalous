import { expect, test, type Locator, type Page } from "@playwright/test";
import { join } from "node:path";
import { cents, overflow, plain, watch } from "./helpers.ts";

// Varallisuus: the names of accounts, cards and loans are links, the sums of a group stand on one right edge, Tilit and
// Lainat stand side by side from 900 px with the cards in a row under them (a household with no loan has Tilit and its
// cards side by side), a card's face stays flat and its arc shows what is used. The demo household of the
// administrator (e2e/run.mjs) has a checking and a savings account and a card with no limit and no last digits; the
// loan this spec saves is removed again, so the specs after it find the household as they expect.
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

test("a name opens its rows in Tapahtumat, in the colour of a link and underlined when pointed at, and no total is a link", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview");
  const holdings = holdingsOf(page);
  await expect(holdings).toBeVisible();

  // an account: the link is in the accent colour, not the colour of the other words of the row, and underlined when hovered
  const account = holdings.getByRole("link", { name: "Käyttötili (esimerkki)" });
  const plainText = await colour(holdings.getByText("Tilit yhteensä", { exact: true }));
  const underline = (el: Locator) => el.evaluate((node) => getComputedStyle(node).textDecorationLine);
  expect(await colour(account), "a name is a link in the colour of one").not.toBe(plainText);
  expect(await underline(account)).toBe("none");
  await account.hover();
  expect(await underline(account), "a link shows itself when pointed at").toBe("underline");

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

  // the card's face is a link for a pointer to the same rows
  await page.goto("/#/overview");
  await holdingsOf(page).locator(".card-face-link").click();
  await expect(page).toHaveURL(/#\/transactions\?accountId=/);
  expect((await chosen()).id).toBe(second.id);

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

test("the sums of a group stand on one right edge, an account's row is 54 px, two weights only, and a card with no limit and no digits is its name and one row", async ({ browser }) => {
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
  // the accounts add up to the total, so the bracket takes 8 px right of their sums (--mark-gap); the total's own sum stands past it
  expect(new Set(edges.slice(0, -1)).size, `the sums of the accounts end at ${edges.join(", ")}`).toBe(1);
  expect(edges[2]! - edges[0]!, "the bracket's gutter").toBe(8);

  // a row of an account is 54 px with its hairline: room for the curve that will stand between the name and the sum
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

  // the demo's card has a name and what is used: no limit row, no last digits, its face and no meter, and no line without words
  const card = groupOf(page, "Luottokortit").locator(".holding-unit");
  await expect(card.locator(".st-row")).toHaveCount(2);
  await expect(card.locator(".st-row").last().locator(".st-name")).toHaveText("Käytetty luotto");
  await expect(card.locator(".card-face")).toHaveCount(1);
  await expect(card.locator(".card-meter, .sr-only, .st-sub")).toHaveCount(0);
  // no limit, so no arc and no picture beyond the face
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
  const gap = await holdings.evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue("--gap")));
  const column = (whole.width - 2 - 11 * gap) / 12;
  expect(Math.abs(cards!.x - (whole.x + 1 + 5 * column + 4.5 * gap - 1)), "the second group starts on the split after five columns").toBeLessThanOrEqual(2);
  expect(Math.abs(cards!.x + cards!.width - (whole.x + whole.width - 1)), "and runs to the frame's right edge").toBeLessThanOrEqual(2);

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
    // the link round the face is for a pointer: out of the tab order and of a screen reader's, which have the name
    await expect(units.nth(i).locator(".card-face-link")).toHaveAttribute("aria-hidden", "true");
    await expect(units.nth(i).locator(".card-face-link")).toHaveAttribute("tabindex", "-1");
    await expect(units.nth(i).locator(".card-face-mask")).toHaveText(`•••• ${1000 + i}`);
  }
  // the name is the unit's link, whole, and the digits stand on the face alone, which a screen reader leaves out
  await expect(units.nth(1).getByRole("link", { name: "Esimerkkipankki Platinum", exact: true })).toBeVisible();
  expect(await units.nth(1).getByText("1001").evaluate((el) => el.closest('[aria-hidden="true"]') !== null), "the digits are on the face").toBe(true);

  // the face is drawn: one small SVG for the chip and CSS, and the page asks for no picture for it
  await expect(units.first().locator(".card-face svg")).toHaveCount(1);
  await expect(units.first().locator(".card-face img")).toHaveCount(0);

  // each card has the arc of what is used, named by its two figures; the card over its limit has it in the colour of what is wrong
  await expect(group.locator(".credit-arc")).toHaveCount(5);
  await expect(units.nth(1).getByRole("img", { name: /^Käytetty luotto 1\D*200,00\D*€, luottoraja 3\D*000,00\D*€$/ })).toHaveCount(1);
  await expect(group.locator(".credit-arc-over")).toHaveCount(2);
  for (const over of [3, 4]) await expect(units.nth(over).locator(".credit-arc-over")).toHaveCount(1);
  const arcPaint = (unit: number) => units.nth(unit).locator(".credit-arc-fill").evaluate((el) => getComputedStyle(el).stroke);
  expect(await arcPaint(4), "over the limit the arc is in the colour of what is wrong").toBe(await units.nth(4).locator(".holding-bad").evaluate((el) => getComputedStyle(el).color));
  expect(await arcPaint(2), "within it the arc is not").not.toBe(await arcPaint(4));

  for (const [width, face] of [[1280, 196], [1000, 196], [700, 196], [390, 148], [360, 148]] as const) {
    await page.setViewportSize({ width, height: 900 });
    for (let i = 0; i < 5; i++) {
      const [box, head, unit] = await Promise.all([units.nth(i).locator(".card-face").boundingBox(), units.nth(i).locator(".holding-unit-head").boundingBox(), units.nth(i).boundingBox()]);
      expect(box!.width, `the face at ${width} px`).toBeCloseTo(face, 0);
      expect(box!.height, `a real card's proportions at ${width} px`).toBeCloseTo(face / 1.586, 0);
      expect(box!.x + box!.width, `the face is at the left of the name at ${width} px`).toBeLessThanOrEqual(head!.x + 0.5);
      expect(Math.abs(box!.y - head!.y), "on the line the unit starts at").toBeLessThanOrEqual(12);
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

test("a loan's name opens the report Lainat, the sums of the block stand on one right edge, and Tilit and Lainat stand side by side from 900 px with the cards under them", async ({ browser }) => {
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
  // the foot runs across the groups, under all three
  const [footBox, accounts, loans, cards] = await Promise.all([foot.boundingBox(), groupOf(page, "Tilit").boundingBox(), lainat.boundingBox(), groupOf(page, "Luottokortit").boundingBox()]);
  expect(footBox!.y).toBeGreaterThanOrEqual(Math.max(accounts!.y + accounts!.height, loans!.y + loans!.height, cards!.y + cards!.height) - 1);
  // the groups run to the frame, the foot stays inside its padding (21 px a side)
  expect(footBox!.width).toBeGreaterThan(loans!.x + loans!.width - accounts!.x - 2 * 21 - 2);

  // a loan is its name and lines at the left and its two figures at the right, two rows tall; its figures grow in rows
  const unit = lainat.locator(".holding-unit").first();
  const [name, figures] = await Promise.all([unit.locator(".holding-unit-head").boundingBox(), unit.locator("dl").boundingBox()]);
  expect(figures!.x, "the figures stand at the right of the name").toBeGreaterThanOrEqual(name!.x + name!.width - 1);
  expect(figures!.height, "two rows of 32 px and the hairline between").toBeLessThanOrEqual(66);

  // width: Tilit and Lainat side by side from 900 px, the cards across under both; under each other below it, down to a
  // phone, with nothing scrolling sideways
  const boxes = async () => Promise.all(["Tilit", "Lainat", "Luottokortit"].map(async (name) => (await groupOf(page, name).boundingBox())!));
  for (const [width, side] of [[1280, true], [1000, true], [900, true], [899, false], [700, false], [390, false]] as const) {
    await page.setViewportSize({ width, height: 900 });
    const [t, l, c] = await boxes();
    expect(c!.y, `at ${width} px the cards are under the other two`).toBeGreaterThanOrEqual(Math.max(t!.y + t!.height, l!.y + l!.height) - 2);
    if (side) {
      expect(l!.x, `at ${width} px Lainat is at the right of Tilit`).toBeGreaterThanOrEqual(t!.x + t!.width - 2);
      expect(Math.abs(l!.y - t!.y)).toBeLessThanOrEqual(1);
      expect(c!.width, "the cards run across both").toBeGreaterThanOrEqual(t!.width + l!.width - 1);
    } else {
      expect(l!.y, `at ${width} px Lainat is under Tilit`).toBeGreaterThanOrEqual(t!.y + t!.height - 2);
    }
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

test("a card's face stays where it is under the pointer, and the keyboard's ring is on it", async ({ browser }) => {
  for (const reduced of [false, true]) {
    const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 }, reducedMotion: reduced ? "reduce" : "no-preference" });
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/#/overview");
    const holdings = holdingsOf(page);
    const link = holdings.locator(".card-face-link").first();
    const face = link.locator(".card-face");
    await expect(face).toBeVisible();
    const transform = () => face.evaluate((el) => getComputedStyle(el).transform);
    // a face with no turn is "none" or the identity
    const flat = (t: string) => t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)";
    const box = (await link.boundingBox())!;
    expect(flat(await transform()), "flat before the pointer comes").toBe(true);
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.move(box.x + box.width * 0.92, box.y + box.height * 0.12);
    expect(flat(await transform()), "no lean under the pointer").toBe(true);
    expect(await link.boundingBox(), "the face did not move").toEqual(box);
    expect(await link.getAttribute("style") ?? "").not.toContain("--face-");

    // the keyboard: the ring is on the face, the face does not lean
    const name = holdings.locator(".holding-unit-faced").first().getByRole("link").last();
    await name.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(name).toBeFocused();
    const ring = await face.evaluate((el) => {
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: style.outlineWidth, flat: style.transform === "none" || style.transform === "matrix(1, 0, 0, 1, 0, 0)" };
    });
    expect(ring, "the focus is shown on the face and the face stays flat").toEqual({ style: "solid", width: "2px", flat: true });

    expect(seen.problems).toEqual([]);
    await context.close();
  }
});
