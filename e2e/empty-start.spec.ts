import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { makeMember, overflow, removeMember, watch } from "./helpers.ts";

// The page of a household with no account: the centred card the end of Tarkistettavat also is. A heading, one sentence
// on what happens next, the steps in their order with the next one named, and the two buttons in one row. Made for a
// member of their own, who has not linked a bank and has not loaded the example data.
for (const width of [1440, 390]) {
  test(`at ${width} px the empty start is a heading, a sentence, and the way on`, async ({ browser }) => {
    const { state, id } = await makeMember(browser, `e2e-tyhja-${width}`);
    const context = await browser.newContext({ storageState: state, viewport: { width, height: 844 } });
    try {
      const page = await context.newPage();
      const seen = watch(page);
      await page.goto("/#/transactions");
      const start = page.locator(".empty-start");
      const heading = start.getByRole("heading", { name: "Ei vielä tietoja" });
      await expect(heading).toBeVisible();
      // nothing else had the focus: the heading has it, so a reader starts from it
      await expect(heading).toBeFocused();
      await expect(start.locator("p")).toHaveCount(1);
      // a member whose install has no bank app is told the administrator sets it up, and is offered the statement file, not the bank list
      await expect(start.locator("p")).toContainText("Ylläpitäjä asettaa pankkiyhteyden");
      await expect(start.locator("p")).toContainText("tiliotteesta");
      await expect(start.locator("p")).toContainText("pyytää toista jäsentä jakamaan tilinsä");
      await expect(start.getByText("Enable Banking")).toHaveCount(0);
      await expect(start.getByRole("list", { name: "Käyttöönotto" })).toHaveCount(0);
      // the administrator's accounts are in the household: no example data on offer
      await expect(start.getByRole("button")).toHaveText(["Tuo tiliote"]);
      // centred: the heading's middle is the card's
      const [card, head] = [(await start.boundingBox())!, (await heading.boundingBox())!];
      expect(Math.abs(card.x + card.width / 2 - (head.x + head.width / 2))).toBeLessThanOrEqual(2);
      expect(await overflow(page), `the empty start scrolls sideways at ${width}px`).toBeLessThanOrEqual(1);
      expect(seen.problems).toEqual([]);
      // Pankit ja tilit says the same: no bank list, the statement file, and no link to the example data
      await start.getByRole("button", { name: "Tuo tiliote" }).click();
      await expect(page).toHaveURL(/#\/settings\/banks/);
      const connections = page.locator("#pankkiyhteydet");
      await expect(connections).toContainText("Ylläpitäjä asettaa pankkiyhteyden");
      await expect(connections.getByRole("button", { name: "Yhdistä pankki" })).toHaveCount(0);
      await expect(page.getByText("Valitse pankki")).toHaveCount(0);
      await expect(page.locator("#tiliote")).toBeVisible();
      await expect(page.locator("#tilit")).not.toContainText("esimerkkitiedoilla");
      await expect(page.getByRole("link", { name: /esimerkkitiedo/i })).toHaveCount(0);
      // Tiedot offers none either: the administrator's accounts are in the household
      await page.goto("/#/settings/data");
      await expect(page.getByRole("heading", { name: "Tiedot" }).or(page.getByRole("button", { name: "Vie tiedot" })).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Lataa esimerkkitiedot" })).toHaveCount(0);
      expect(await overflow(page), `Pankit ja tilit scrolls sideways at ${width}px`).toBeLessThanOrEqual(1);
    } finally {
      await context.close();
      await removeMember(browser, id);
    }
  });
}

// A bank is linked and the first fetch has not listed its accounts: the same card says what is happening, with the
// third step current. The server's answer is changed here because the real fetch is over in a moment.
test("with a bank linked and nothing fetched the empty start says the fetch is under way", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "e2e-haku-kesken");
  const context = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 844 } });
  try {
    await context.route(/\/api\/meta(\?|$)/, async (route) => {
      const response = await route.fetch();
      const meta = await response.json();
      const connection = { id: "c1", institution: "Nordea", status: "active", state: "active", history: false, replaced: false, validUntil: null, createdAt: "2026-10-01T00:00:00.000Z", lastSyncedAt: null, daysLeft: 90, needsRenewal: false };
      await route.fulfill({ response, json: { ...meta, connections: [connection], bank: { ...meta.bank, source: "instance" }, lastSync: null } });
    });
    const page = await context.newPage();
    await page.goto("/#/overview");
    const start = page.locator(".empty-start");
    await expect(start).toContainText("Haemme tapahtumia");
    await expect(start.locator("li[aria-current=step]")).toHaveText("Ensimmäinen haku tehty");
  } finally {
    await context.close();
    await removeMember(browser, id);
  }
});

// Nobody in the household has data: the example data is the way to see the pages.
test("with no data in the household the example data is offered", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "e2e-tyhja-talous");
  const context = await browser.newContext({ storageState: state, viewport: { width: 390, height: 844 } });
  try {
    await context.route(/\/api\/meta(\?|$)/, async (route) => {
      const response = await route.fetch();
      const meta = await response.json();
      await route.fulfill({ response, json: { ...meta, householdHasAccounts: false } });
    });
    const page = await context.newPage();
    await page.goto("/#/reports");
    await expect(page.locator(".empty-start").getByRole("button")).toHaveText(["Tuo tiliote", "Lataa esimerkkitiedot"]);
  } finally {
    await context.close();
    await removeMember(browser, id);
  }
});

// Pictures of the start card and of Pankit ja tilit, only when asked for: SHOTS_DIR=$TMPDIR/shots pnpm e2e e2e/empty-start.spec.ts
for (const width of [1440, 390]) {
  test(`pictures of a member without a bank app at ${width} px`, async ({ browser }) => {
    test.skip(!process.env.SHOTS_DIR, "pictures only when SHOTS_DIR is set");
    const { state, id } = await makeMember(browser, `e2e-kuva-${width}`);
    const context = await browser.newContext({ storageState: state, viewport: { width, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto("/#/transactions");
      await expect(page.locator(".empty-start")).toBeVisible();
      await page.screenshot({ path: join(process.env.SHOTS_DIR!, `member-start-${width}.png`) });
      await page.goto("/#/settings/banks?add=1");
      await expect(page.locator("#tilit")).toBeVisible();
      // the cards fade in: the picture waits for them
      await page.waitForTimeout(1000);
      await page.screenshot({ path: join(process.env.SHOTS_DIR!, `member-banks-${width}.png`), fullPage: true });
    } finally {
      await context.close();
      await removeMember(browser, id);
    }
  });
}
