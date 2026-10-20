import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { createRequire } from "node:module";
import { join } from "node:path";
import { stubCockpit } from "./cockpit-stub.ts";
import { watch } from "./helpers.ts";

// axe-core over the four pages of the main menu: no violation of impact serious or critical. Yhteenveto is looked at with the
// cockpit's parts on it (the waterfall, the pools' sentence, the ticks), as the server will give them.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");
// the page's policy refuses a script it did not serve, so axe is added to a context that bypasses it
const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

interface Violation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: unknown[]; any: { message: string }[] }[];
}

/** The serious and critical violations on the page as it stands, one line each with the first targets. */
async function serious(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: AXE });
  // a card fades in: its colours are read at the end of that, not in the middle of it
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch { /* one that never ends */ } }));
  const found = await page.evaluate(async () => {
    const run = (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: Violation[] }> } }).axe.run;
    return (await run(document, { resultTypes: ["violations"] })).violations;
  });
  return found.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.impact}): ${v.help}: ${v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} [${n.any[0]?.message ?? ""}]`).join(" | ")}`);
}

async function visit(context: BrowserContext, path: string, ready: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(path);
  await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(ready).first()).toBeVisible();
  // a card that refetches is dimmed (.loading, base.css): its colours are read once it has settled
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
  return page;
}

for (const [name, path, ready] of [
  ["Yhteenveto", "/#/overview?period=month", ".wf-row"],
  ["Raportit", "/#/reports", ".report-nav"],
  ["Tapahtumat", "/#/transactions", ".tx-card"],
  ["Asetukset", "/#/settings", "h1, h2"],
] as const) {
  test(`${name}: axe finds no serious or critical violation`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 }, bypassCSP: true });
    await stubCockpit(context, { settlement: "uneven" });
    const page = await visit(context, path, ready);
    const seen = watch(page);
    expect(await serious(page)).toEqual([]);
    expect(seen.problems).toEqual([]);
    await context.close();
  });
}

// 0.69: the pages of the round's UI5 in both looks, at the desktop and the phone width. Tarkistettavat is looked at with
// a question on it and with the queue empty.
const LOAN = { kind: "loan", id: "loan:a11y", cents: 120_000, key: "a11y", payee: "Pankki Oyj", paymentCents: 10_000, months: 12, firstDate: "2025-01-02", lastDate: "2025-12-02", guess: "mortgage", placed: true, rows: [], rowCount: 12 };
for (const look of ["light", "night"] as const) {
  for (const width of [1280, 390]) {
    for (const [name, path, ready, queue] of [
      ["Yhteenveto", "/#/overview?period=month", ".wf-row", null],
      ["Laskut", "/#/bills", "#tulossa", null],
      ["Tapahtumat", "/#/transactions", ".tx-card", null],
      ["Tarkistettavat, a question", "/#/review", ".review-item", [LOAN]],
      ["Tarkistettavat, empty", "/#/review", ".review-end", []],
    ] as const) {
      test(`${name}, ${look}, ${width} px: axe finds no serious or critical violation`, async ({ browser }) => {
        const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, bypassCSP: true, ...(width < 600 ? { isMobile: true, hasTouch: true } : {}) });
        await stubCockpit(context, { settlement: "uneven" });
        if (queue) await context.route(/\/api\/review(\?|$)/, (r) => r.fulfill({ json: { items: queue } }));
        const page = await visit(context, path, ready);
        const seen = watch(page);
        // the night set is reached only by the attribute (tokens.css); the light one is the page as served
        if (look === "night") await page.evaluate(() => document.documentElement.setAttribute("data-look", "night"));
        expect(await serious(page)).toEqual([]);
        expect(seen.problems).toEqual([]);
        await context.close();
      });
    }
  }
}
