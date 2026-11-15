import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { makeMember, removeMember, watch } from "./helpers.ts";

// docs/design/README.md section 4: what each view says before there is a bank, and with under three months of rows.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

const VIEWS = [
  { hash: "#/overview", title: "Yhteenveto", line: "Tässä näet, paljonko voit vielä käyttää ennen palkkapäivää." },
  { hash: "#/reports", title: "Raportit", line: "Tässä näet, mihin rahat menevät ja mistä ne tulevat kuukausittain." },
  { hash: "#/bills", title: "Laskut", line: "Tässä näet, mitä laskuja ja tuloja on tulossa." },
  { hash: "#/review", title: "Tarkistettavat", line: "Tässä näet, onko jokin pielessä." },
];

// A member with no account and no bank: each of the four views has its title, its one line and the button that opens Pankit ja tilit.
test("with no account each view says in one line what it will answer and opens Pankit ja tilit", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "e2e-eka-tila");
  const context = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    const seen = watch(page);
    for (const view of VIEWS) {
      await page.goto(`/${view.hash}`);
      const first = page.locator(".first-run");
      await expect(first.getByRole("heading", { name: view.title, exact: true })).toBeVisible();
      await expect(first.locator("p")).toHaveText([view.line]);
      // no sample figures: nothing on the page is a sum
      await expect(page.locator("main")).not.toContainText("€");
      const way = page.locator(".empty-start").getByRole("button").first();
      await expect(way).toBeVisible();
      await way.click();
      await expect(page).toHaveURL(/#\/settings\/banks/);
      await expect(page.locator("#pankkiyhteydet")).toBeVisible();
    }
    expect(seen.problems).toEqual([]);
  } finally {
    await context.close();
    await removeMember(browser, id);
  }
});

// The wizard of the administrator whose setup is not finished (the server's answer is changed, as in a11y.spec.ts).
test("the first-run wizard has two steps", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  await context.route(/\/api\/meta(\?|$)/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), setupDone: false } });
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Käyttöönotto" })).toBeVisible();
  // the head's list of steps; the Enable Banking step has a list of its own instructions below it
  await expect(page.locator(".wizard-head .wizard-steps > li")).toHaveText([/Enable Banking/, /Tarkistus/]);
  await context.close();
});

// The administrator's button is Yhdistä pankki: with the server's answer that there is no account it opens Pankit ja tilit too.
test("with no account the administrator's button opens Pankit ja tilit", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  await context.route(/\/api\/meta(\?|$)/, async (route) => {
    const response = await route.fetch();
    const meta = await response.json();
    await route.fulfill({ response, json: { ...meta, accounts: [], sharedAccounts: [], bank: { ...meta.bank, source: "instance" } } });
  });
  const page = await context.newPage();
  await page.goto("/#/bills");
  await expect(page.locator(".first-run").getByRole("heading", { name: "Laskut", exact: true })).toBeVisible();
  await page.locator(".empty-start").getByRole("button", { name: "Yhdistä pankki" }).click();
  await expect(page).toHaveURL(/#\/settings\/banks/);
  await context.close();
});
