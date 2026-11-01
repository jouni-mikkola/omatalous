import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { join } from "node:path";
import { cents, overflow, watch } from "./helpers.ts";

// The payments of the window on Laskut (Yhteenveto's Näytä maksut is front-page.spec.ts): what is due before the pay comes, on the demo
// household of the administrator that e2e/run.mjs made. The demo's dates follow the day the spec runs, so the spec
// asserts the shape and what the API the page reads says of this run, never a date or a sum of its own. The states the
// demo does not have (no regular payer, a late pay, payments that exceed the balance, no balance) are proved by
// apps/web/test/next-days.test.ts (the sentences) and packages/core/test/ahead-payday.test.ts (the window and the figures).
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

interface Ahead {
  reason: "payday" | "late" | "none";
  from: string;
  payday: { date: string; expected?: string; next?: string; name: string; pay: { kind: "steady" | "varies"; floorCents: number; ceilCents: number; usualCents: number } | null } | null;
  rows: { date: string; name: string; cents: number; source: string; basis?: string }[];
  upcoming: { cents: number; onCard?: boolean }[];
  totals: { dueCents: number; recurringCents: number; cardCents: number };
  balance: { startCents: number; freeCents: number } | null;
}

/** The window as the API the page reads gives it. */
const aheadOf = async (context: BrowserContext): Promise<Ahead> => (await (await context.request.get("/api/dashboard")).json()).ahead;

async function open(browser: Browser, width: number) {
  const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  return { context, page, seen };
}

test("Laskut names the period its sum covers: the sum above the line is what the window has due, a card's bill is a row of its own, and a card's charges stand apart", async ({ browser }) => {
  const { context, page, seen } = await open(browser, 1280);
  const ahead = await aheadOf(context);
  expect(ahead.reason).toBe("payday");

  await page.goto("/#/bills");
  const sum = page.locator("#tulossa .bills-time-sum");
  await expect(sum).toContainText("palkkapäivään");
  const rows = page.locator("#tulossa .bills-time-rows .st-row");
  const read = async (label: RegExp) => {
    const row = rows.filter({ hasText: label });
    return (await row.count()) ? cents(await row.locator(".st-num").innerText()) : null;
  };
  // the sum is the answer's figure, a card's bill included, and the rows under it add up to it
  expect(cents(await sum.locator(".fig").innerText())).toBe(-Math.round(ahead.totals.dueCents / 100) * 100);
  expect(await read(/^Laskut ja tilaukset/)).toBe(-ahead.totals.recurringCents);
  expect(await read(/^Luottokortin lasku/)).toBe(-ahead.totals.cardCents);
  // the demo's card is charged subscriptions: they are a row of their own, with their own sum
  const onCard = ahead.upcoming.filter((r) => r.onCard);
  expect(onCard.length).toBeGreaterThan(0);
  expect(await read(/^Kortilta veloitettavat/)).toBe(-onCard.reduce((sum, r) => sum - r.cents, 0));
  // no payment is listed twice: the page has no table of the window beside the one table
  await expect(page.locator("#tulossa table")).toHaveCount(0);
  // the axis ends on the payday the sum ends before, marks it, and the key names both circles and the payday
  const days = page.locator("#tulossa .nd-axis li");
  const payday = ahead.payday!.expected ? ahead.payday!.next! : ahead.payday!.date;
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await days.count(), `days of the axis at ${width} px`).toBe(Math.round((Date.parse(payday) - Date.parse(ahead.from)) / 86_400_000) + 1);
    await expect(days.last()).toHaveClass(/nd-pd/);
    await expect(page.locator("#tulossa .bills-time-legend")).toHaveText(/Päivä ja summa tiedossa.*Arvio.*Palkkapäivä/);
  }
  expect(await overflow(page), "the page scrolls sideways at 390 px").toBeLessThanOrEqual(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});
