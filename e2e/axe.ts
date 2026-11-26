import { expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";

// the page's policy refuses a script it did not serve, so axe is added to a context that bypasses it
export const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

export interface Violation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: unknown[]; any: { message: string }[] }[];
}

/** The serious and critical violations on the page as it stands, one line each with the first targets. */
export async function serious(page: Page, floor: ("serious" | "critical" | "moderate" | "minor")[] = ["serious", "critical"]): Promise<string[]> {
  await page.addScriptTag({ path: AXE });
  // a card that refetches is dimmed (.loading, 0.6 opacity) and axe would read its colours dimmed: wait for the last one to settle
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
  // a card fades in: its colours are read at the end of that, not in the middle of it
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch { /* one that never ends */ } }));
  const found = await page.evaluate(async () => {
    const run = (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: Violation[] }> } }).axe.run;
    return (await run(document, { resultTypes: ["violations"] })).violations;
  });
  return found.filter((v) => floor.includes(v.impact as "serious")).map((v) => `${v.id} (${v.impact}): ${v.help}: ${v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} [${n.any[0]?.message ?? ""}]`).join(" | ")}`);
}
