import { expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { overflow } from "./helpers.ts";

const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

/** Opens content, not header menus: closing a menu on an outside click would consume a chart's click. */
export async function openAll(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  const targets = page.locator('main button[aria-pressed="false"]:text-is("Taulukko"), main details:not([open]) > summary');
  for (let step = 0; step < 128; step++) {
    if (await targets.count() === 0) return;
    // The locator changes after each click, so choose afresh rather than indexing a shrinking list.
    await targets.first().click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main .loading, main .skel")).toHaveCount(0, { timeout: 15_000 });
  }
  throw new Error("Table choices or content details did not finish opening");
}

interface Found {
  id: string;
  help: string;
  nodes: { target: unknown[] }[];
}

/** The same visibility, overflow and accessibility checks for every table view. */
export async function auditTables(page: Page, width: number): Promise<string[]> {
  // A shell can appear before a lazy view mounts its loading state and chart controls.
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main .loading, main .skel")).toHaveCount(0, { timeout: 15_000 });
  const problems = await page.evaluate(() => Array.from(document.querySelectorAll("table"))
    .filter((t) => !(t.offsetWidth || t.offsetHeight))
    .map((t) => `${t.querySelector("caption")?.textContent?.trim() || "(no name)"}: hidden until something is opened`));
  await openAll(page);
  const wide = await overflow(page);
  if (wide > 0) problems.push(`the page is ${wide} px wider than the window`);
  const tables = await page.evaluate((w) => {
    const out: string[] = [];
    for (const t of Array.from(document.querySelectorAll("table"))) {
      const name = t.querySelector("caption")?.textContent?.trim() || t.getAttribute("aria-label") || "(no name)";
      if (!(t.offsetWidth || t.offsetHeight)) out.push(`${name}: not shown`);
      if (t.getBoundingClientRect().right > w + 0.5) out.push(`${name}: reaches past the window`);
      for (let e: HTMLElement | null = t.parentElement; e && e !== document.body; e = e.parentElement) {
        const x = getComputedStyle(e).overflowX;
        if ((x === "auto" || x === "scroll") && e.scrollWidth > e.clientWidth + 1) out.push(`${name}: scrolls sideways inside ${e.className || e.tagName}`);
      }
      if (t.closest(".table-wrap, .rt-wrap-scroll")) out.push(`${name}: sits in a scroll frame`);
    }
    return out;
  }, width);
  problems.push(...tables);
  if (!(await page.locator("table").count())) return problems;
  await page.addScriptTag({ path: AXE });
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch { /* one that never ends */ } }));
  const found = await page.evaluate(async () => {
    const run = (window as unknown as { axe: { run: (c: object, o: object) => Promise<{ violations: Found[] }> } }).axe.run;
    return (await run({ include: [["table"]] }, { resultTypes: ["violations"] })).violations;
  });
  for (const v of found) problems.push(`axe ${v.id}: ${v.help}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  await expect(page.locator('main button[aria-pressed="false"]:text-is("Taulukko")'), `all chart tables selected at ${page.url()}`).toHaveCount(0);
  return problems;
}
