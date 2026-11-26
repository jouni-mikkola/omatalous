import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { join } from "node:path";
import { AXE, serious, type Violation } from "./axe.ts";
import { createMember, OVERVIEW_TILES, removeMember, watch } from "./helpers.ts";

// axe-core on the pages that need a state of their own: Tarkistettavat with a question and empty, the sign-in and the wizard.
// Every route of the main menu is read by route-walk.spec.ts.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

async function visit(context: BrowserContext, path: string, ready: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(path);
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(ready).first()).toBeVisible();
  // a card that refetches is dimmed (.loading, base.css): its colours are read once it has settled
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
  return page;
}

// 0.69: the pages of the round's UI5, at the desktop and the phone width. Tarkistettavat is looked at with
// a question on it and with the queue empty.
// The list of debts: a loan whose kind the rows only suggest, and one whose kind they tell; each asks what is left.
const debtOf = (n: number, placed: boolean) => ({
  id: `proposal:a11y-${n}`, source: "proposal", name: `Pankki ${n} Oyj`, loanId: null, accountId: null, key: `a11y-${n}`, kind: placed ? "mortgage" : "consumer", placed,
  monthlyCents: 10_000, latestCents: 10_000, lastDate: "2025-12-02", owedCents: null, balanceDate: null, gaps: [], subject: null, terms: null, savedCards: [],
});
const LOAN = { kind: "loan_terms_list", id: "loan-terms:proposal:a11y-1", cents: 120_000, debts: [debtOf(1, false)], debtsCents: null, noBalance: 2, fromRows: 2 };
for (const width of [1280, 390]) {
  for (const [name, path, ready, queue] of [
    ["Tarkistettavat, a question", "/#/review", ".review-item", [LOAN]],
    ["Tarkistettavat, empty", "/#/review", ".review-end", []],
  ] as const) {
    test(`${name}, ${width} px: axe finds no serious or critical violation`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, bypassCSP: true, ...(width < 600 ? { isMobile: true, hasTouch: true } : {}) });
      if (queue) await context.route(/\/api\/review(\?|$)/, (r) => r.fulfill({ json: { items: queue } }));
      const page = await visit(context, path, ready);
      const seen = watch(page);
      expect(await serious(page)).toEqual([]);
      expect(seen.problems).toEqual([]);
      await context.close();
    });
  }
}

// 0.69.1: three rules the serious-only checks above let through, on the pages that had them: a control's name holds its visible
// text, a landmark is told apart from its twin, a table head cell is not empty. Any impact counts here.
const MANY = { ...LOAN, debts: Array.from({ length: 5 }, (_, i) => debtOf(i + 1, i % 2 === 1)), noBalance: 5, fromRows: 5 };
const RULES = ["label-content-name-mismatch", "landmark-unique", "empty-table-header"];
for (const width of [1440, 390]) {
  for (const [name, path, ready, queue] of [
    ["Yhteenveto", "/#/overview", OVERVIEW_TILES, null],
    ["Tarkistettavat", "/#/review", ".review-debt-list", [MANY]],
    ["Tapahtumat", "/#/transactions", ".tx-bar", null],
    ["Asetukset", "/#/settings/members", "table:has(caption:text-is(\"Talouden jäsenet\"))", null],
  ] as const) {
    test(`${name}, ${width} px: axe finds no mismatched name, repeated landmark or empty table header`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, bypassCSP: true, ...(width < 600 ? { isMobile: true, hasTouch: true } : {}) });
      if (queue) await context.route(/\/api\/review(\?|$)/, (r) => r.fulfill({ json: { items: queue } }));
      const page = await visit(context, path, ready);
      await page.addScriptTag({ path: AXE });
      const found = await page.evaluate(async (rules) => {
        const run = (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: Violation[] }> } }).axe.run;
        return (await run(document, { runOnly: { type: "rule", values: rules }, resultTypes: ["violations"] })).violations;
      }, RULES);
      expect(found.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} [${n.any[0]?.message ?? ""}]`).join(" | ")}`)).toEqual([]);
      await context.close();
    });
  }
}

// S10: the sign-in and the first-run wizard, any impact, at the phone and the desktop width. The sign-in is a context nobody is
// signed in in. The wizard is the administrator's page with the server's answer that the setup is not finished.
const EVERY = ["critical", "serious", "moderate", "minor"] as const;
for (const width of [390, 1440]) {
  const phone = width < 600 ? { isMobile: true, hasTouch: true } : {};
  test(`Kirjautuminen, ${width} px: axe finds no violation`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, bypassCSP: true, ...phone });
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Kirjaudu sisään" })).toBeVisible();
    expect(await serious(page, [...EVERY])).toEqual([]);
    // the failed sign-in notice is part of the page too
    await page.getByLabel("Käyttäjätunnus").fill("ei-ole");
    await page.getByLabel("Salasana").fill("väärä-salasana-123");
    await page.getByRole("button", { name: "Kirjaudu sisään" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    expect(await serious(page, [...EVERY])).toEqual([]);
    expect(seen.problems.filter((p) => !/\b40[01]\b/.test(p))).toEqual([]);
    await context.close();
  });

  test(`Ohjattu aloitus, ${width} px: axe finds no violation`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, bypassCSP: true, ...phone });
    await context.route(/\/api\/meta(\?|$)/, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), setupDone: false } });
    });
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Käyttöönotto" })).toBeVisible();
    await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator(".setup-steps")).toBeVisible();
    expect(await serious(page, [...EVERY])).toEqual([]);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

// Screen reader pass (BA-68, Orca): a chart's keyboard stop sits beside the image, never inside it (route-walk.spec.ts checks
// that no control sits inside an image). Here the stop is in the accessibility tree: named, and its focus shows its sums.
test("a chart's keyboard stop is in the accessibility tree", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 }, bypassCSP: true });
  const page = await visit(context, "/#/reports?q=tulot", ".month-bars");
  // Raportit > Tulot ja menot: each month is a link beside the image, named by its sums, and its focus shows them
  const months = page.locator(".month-bars").getByRole("link", { name: /Avaa kuukauden tapahtumat$/ });
  await expect(months).toHaveCount(12);
  await months.first().focus();
  await expect(months.first()).toBeFocused();
  const picked = ((await months.first().getAttribute("aria-label")) ?? "").split(":")[0];
  await expect(page.locator(".month-bars .readout-line .readout-title")).toHaveText(picked!);
  await context.close();
});


// a 40-character name keeps the top bar to one row
for (const width of [390, 1100, 1440]) {
  test(`a 40-character name stays on one line of the bar, ${width} px`, async ({ browser }) => {
    const dir = process.env.E2E_DIR ?? ".";
    const admin = await browser.newContext({ storageState: join(dir, "admin-state.json") });
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const name = "Liisa Meikäläinen-Virtanen von Pitkänimi";
    const id = await createMember(admin, context, "pitkanimi", name);
    try {
      const page = await context.newPage();
      await page.goto("/#/overview");
      // a phone shows the initials, the name stays as the button's name
      const phoneWidth = width < 641;
      const small = page.locator(phoneWidth ? ".user-menu summary .user-initials" : ".user-menu summary .user-name");
      await small.waitFor({ state: "visible" });
      if (phoneWidth) {
        await expect(small).toHaveText("LP");
        await expect(page.locator(".user-menu summary")).toContainText(name);
      }
      const bar = await page.locator(".topbar").boundingBox();
      expect(bar!.height).toBeLessThanOrEqual(49);
      // the bar of a build with more pages leaves less room: the name must give way by itself, not wrap
      expect(await small.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("nowrap");
      {
        const lines = await small.evaluate((el) => el.getClientRects()[0]!.height / parseFloat(getComputedStyle(el).lineHeight));
        expect(lines).toBeLessThan(1.5);
      }
    } finally {
      await context.close();
      await admin.close();
      await removeMember(browser, id);
    }
  });
}
