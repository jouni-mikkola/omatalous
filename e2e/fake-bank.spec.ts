import { expect, test } from "@playwright/test";
import { cents, fakeBank, linkFakeBank, makeMember, metaWhileSyncing, removeMember, watch } from "./helpers.ts";

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
    .poll(async () => (await metaWhileSyncing(context))?.accounts.filter((a) => a.balanceCents !== null).length ?? 0)
    .toBe(4);

  await page.goto("/#/settings");
  await page.reload();
  const tilit = page.locator("#tilit");
  // every row holds the account types in its select, so a row is found by the name it starts with
  const row = (name: string) => tilit.getByRole("row", { name: new RegExp(`^${name} `) });
  // the header, four accounts, and the row under the joint account that has its split (Jako), which holds the parts too (#392)
  await expect(tilit.locator(".accounts-table > thead > tr, .accounts-table > tbody > tr")).toHaveCount(6);
  // the number and the holder are behind Muokkaa, not on the row
  await expect(row("Käyttötili")).not.toContainText("FI21 1234 5600 0007 85");
  await page.getByRole("button", { name: "Muokkaa tiliä Käyttötili" }).click();
  const form = tilit.locator(".account-form");
  await expect(form).toContainText("FI21 1234 5600 0007 85");
  await expect(form).toContainText("MEIKALAINEN MATTI");
  await expect(form).not.toContainText("KORHONEN");
  await form.getByRole("button", { name: "Peruuta" }).click();
  await page.getByRole("button", { name: "Muokkaa tiliä Yhteistili" }).click();
  await expect(form).toContainText("FI96 1234 5600 0007 93");
  await expect(form).toContainText("MEIKALAINEN MATTI, KORHONEN ELISA");
  await form.getByRole("button", { name: "Peruuta" }).click();

  // the card: the limit of 3 000 € and the bar of what is used
  const card = row("ESIMERKKIPANKKI Luottokortti");
  await expect(card).toContainText(/Luottoraja 3\s000\s€, käytössä/);
  await expect(card.locator(".credit-bar")).toBeVisible();
  await expect(tilit.locator(".credit-bar")).toHaveCount(1);

  // Saldot shows the balance the bank gave for the checking account
  const bank = fakeBank();
  const balances = await (await context.request.get(`${bank.url}/accounts/fb-chk/balances`, { headers: { Authorization: "Bearer test" } })).json();
  await page.goto("/#/reports?q=saldot");
  const holdings = page.getByRole("region", { name: "Varat ja velat", exact: true });
  // the heading of the type Käyttötilit is a row of the list too, so the account's own rows are the ones to look at
  const amount = holdings.locator(".st-row.holding-account", { hasText: "Käyttötili" }).locator(".st-num");
  await expect(amount).toBeVisible();
  expect(cents(await amount.innerText())).toBe(cents(balances.balances[0].balance_amount.amount.replace(".", ",")));

  expect(seen.problems).toEqual([]);
  await context.close();
});
