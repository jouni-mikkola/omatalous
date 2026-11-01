import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { unfold } from "./helpers.ts";

// Raportit > Menot, Kategoriat: a head sorts by the keyboard, `aria-sort` follows the press and a polite sentence says the order.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

test("Enter on the Yhteensä head sorts the categories, aria-sort changes and the new order is said", async ({ browser }) => {
  const context = await browser.newContext({
    storageState: STATE,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/#/reports?period=12m&q=menot");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await unfold(page, "kategoriat");
  const head = page.getByRole("columnheader", { name: /^Yhteensä/ }).first();
  await expect(head).toHaveAttribute("aria-sort", "none");
  const button = head.getByRole("button");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(head).toHaveAttribute("aria-sort", "descending");
  await expect(page.getByRole("status").filter({ hasText: "Järjestetty: Yhteensä, suurin ensin" })).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(head).toHaveAttribute("aria-sort", "ascending");
  await page.keyboard.press("Enter");
  await expect(head).toHaveAttribute("aria-sort", "none");
  await expect(page.getByRole("status").filter({ hasText: "Alkuperäinen järjestys" })).toHaveCount(1);
  await context.close();
});

// The toolbar of Kategoriat: a chip's count is the number of rows shown when it is chosen, the search narrows the rows and the
// counts, the CSV holds the rows shown with sums as numbers, and a phone has a sort choice in place of the head.
const REPORT = "/#/reports?period=12m&q=menot";
const CATEGORIES = ".rt:has(caption:text-is('Menot kategorioittain'))";
/** The "Lataa CSV" link under the table that has this caption. */
const csvOf = (page: import("@playwright/test").Page, caption: string) => page.locator(`.rt-wrap:has(caption:text-is('${caption}')) ~ .rt-csv`).getByRole("button", { name: "Lataa CSV" });
const CATEGORY_ROWS = `${CATEGORIES} tbody tr:not(.rt-group):not(.rt-detail):not(.rt-spacer):not(.rt-subrow)`;

async function openCategories(page: import("@playwright/test").Page) {
  await page.goto(REPORT);
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await unfold(page, "kategoriat", "ruoka");
  await expect(page.getByRole("group", { name: "Taulukon rajaus: Menot kategorioittain" })).toBeVisible();
}

test("a chip filters the rows and its count is the number of rows shown", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await openCategories(page);
  const bar = page.getByRole("group", { name: "Taulukon rajaus: Menot kategorioittain" });
  const chips = bar.getByRole("radio");
  const all = await page.locator(CATEGORY_ROWS).count();
  await expect(chips.first()).toContainText("Kaikki");
  expect(Number((await chips.first().innerText()).match(/\d+$/)![0])).toBe(all);
  const n = await chips.count();
  expect(n, "Kaikki and at least one more chip").toBeGreaterThan(1);
  for (let i = 1; i < n; i++) {
    const chip = chips.nth(i);
    const count = Number((await chip.innerText()).match(/\d+$/)![0]);
    await chip.click();
    await expect(chip).toBeChecked();
    await expect(page.locator(CATEGORY_ROWS)).toHaveCount(count);
  }
  await chips.first().click();
  await expect(page.locator(CATEGORY_ROWS)).toHaveCount(all);
  await context.close();
});

test("the search narrows the rows and the chip counts follow it", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await openCategories(page);
  const first = (await page.locator(`${CATEGORY_ROWS} th[scope="row"] a`).first().innerText()).trim();
  await page.getByRole("searchbox", { name: "Hae kategoriaa" }).fill(first.slice(0, 4).toUpperCase());
  await expect(page.locator(CATEGORY_ROWS).first()).toBeVisible();
  const shown = await page.locator(CATEGORY_ROWS).count();
  const all = page.getByRole("group", { name: "Taulukon rajaus: Menot kategorioittain" }).getByRole("radio").first();
  expect(Number((await all.innerText()).match(/\d+$/)![0])).toBe(shown);
  await page.getByRole("searchbox", { name: "Hae kategoriaa" }).fill("zzzzzzzz");
  await expect(page.locator(CATEGORY_ROWS)).toHaveCount(0);
  await expect(page.getByText("Ei yhtään riviä, joka täsmää.")).toBeVisible();
  await context.close();
});

test("Lataa CSV saves the rows as the table shows them, in its order, with the figures it prints", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  await openCategories(page);
  const bar = page.getByRole("group", { name: "Taulukon rajaus: Menot kategorioittain" });
  await bar.getByRole("radio").nth(1).click();
  // the sort puts the groups of the page in their own order, so the file has to follow that and not a flat order
  await page.getByRole("button", { name: /^Yhteensä/ }).click();
  const shown = await page.locator(CATEGORY_ROWS).evaluateAll((rows) =>
    rows.map((r) => Array.from(r.querySelectorAll("th[scope=row] a, td")).map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim())),
  );
  const [download] = await Promise.all([page.waitForEvent("download"), csvOf(page, "Menot kategorioittain").click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const text = await (await import("node:fs/promises")).readFile((await download.path())!, "utf8");
  const lines = text.replace(/^\ufeff/, "").trim().split("\r\n").map((l) => l.split(";"));
  const head = lines[0]!;
  const col = (name: string) => head.findIndex((h) => h.replace(/"/g, "") === name);
  expect(lines.length - 1, "one line per row shown").toBe(shown.length);
  // a zero is drawn as a dash (BA-163) and written as 0
  const num = (t: string) => (t === "–" ? 0 : Number(t.replace(/[\s\u00a0\u202f€%]/g, "").replace("−", "-").replace(",", ".")));
  const sums = (name: string, at: number) => {
    const c = col(name);
    expect(c, `${name} is a column of the file`).toBeGreaterThanOrEqual(0);
    return lines.slice(1).map((l, i) => [l[c], shown[i]![at]] as const);
  };
  expect(lines.slice(1).map((l) => l[col("Kategoria")]!.replace(/"/g, "")), "the file's order is the table's").toEqual(shown.map((r) => r[0]));
  for (const [file, printed] of sums("Yhteensä", 1)) expect(Number(file!.replace(",", ".")), `${printed} in the file`).toBe(num(printed!));
  for (const [file, printed] of sums("Kiinteät", 2)) expect(Number(file!.replace(",", ".")), `${printed} in the file`).toBe(num(printed!));
  for (const [file, printed] of sums("Vaihtelevat", 3)) expect(Number(file!.replace(",", ".")), `${printed} in the file`).toBe(num(printed!));
  await context.close();
});

test("the keyboard reaches every control, and Escape closes an opened row and returns to it", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await openCategories(page);
  const bar = page.getByRole("group", { name: "Taulukon rajaus: Menot kategorioittain" });
  await bar.getByRole("searchbox").focus();
  await page.keyboard.press("Tab");
  // the search's clear button is empty and left out of the order; the chips are one tab stop and the arrows move among them
  await expect(bar.getByRole("radio", { checked: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(bar.getByRole("radio").nth(1)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  const drill = page.locator(`${CATEGORIES} .rt-drill`).first();
  await drill.focus();
  await page.keyboard.press("Enter");
  await expect(drill).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(`${CATEGORIES} tr.rt-detail`)).toHaveCount(1);
  // the opened row shows its transactions, at most ten, and the sentence
  await expect(page.locator(`${CATEGORIES} tr.rt-detail .rt-drill-sum`)).toContainText(/tapahtum.*yhteensä/);
  await expect(page.locator(`${CATEGORIES} tr.rt-detail table tbody tr`).first()).toBeVisible();
  expect(await page.locator(`${CATEGORIES} tr.rt-detail table tbody tr`).count()).toBeLessThanOrEqual(10);
  await page.locator(`${CATEGORIES} tr.rt-detail a`).first().focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(`${CATEGORIES} tr.rt-detail`)).toHaveCount(0);
  await expect(drill).toBeFocused();
  await context.close();
});

test("a phone has the sort choice above the rows in place of the head", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(REPORT);
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await unfold(page, "kategoriat");
  const pick = page.getByRole("group", { name: "Taulukon rajaus: Menot kategorioittain" }).getByRole("button", { name: /Järjestys/ });
  await expect(pick).toBeVisible();
  await pick.click();
  await page.getByRole("option", { name: "Yhteensä, suurin ensin" }).click();
  const names = await page.locator(`${CATEGORY_ROWS} th[scope="row"]`).allInnerTexts();
  expect(names.length).toBeGreaterThan(1);
  await expect(page.getByRole("status").filter({ hasText: "Järjestetty: Yhteensä, suurin ensin" })).toHaveCount(1);
  await context.close();
});

test("a short table of Menot has no toolbar and no CSV link: Ruokarivit", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await openCategories(page);
  await page.locator("#ruoka").scrollIntoViewIfNeeded();
  const rows = page.locator(".rt:has(caption:text-is('Ruokarivit')) tbody tr:not(.rt-group):not(.rt-detail):not(.rt-spacer):not(.rt-subrow)");
  const all = await rows.count();
  expect(all, "the table is short and not empty").toBeGreaterThan(1);
  expect(all, "the table is short").toBeLessThanOrEqual(10);
  await expect(page.getByRole("group", { name: "Taulukon rajaus: Ruokarivit" })).toHaveCount(0);
  await expect(csvOf(page, "Ruokarivit")).toHaveCount(0);
  await context.close();
});

test("Tapahtumat: the search finds a payee the list shows and the CSV has its names and amounts", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto("/#/transactions");
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  const bar = page.getByRole("group", { name: "Taulukon rajaus: Tapahtumat" });
  await expect(bar).toBeVisible();
  const rows = page.locator(".tx-table tbody tr:not(.rt-group):not(.rt-detail):not(.rt-spacer):not(.rt-subrow)");
  const shown = await rows.count();
  expect(shown).toBeGreaterThan(1);
  const name = (await rows.first().locator(".tx-name").innerText()).trim();
  const word = name.split(/\s+/).find((w) => w.length >= 3) ?? name;
  // the search is the server's: the list is drawn in windows, so the CSV (every found row) is compared with the answer's total
  const [found] = await Promise.all([page.waitForResponse((r) => /\/api\/transactions\?.*q=/.test(r.url())), bar.getByRole("searchbox").fill(word)]);
  const total = (await found.json()).total as number;
  await expect(page.getByText("Ladataan…")).toHaveCount(0);
  await expect(rows.first()).toBeVisible();
  expect(total, "the search narrowed the list").toBeLessThan((await (await page.request.get("/api/transactions?limit=1")).json()).total);
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator(".rt-wrap:has(.tx-table) ~ .rt-csv").getByRole("button", { name: "Lataa CSV" }).click()]);
  const lines = (await (await import("node:fs/promises")).readFile((await download.path())!, "utf8")).replace(/^\ufeff/, "").trim().split("\r\n").slice(1);
  expect(lines.length).toBe(total);
  for (const line of lines) {
    const cells = line.split(";");
    // the day of the group comes first, since the rows have no date column of their own
    expect(cells[0], "the day").toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cells[1], "the payee").not.toBe("");
    expect(cells[4], "the amount as a number with a decimal comma").toMatch(/^-?\d+(,\d+)?$/);
  }
  await context.close();
});
