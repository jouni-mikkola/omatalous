import { expect, test, type Browser, type BrowserContext, type Locator } from "@playwright/test";
import { join } from "node:path";
import { cents, overflow, watch } from "./helpers.ts";

// The block Erääntyvät maksut on Yhteenveto: does the account cover what is due before the pay comes, on the demo
// household of the administrator that e2e/run.mjs made. The demo's dates follow the day the spec runs, so the spec
// asserts the shape and what the API the page reads says of this run, never a date or a sum of its own. The states the
// demo does not have (no regular payer, a late pay, payments that exceed the balance, no balance) are proved by
// apps/web/test/next-days.test.ts (the sentences) and packages/core/test/ahead-payday.test.ts (the window and the figures).
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

interface Ahead {
  reason: "payday" | "late" | "none";
  payday: { name: string; pay: { kind: "steady" | "varies"; floorCents: number; ceilCents: number; usualCents: number } | null } | null;
  rows: { date: string; name: string; cents: number; source: string; basis?: string }[];
  upcoming: { cents: number; onCard?: boolean }[];
  totals: { dueCents: number; cardCents: number; transferCents: number };
  balance: { startCents: number; freeCents: number } | null;
}

/** The window as the API the page reads gives it. */
const aheadOf = async (context: BrowserContext): Promise<Ahead> => (await (await context.request.get("/api/dashboard")).json()).ahead;

/** The merchants of the demo household's series, as the app reads them from the demo's rows: the only names a bill or a pay can carry. */
async function demoNames(context: BrowserContext): Promise<Set<string>> {
  const series: { merchant: string }[] = (await (await context.request.get("/api/recurring")).json()).series;
  return new Set(series.map((s) => s.merchant));
}

/** The names of a table's rows: the cell carries the whole name as its title, whatever line stands under it. */
const namesOf = (table: Locator) => table.locator("tbody tr td:nth-child(2)").evaluateAll((cells) => cells.map((c) => c.getAttribute("title")));

/** Whether the app estimates a row: its own statement of the rule, so that a change of the app's is seen here. */
const estimated = (r: Ahead["rows"][number]) => r.source === "recurring" || r.source === "transfer" || (r.source === "card" && r.basis !== "balance");

async function open(browser: Browser, width: number, reducedMotion: "reduce" | "no-preference" = "no-preference") {
  const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, reducedMotion });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/overview");
  const card = page.locator(".card", { has: page.getByRole("heading", { name: "Erääntyvät maksut", exact: true }) });
  await expect(card).toBeVisible();
  return { context, page, seen, card };
}

test("the line over the figures names the payday, the three figures are the API's and the payments add up to their figure", async ({ browser }) => {
  const { context, seen, card } = await open(browser, 1280);
  const ahead = await aheadOf(context);
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Erääntyvät maksut");
  // the demo household has a regular pay, so the window runs to its payday
  expect(ahead.reason).toBe("payday");
  await expect(card.locator(".ahead-window")).toHaveText(/^(Palkkapäivään asti, (su|ma|ti|ke|to|pe|la) \d{1,2}\.\d{1,2}\.|Seuraavat \d+ päivää\.)( Palkka ei ole vielä tullut, sen piti tulla (su|ma|ti|ke|to|pe|la) \d{1,2}\.\d{1,2}\.)?$/);

  // the three figures in their order, each the API's own, and the third is the first less the second
  const figures = card.locator("dl .st-row");
  await expect(figures.locator("dt")).toHaveText(["Saldo", "Erääntyvät maksut", "Käytettävissä"]);
  const [balance, due, free] = (await figures.locator("dd.st-num").allInnerTexts()).map(cents);
  expect([balance, due, free]).toEqual([ahead.balance!.startCents, ahead.totals.dueCents, ahead.balance!.freeCents]);
  expect(free).toBe(balance! - due!);

  // the table of the payments is the window's payments and nothing else, in order, and it adds up to the figure to the
  // cent. A payday today or tomorrow can leave a window with nothing due in it: the table says so in its one row, a figure of 0.
  const paid = ahead.rows.filter((r) => r.cents < 0);
  const known = await demoNames(context);
  for (const r of ahead.rows.filter((r) => r.source === "recurring" || r.source === "income")) expect(known.has(r.name), `${r.name} is a name the demo's rows give`).toBe(true);
  const table = card.getByRole("table", { name: /^Erääntyvät maksut / });
  await expect(table).toHaveCount(1);
  const none = table.locator("tbody td[colspan]");
  await expect(none).toHaveCount(paid.length > 0 ? 0 : 1);
  if (paid.length === 0) await expect(none).toHaveText("Ei erääntyviä maksuja.");
  expect(await namesOf(table)).toEqual(paid.map((r) => r.name));
  const amounts = (await table.locator("tbody tr td.st-num").allInnerTexts()).map(cents);
  expect(amounts.reduce((sum, c) => sum + c, 0), "the table adds up to the figure").toBe(due);
  // the days and the sums are called estimates under the table, in a line of three words, and no usual spending is told
  await expect(card.getByText("Eräpäivät ja summat ovat arvioita.", { exact: true })).toHaveCount(paid.length > 0 ? 1 : 0);
  await expect(card.getByText(/tavallisesti|arvioitu aiemmista/)).toHaveCount(0);
  // two groups: the figures at the left under the line of the window, the tables at the right from the block's second column on
  const [left, right, whole] = await Promise.all([card.locator("dl.st-rows"), table, card].map(async (l) => (await l.boundingBox())!));
  expect(left!.x + left!.width).toBeLessThan(right!.x);
  expect(Math.abs(right!.x - 20 - (whole!.x + whole!.width / 3)), "the tables start on the line of the second column").toBeLessThanOrEqual(2);

  // what is to arrive has its own table: other pay of the window, and as its last row the pay the window waits for
  const arriving = card.getByRole("table", { name: "Saapuvat maksut" });
  expect(await namesOf(arriving)).toEqual([...ahead.rows.filter((r) => r.source === "income").map((r) => r.name), ahead.payday!.name]);
  const pay = arriving.locator("tbody tr").last();
  await expect(pay.locator("td:nth-child(2)")).toHaveText(/acme/i);
  // a coming pay is never a bare sum: "noin" its usual sum when steady, the range of the estimate when it varies, a dash without
  // an estimate, and the sentence of the pays that came under the table only for a pay that varies
  const [sum, kind] = [(await pay.locator("td:last-child").innerText()).replace(/\s/g, " "), ahead.payday!.pay?.kind];
  expect(sum).toMatch(kind === "steady" ? /^noin \d[\d ]* €$/ : kind === "varies" ? /^\d[\d ]*–\d[\d ]* €$/ : /^–$/);
  await expect(card.locator(".ahead-pay-note")).toHaveCount(kind === "varies" ? 1 : 0);
  if (kind === "varies") await expect(card.locator(".ahead-pay-note")).toContainText(/^Palkka vaihtelee: \d+ viime palkkaa /);

  // the line of days: only when a payment is due, a dot for each payment of the table in its order, each named by the payee,
  // the sum and the day. A row the app estimates is a hollow dot and says so in its name; a bill the household typed in is a full dot
  const line = card.locator(".nd-line");
  await expect(line).toHaveCount(paid.length > 0 ? 1 : 0);
  await expect(card.locator("canvas, button")).toHaveCount(0);
  if (paid.length > 0) {
    const dots = line.locator(".nd-dot:not(.nd-pay)");
    await expect(dots).toHaveCount(paid.length);
    const names = await dots.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
    const rows = await table.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => ({ day: tr.children[0]!.textContent ?? "", name: tr.children[1]!.getAttribute("title") ?? "", sum: tr.children[2]!.textContent ?? "" })));
    rows.forEach((r, i) => {
      expect(names[i]!.startsWith(`${r.name}, `), `${names[i]} starts with the payee`).toBe(true);
      expect(names[i], "the sum as the table has it").toContain(`, ${r.sum}, `);
      expect(names[i]!.endsWith(` ${r.day}`), `${names[i]} ends with the day`).toBe(true);
      expect(names[i]!.includes(", arvio, "), `${names[i]} says estimate when the app estimates the row`).toBe(estimated(paid[i]!));
    });
    await expect(line.locator(".nd-dot.nd-est")).toHaveCount(paid.filter(estimated).length);
    // the days end on the payday, the pay is a mark on it, and the note that all of it is estimated is read before the line
    await expect(line.locator(".nd-axis .nd-pd")).toHaveCount(1);
    await expect(line.locator(".nd-pay")).toHaveCount(1);
    const [note, drawn] = await Promise.all([card.locator(".ahead-estimates"), line, table].map(async (l) => (await l.boundingBox())!));
    expect(note!.y + note!.height, "the note stands over the line").toBeLessThanOrEqual(drawn!.y);
    expect(drawn!.y + drawn!.height, "the line stands over the tables").toBeLessThanOrEqual((await table.boundingBox())!.y);
  }
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a bill that is paid and waits to be booked carries the word varaus after its payee on Yhteenveto and on Laskut, with one sum on both", async ({ browser }) => {
  // The demo has no bill paid another way: the answer is changed on its way, as joint-account.spec.ts does for a card's
  // bill. A pending-paid bill is added to the window and to Laskut's list, and the sums follow as core has them. Core's
  // tests hold when a row is made; this holds what the two pages make of it, on every day.
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  const NAME = "Esimerkki Vakuutusyhtiö Pohjoismaat Henkilövakuutus Oy";
  let stub: Ahead | null = null;
  await page.route(/\/api\/(dashboard|ahead)(\?|$)/, async (route) => {
    const response = await route.fetch().catch(() => null);
    const json = await response?.json().catch(() => null);
    if (!response || !json) return;
    const added = { date: json.ahead.from as string, name: NAME, category: "insurance", cents: -14_230, source: "recurring", pending: true };
    const byDay = (a: { date: string; cents: number }, b: { date: string; cents: number }) => a.date.localeCompare(b.date) || a.cents - b.cents;
    json.ahead.rows = [...json.ahead.rows, added].sort(byDay);
    json.ahead.upcoming = [...json.ahead.upcoming, added].sort(byDay);
    json.ahead.totals.dueCents += 14_230;
    json.ahead.totals.recurringCents += 14_230;
    json.ahead.balance.freeCents -= 14_230;
    stub = json.ahead;
    await route.fulfill({ response, json });
  });
  await page.goto("/#/overview");
  const card = page.locator(".card", { has: page.getByRole("heading", { name: "Erääntyvät maksut", exact: true }) });
  await expect(card).toBeVisible();
  const table = card.getByRole("table", { name: /^Erääntyvät maksut / });
  const mine = table.locator("tbody tr", { hasText: NAME });
  await expect(mine).toHaveCount(1);
  await expect(table.locator(".badge")).toHaveCount(1);
  await expect(mine.locator("td:nth-child(2) .payee-pending .badge")).toHaveText("varaus");
  await expect(mine.locator("td:nth-child(2)")).toHaveText(`${NAME}varaus`);
  const due = cents(await card.locator("dl .st-row", { hasText: "Erääntyvät maksut" }).locator("dd.st-num").innerText());
  expect(due).toBe(stub!.totals.dueCents);

  await page.goto("/#/bills");
  const list = page.locator("#tulossa");
  const row = list.locator("tbody tr", { hasText: NAME });
  await expect(row).toHaveCount(1);
  await expect(list.locator(".badge", { hasText: "varaus" })).toHaveCount(1);
  await expect(row.locator(".payee-pending .badge")).toHaveText("varaus");
  // the first group of Laskut is the figure of Yhteenveto without a card's bill and an own transfer: the paid bill is in both
  const first = cents(await list.locator(".group-head").first().locator("td").innerText());
  expect(first).toBe(due - stub!.totals.cardCents - stub!.totals.transferCents);

  // on a phone the long name is cut with an ellipsis and the word keeps its line inside the cell, on both pages
  await page.setViewportSize({ width: 390, height: 900 });
  const phone = async (cell: Locator) => {
    const [cellBox, badge, link] = await Promise.all([cell.boundingBox(), cell.locator(".badge").boundingBox(), cell.locator(".payee-pending > span").first().boundingBox()]);
    expect(badge!.x + badge!.width, "the word stays inside its cell").toBeLessThanOrEqual(cellBox!.x + cellBox!.width + 1);
    expect(badge!.height, "the word is on one line").toBeLessThan(28);
    expect(link!.x + link!.width, "the name ends before the word").toBeLessThanOrEqual(badge!.x + 1);
    expect(await cell.locator(".payee-pending > span").first().evaluate((n) => n.scrollWidth > n.clientWidth), "the name is cut").toBe(true);
    expect(await overflow(page), "the page scrolls sideways at 390 px").toBeLessThanOrEqual(1);
  };
  await phone(row.locator("td:has(.payee-pending)"));
  await page.goto("/#/overview");
  await expect(mine).toHaveCount(1);
  await phone(mine.locator("td:has(.payee-pending)"));
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("on a phone nothing scrolls sideways, the figures come before the tables and a row keeps its three cells", async ({ browser }) => {
  const { context, page, seen, card } = await open(browser, 390);
  expect(await overflow(page), "the page scrolls sideways at 390 px").toBeLessThanOrEqual(1);
  const [head, figure] = [await card.getByRole("heading", { level: 2 }).boundingBox(), await card.locator("dl .st-row").first().boundingBox()];
  expect(head!.y).toBeLessThan(figure!.y);
  // the pay's table is there whatever the day is, so the block has a table: the figures stand above the first one
  const tables = card.locator("table");
  expect(figure!.y, "the first figure is above the tables").toBeLessThan((await tables.first().boundingBox())!.y);
  // the line of days is as wide as the card's group and every dot is inside it: nothing leaves it, nothing scrolls
  const drawn = card.locator(".nd-line");
  if ((await drawn.count()) > 0) {
    const frame = (await drawn.boundingBox())!;
    expect(frame.width).toBeGreaterThan(200);
    for (const box of await Promise.all((await card.locator(".nd-dot").all()).map(async (d) => (await d.boundingBox())!))) {
      expect(box.x, "a dot left of the line").toBeGreaterThanOrEqual(frame.x - 1);
      expect(box.x + box.width, "a dot right of the line").toBeLessThanOrEqual(frame.x + frame.width + 1);
    }
    expect(await drawn.evaluate((el) => el.scrollWidth - el.clientWidth), "the line scrolls sideways").toBeLessThanOrEqual(1);
  }
  // a table is three columns inside the card: the day, the name, the sum. A long name is cut; a sum never is.
  const shape = await tables.evaluateAll((all) =>
    all.map((t) => ({
      wide: t.getBoundingClientRect().width > t.parentElement!.getBoundingClientRect().width + 1,
      cells: Array.from(t.querySelectorAll("tbody tr:not(:has(td[colspan]))")).map((r) => r.children.length),
      cut: Array.from(t.querySelectorAll("td.st-num")).filter((c) => c.scrollWidth > c.clientWidth + 1).length,
    })),
  );
  expect(shape.length).toBeGreaterThan(0);
  for (const t of shape) {
    expect(t.wide, "a table wider than its card").toBe(false);
    expect(t.cells.filter((n) => n !== 3), "a row without its three cells").toEqual([]);
    expect(t.cut, "a sum that is cut").toBe(0);
  }
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("Laskut has the same payments in groups: the first group's sum is the figure of Yhteenveto without a card's bill and an own transfer, and what a card is charged is the last group", async ({ browser }) => {
  const { context, page, seen, card } = await open(browser, 1280);
  const ahead = await aheadOf(context);
  expect(ahead.reason).toBe("payday");
  const due = cents(await card.locator("dl .st-row", { hasText: "Erääntyvät maksut" }).locator("dd.st-num").innerText());
  expect(due).toBe(ahead.totals.dueCents);

  await page.goto("/#/bills");
  const heads = page.locator("#tulossa .group-head");
  await expect(heads.first()).toContainText("Palkkapäivään asti");
  const groups = (await heads.evaluateAll((rows) => rows.map((r) => [r.querySelector("th")!.textContent ?? "", r.querySelector("td")!.textContent ?? ""]))).map(([title, sum]) => ({ title: title!, cents: cents(sum!) }));
  // the first group is what the accounts pay in the window. Yhteenveto's figure adds to it only a card's bill and an
  // own transfer, so with neither in the window the two are one figure under one line
  expect(groups[0]!.cents).toBe(due - ahead.totals.cardCents - ahead.totals.transferCents);
  // the demo's card is charged subscriptions: they are the last group, with their own sum
  const onCard = ahead.upcoming.filter((r) => r.onCard);
  expect(onCard.length).toBeGreaterThan(0);
  expect(groups.at(-1)).toEqual({ title: "Kortilta veloitettavat", cents: onCard.reduce((sum, r) => sum - r.cents, 0) });
  // and the groups together are the whole list
  expect(groups.reduce((sum, g) => sum + g.cents, 0)).toBe(ahead.upcoming.reduce((sum, r) => sum - r.cents, 0));
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a dot is reached with the keys and lights its row, a row lights its dot, Esc puts the light out and the line has one tab stop", async ({ browser }) => {
  const { context, page, seen, card } = await open(browser, 1280);
  const dots = card.locator(".nd-dot:not(.nd-pay)");
  // a window with nothing due has no line: the first test holds that
  if ((await dots.count()) > 0) {
    const rows = card.locator("table.ahead-table").first().locator("tbody tr");
    await expect(card.locator('.nd-dot[tabindex="0"]')).toHaveCount(1);
    await expect(card.locator(".nd-tip")).toHaveCount(0);
    await dots.first().focus();
    // the tooltip names the payee and its row is lit
    await expect(card.locator(".nd-tip")).toContainText((await rows.first().locator("td:nth-child(2)").getAttribute("title"))!);
    await expect(rows.first()).toHaveClass(/\bon\b/);
    const first = await dots.first().getAttribute("aria-label");
    if ((await card.locator(".nd-dot").count()) > 1) {
      await page.keyboard.press("ArrowRight");
      expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "an arrow moves to the next dot").not.toBe(first);
      await page.keyboard.press("Home");
      expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Home is the first dot").toBe(first);
    }
    await page.keyboard.press("Escape");
    await expect(card.locator(".nd-tip")).toHaveCount(0);
    await expect(rows.first()).not.toHaveClass(/\bon\b/);
    await dots.first().blur();
    // the pointer on a row lights its dot, and leaving puts it out
    await rows.first().hover();
    await expect(dots.first()).toHaveClass(/\bon\b/);
    await page.mouse.move(0, 0);
    await expect(dots.first()).not.toHaveClass(/\bon\b/);
  }
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the line draws nothing in, and its dots fade only when the reader has not asked for less motion", async ({ browser }) => {
  const motion = async (preference: "reduce" | "no-preference") => {
    const { context, card } = await open(browser, 1280, preference);
    const dot = card.locator(".nd-dot").first();
    const seen = (await dot.count()) > 0 ? await Promise.all([card.locator(".nd-steps svg").evaluate((el) => getComputedStyle(el).animationName), dot.evaluate((el) => getComputedStyle(el).transitionDuration)]) : null;
    await context.close();
    return seen;
  };
  // a window with nothing due has no line: the first test holds that
  const [calm, lively] = [await motion("reduce"), await motion("no-preference")];
  if (calm && lively) {
    expect(calm).toEqual(["none", "0s"]);
    expect(lively[0]).toBe("none");
    expect(lively[1]).not.toBe("0s");
  }
});
