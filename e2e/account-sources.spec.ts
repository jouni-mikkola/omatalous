import { type Browser, expect, test } from "@playwright/test";
import { linkFakeBank, makeMember, overflow, removeMember, sayJointUse, waitForSync, watch } from "./helpers.ts";

// Asetukset > Tilit under the joint account: "Tilille tullut ja lähtenyt raha kuukausittain", a column for each member and one for the rest
// for every month with a booked row. Two members made here both link the fake bank (e2e/fake-bank/), so its joint account has
// two users; the administrator's demo household is not touched and the members go at the end.
const NAMES = ["e2e-maksut-a", "e2e-maksut-b"] as const;
const members: { state: string; id: string }[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  for (const name of NAMES) {
    const member = await makeMember(browser, name);
    members.push(member);
    const context = await browser.newContext({ storageState: member.state });
    await linkFakeBank(await context.newPage());
    await waitForSync(context);
    if (members.length === 2) {
      const first = await browser.newContext({ storageState: members[0]!.state });
      await sayJointUse(first, members.map((m) => ({ userId: m.id, weight: 5000 })));
      await first.close();
    }
    await context.close();
  }
});
test.afterAll(async ({ browser }) => {
  for (const member of members) await removeMember(browser, member.id);
});

async function open(browser: Browser, who: number, width: number) {
  const context = await browser.newContext({ storageState: members[who]!.state, viewport: { width, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/#/settings");
  const heading = page.locator("#tilit").getByRole("heading", { name: "Tilille tullut ja lähtenyt raha kuukausittain", exact: true });
  await expect(heading).toBeVisible({ timeout: 30_000 });
  return { context, page, seen, heading };
}

test("the joint account has its months under its row: the newest one open, the older ones as a name that opens, and no other account has them", async ({ browser }) => {
  const { context, page, seen, heading } = await open(browser, 0, 1280);
  const tilit = page.locator("#tilit");
  // only the joint account has the block
  await expect(heading).toHaveCount(1);

  const section = tilit.locator("section.acc-src");
  const months = section.locator(".acc-src-month");
  expect(await months.count()).toBeGreaterThan(2);
  await expect(section.locator("table")).toHaveCount(1);
  await expect(months.nth(0).locator("button")).toHaveAttribute("aria-expanded", "true");
  await expect(months.nth(2).locator("button")).toHaveAttribute("aria-expanded", "false");

  // a column for each member and the rest, and the four figures and the balance as rows
  const first = months.nth(0).locator("table");
  await expect(first.locator("thead th")).toHaveCount(3);
  await expect(first.locator("thead th").nth(2)).toHaveText("Ei tiedossa");
  await expect(first.locator("tbody th")).toHaveText(["Maksettu tilille", "Menot", "Siirretty tililtä", "Omat tilisiirrot", "Saldo kuun lopussa"]);

  // a figure of the table links to the account's rows of the month; the balance does not
  const link = first.locator("tbody a").first();
  await expect(link).toHaveAttribute("href", /^#\/transactions\?accountId=[^&]+&from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}$/);
  await expect(first.locator("tbody tr").last().locator("a")).toHaveCount(0);
  // a month with nothing in a cell has a dash there, never 0,00
  await expect(section.locator("td", { hasText: /^0,00[\s ]*€$/ })).toHaveCount(0);

  // an older month opens with its name and closes with it
  await months.nth(2).locator("button").click();
  await expect(months.nth(2).locator("table")).toHaveCount(1);
  await months.nth(2).locator("button").click();
  await expect(months.nth(2).locator("table")).toHaveCount(0);

  // the link leads to the rows of the account and the month
  await link.evaluate((a) => a.scrollIntoView({ block: "center" }));
  await link.click();
  await expect(page).toHaveURL(/#\/transactions\?accountId=/);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("the member it is shared with by the other link sees the same months, and a phone has no sideways scroll", async ({ browser }) => {
  const { context, page, seen, heading } = await open(browser, 1, 390);
  await expect(heading).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  // a row is its name above its figures, each under the name of its member
  const first = page.locator("section.acc-src .acc-src-month").nth(0).locator("table");
  await expect(first.locator("tbody tr").first().locator("td").first()).toHaveAttribute("data-label", /.+/);
  const widest = await first.evaluate((t) => t.getBoundingClientRect().width);
  expect(widest).toBeLessThanOrEqual(390);
  expect(seen.problems).toEqual([]);
  await context.close();
});
