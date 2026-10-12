import { expect, test } from "@playwright/test";
import { cents, fakeBank, linkFakeBank, makeMember, removeMember, watch } from "./helpers.ts";

// A consent that ends for real: the page goes to the bank, the bank sends it back, and the accounts and their rows come
// from the fake bank (e2e/fake-bank/). The accounts are those of a member made here, so the demo household of the
// administrator that the other specs read stays as it is; the member and the link go at the end. Needs nothing from the
// specs before it: run alone, it makes the administrator itself.
const USERNAME = "e2e-pankki";

let member: { state: string; id: string };
test.beforeAll(async ({ browser }) => {
  member = await makeMember(browser, USERNAME);
});
test.afterAll(async ({ browser }) => removeMember(browser, member.id));

test("linking the fake bank brings four accounts: the joint one with both holders, the card with its limit and bar, and a balance on Yhteenveto", async ({ browser }) => {
  const context = await browser.newContext({ storageState: member.state, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await linkFakeBank(page);
  await expect(page.locator(".notice").filter({ hasText: "Pankki yhdistetty, 4 tiliä" })).toBeVisible();

  // the fetch the callback starts is on its way: the accounts have their balance when it has read them all
  await expect
    .poll(async () => ((await (await context.request.get("/api/meta")).json()).accounts as { balanceCents: number | null }[]).filter((a) => a.balanceCents !== null).length)
    .toBe(4);

  await page.goto("/#/settings");
  await page.reload();
  const tilit = page.locator("#tilit");
  // every row holds the account types in its select, so a row is found by the name it starts with
  const row = (name: string) => tilit.getByRole("row", { name: new RegExp(`^${name} `) });
  // the header, four accounts, and the row under the joint account that has its parts
  await expect(tilit.getByRole("row")).toHaveCount(6);
  await expect(row("Käyttötili")).toContainText("FI21 1234 5600 0007 85");
  await expect(row("Käyttötili")).toContainText("MEIKALAINEN MATTI");
  await expect(row("Säästötili")).toContainText("FI14 1009 3000 1234 58");
  await expect(row("Yhteistili")).toContainText("FI96 1234 5600 0007 93");
  await expect(row("Yhteistili")).toContainText("MEIKALAINEN MATTI, KORHONEN ELISA");
  await expect(row("Käyttötili")).not.toContainText("KORHONEN");

  // the card: its last digits, the limit of 3 000 € and the bar of what is used
  const card = row("ESIMERKKIPANKKI Luottokortti");
  await expect(card).toContainText("•••• 4321");
  await expect(card).toContainText(/Luottoraja 3\s000\s€, käytössä/);
  await expect(card.locator(".credit-bar")).toBeVisible();
  await expect(tilit.locator(".credit-bar")).toHaveCount(1);

  // Yhteenveto shows the balance the bank gave for the checking account
  const bank = fakeBank();
  const balances = await (await context.request.get(`${bank.url}/accounts/fb-chk/balances`, { headers: { Authorization: "Bearer test" } })).json();
  await page.goto("/#/overview");
  const holdings = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Varallisuus", exact: true }) });
  const amount = holdings.locator(".holding-row", { hasText: "Käyttötili" }).locator(".holding-amount");
  await expect(amount).toBeVisible();
  expect(cents(await amount.innerText())).toBe(cents(balances.balances[0].balance_amount.amount.replace(".", ",")));

  expect(seen.problems).toEqual([]);
  await context.close();
});
