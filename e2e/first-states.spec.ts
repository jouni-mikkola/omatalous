import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { makeMember, removeMember, watch } from "./helpers.ts";

// docs/design/README.md section 4: what each view says before there is a bank, and with under three months of rows.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

const VIEWS = [
  { hash: "#/overview", title: "Nyt", line: "Tässä näet, paljonko voit vielä käyttää ennen palkkapäivää." },
  { hash: "#/reports", title: "Kuukausi", line: "Tässä näet, mihin rahat menivät tässä kuussa tavalliseen verrattuna." },
  { hash: "#/bills", title: "Tulossa", line: "Tässä näet, mitä laskuja ja tuloja on tulossa." },
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
    await route.fulfill({ response, json: { ...(await response.json()), accounts: [], sharedAccounts: [] } });
  });
  const page = await context.newPage();
  await page.goto("/#/bills");
  await expect(page.locator(".first-run").getByRole("heading", { name: "Tulossa", exact: true })).toBeVisible();
  await page.locator(".empty-start").getByRole("button", { name: "Yhdistä pankki" }).click();
  await expect(page).toHaveURL(/#\/settings\/banks/);
  await context.close();
});

const fi = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;

// Two months of rows from a bank's file: Kuukausi has the month's sum and each category's, and says what the usual waits for.
test("on two months of rows Kuukausi shows its sums and says the usual needs three months", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "e2e-kaksi-kuuta");
  const context = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    const { today } = (await (await context.request.get("/api/meta")).json()) as { today: string };
    const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
    const before = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    const file = [
      "Kirjauspäivä;Määrä EUR;Saaja/Maksaja",
      `${fi(`${before}-03`)};-50,00;K-MARKET KAMPPI`,
      `${fi(`${before}-05`)};2 500,00;ACME OY`,
      `${fi(`${today.slice(0, 7)}-01`)};-23,40;PRISMA TIKKURILA`,
    ].join("\n");
    await page.goto("/#/settings");
    await page.locator('input[data-kind="statement-file"]').setInputFiles({ name: "tapahtumat.csv", mimeType: "text/csv", buffer: Buffer.from(file, "utf8") });
    await expect(page.getByText("PRISMA TIKKURILA")).toBeVisible();
    await page.getByLabel("Summan sarake").selectOption({ label: "Määrä EUR" });
    await page.getByLabel("Tilin nimi").fill("Käyttötili");
    await page.getByRole("button", { name: "Tallenna rivit" }).click();
    await expect(page.getByText(/Uusia rivejä 3, valmiiksi tallessa olleita 0/)).toBeVisible();

    await page.goto("/#/reports");
    await page.reload();
    const view = page.locator(".km");
    await expect(view.locator(".km-total")).toContainText(/Menot\s23\s€, tavallinen tarvitsee 3 kuukautta/, { timeout: 15_000 });
    // the categories stand with their sums alone: no usual, no gap
    await expect(view.locator("tbody tr").first()).toContainText("23,40");
    await expect(view.getByRole("columnheader")).toHaveText(["Luokka", "Menot"]);
    await expect(view).not.toContainText("Yleensä");
  } finally {
    await context.close();
    await removeMember(browser, id);
  }
});
