import { expect, type Route, test } from "@playwright/test";
import { join } from "node:path";
import { watch } from "./helpers.ts";

// Tarkistettavat is the fourth tab with the count of its open items, and each kind of thing that is wrong (a row with
// no name, a bill that did not come, a bank consent ending, a balance the rows do not add up to) has a card with its
// answer. The queue is the one the server's test makes (apps/server/test/review.test.ts, "what is wrong, in the same
// queue"), sent here by a stand-in for GET /api/review: an item leaves it when the page sends the item's own answer,
// or, for the two the page cannot settle itself, when the member has gone where it sends them.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

const ROW = { kind: "row", id: "row:t-1", cents: 3750, rowId: "t-1", side: "out", date: "2026-10-03", picks: ["groceries"], rowCount: 1, rows: [{ id: "t-1", date: "2026-10-03", cents: -3750, name: "", text: "" }] };
const BILL = { kind: "bill", id: "bill:s-1", cents: 6420, seriesId: "s-1", subject: "series:out:chk:Esimerkkisähkö#6420", merchant: "Esimerkkisähkö", dueDate: "2026-10-01" };
const CONSENT = { kind: "consent", id: "consent:sess-1", cents: 3_917_040, connection: "sess-1", institution: "Esimerkkipankki", daysLeft: 6, accounts: ["Käyttötili"] };
const BALANCE = { kind: "balance", id: "balance:chk", cents: 1000, accountId: "chk", accountName: "Käyttötili", fromDay: "2026-10-01", toDay: "2026-10-07", bankCents: -4750, rowsCents: -3750 };

for (const width of [390, 1280]) {
  test(`${width} px: Tarkistettavat is the fourth tab, each kind of item is answered and the count falls to zero`, async ({ browser }) => {
    const phone = width < 600;
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, isMobile: phone, hasTouch: phone });
    const page = await context.newPage();
    const seen = watch(page);
    let items: { id: string }[] = [ROW, BILL, CONSENT, BALANCE];
    const sent: string[] = [];
    const gone = (id: string) => (items = items.filter((i) => i.id !== id));
    await context.route(/\/api\/review$/, (r) => r.fulfill({ json: { items } }));
    await context.route(/\/api\/review\/count$/, (r) => r.fulfill({ json: { count: items.length } }));
    const answered = (id: string) => async (r: Route) => {
      sent.push(`${r.request().method()} ${new URL(r.request().url()).pathname} ${r.request().postData() ?? ""}`);
      gone(id);
      await r.fulfill({ json: { ok: true } });
    };
    await context.route(/\/api\/transactions\/t-1$/, answered(ROW.id));
    await context.route(/\/api\/marks$/, (r) => (r.request().method() === "PUT" ? answered(BILL.id)(r) : r.continue()));

    await page.goto("/#/overview");
    const tab = page.locator("header.topbar .review-link");
    const count = tab.locator(".nav-count");
    await expect(tab).toContainText("Tarkistettavat");
    await expect(count).toHaveText("4 avoinna");
    await tab.click();
    await expect(tab).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tarkistettavat: 4 avoinna");
    const card = page.locator(".review-item");
    const question = page.locator("#review-q");

    // a row with no name: a category for the one row
    await expect(card.locator(".review-name")).toHaveText("Tapahtuma ilman nimeä");
    await expect(question).toHaveText("Mihin kategoriaan tämä maksu kuuluu?");
    await expect(card.locator(".review-figure")).toContainText("37,50");
    await card.locator(".review-choices .review-choice").first().click();
    await expect(count).toHaveText("3 avoinna");
    expect(sent).toEqual([`PATCH /api/transactions/t-1 {"category":"groceries"}`]);

    // a bill that did not come: Lopetettu is the mark Laskut reads
    await expect(card.locator(".review-name")).toHaveText("Esimerkkisähkö");
    await expect(question).toHaveText("Tuleeko tämä lasku vielä?");
    await expect(card.locator(".review-figure")).toContainText("64,20");
    await card.getByRole("button", { name: "Lopetettu", exact: true }).click();
    await expect(count).toHaveText("2 avoinna");
    expect(sent[1]).toBe(`PUT /api/marks {"subject":"${BILL.subject}","mark":"cancelled"}`);

    // a consent that ends: the bank is connected again in Asetukset, and the item is gone once it is
    await expect(card.locator(".review-name")).toHaveText("Esimerkkipankki");
    await expect(question).toHaveText("Pankkiyhteys on päättymässä. Yhdistätkö pankin uudelleen?");
    await expect(card.locator(".review-line")).toContainText("6 päivän päästä");
    await card.getByRole("link", { name: "Yhdistä pankki uudelleen" }).click();
    await expect.poll(() => new URL(page.url()).hash).toMatch(/^#\/settings\/banks/);
    gone(CONSENT.id);
    await page.goto("/#/review");
    await expect(count).toHaveText("1 avoinna");

    // a balance the rows do not add up to: the account's own row tells the stretch, and the item goes when the rows add up
    await expect(card.locator(".review-name")).toHaveText("Käyttötili");
    await expect(question).toHaveText("Puuttuuko tililtä tapahtuma?");
    await expect(card.locator(".review-figure")).toContainText("10,00");
    await card.getByRole("link", { name: "Avaa tilin tiedot" }).click();
    await expect.poll(() => new URL(page.url()).hash).toMatch(/^#\/settings\/banks#tilit/);
    gone(BALANCE.id);
    await page.goto("/#/review");

    // nothing is left: the tab has no count and the page says so
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tarkistettavat");
    await expect(page.locator(".review-end")).toBeVisible();
    await expect(tab).toContainText("Tarkistettavat");
    await expect(count).toHaveCount(0);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}
