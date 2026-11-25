import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { openAll, openDrills } from "./table-audit.ts";

// Decision: whether a page offers one way to each place. With every details open and the first row of each table opened, no
// page of Yhteenveto, Tapahtumat, Laskut, Raportit, Tarkistettavat or Asetukset has two links that go to the same address: a second
// link to a place is a second thing to read, find and tap for no new answer. The check reads the links a reader can see in
// the page's main part, at the width of a phone and of a desktop.
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

const ROUTES = [
  "/#/overview",
  "/#/bills",
  "/#/transactions",
  "/#/transactions?view=merchants",
  "/#/reports",
  "/#/reports?q=tulot",
  "/#/reports?q=menot",
  "/#/balances",
  "/#/review",
  "/#/settings/banks",
  "/#/settings/members",
  "/#/settings/security",
  "/#/settings/data",
  "/#/settings/server",
];

for (const width of [390, 1440]) {
  test(`no page has two links to the same address, ${width} px`, async ({ browser }) => {
    test.setTimeout(240_000);
    const phone = width < 600;
    const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 }, bypassCSP: true, ...(phone ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    const problems: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      // a hash-only navigation keeps the old document: reload so the page is read from the start
      await page.reload();
      await expect(page.getByText("Ladataan…")).toHaveCount(0, { timeout: 15_000 });
      await expect(page.locator(".loading")).toHaveCount(0, { timeout: 15_000 });
      await openAll(page);
      await openDrills(page);
      const twice = await page.evaluate(() => {
        const seen = new Map<string, string[]>();
        for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("main a[href]"))) {
          let hidden = !a.checkVisibility({ checkVisibilityCSS: true }) || a.getClientRects().length === 0 || !!a.closest("[hidden], [inert]");
          for (let up: Element | null = a; up && !hidden; up = up.parentElement) {
            const parent = up.parentElement;
            if (parent instanceof HTMLDetailsElement && !parent.open && up.tagName !== "SUMMARY") hidden = true;
          }
          if (hidden) continue;
          const name = (a.textContent || a.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40);
          const box = a.closest("section, table, details, li, [id]");
          const where = box ? `${box.tagName.toLowerCase()}${box.id ? `#${box.id}` : ""}${typeof box.className === "string" && box.className ? `.${box.className.trim().split(/\s+/).join(".")}` : ""}` : "main";
          seen.set(a.href, [...(seen.get(a.href) ?? []), `"${name}" in ${where}`]);
        }
        return Array.from(seen).filter(([, links]) => links.length > 1).map(([href, links]) => `${href.replace(location.origin, "")} is linked ${links.length} times: ${links.join("; ")}`);
      });
      problems.push(...twice.map((p) => `${route}: ${p}`));
    }
    expect(problems).toEqual([]);
    await context.close();
  });
}
